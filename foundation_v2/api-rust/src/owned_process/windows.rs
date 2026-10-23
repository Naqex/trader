use std::{
    ffi::{OsStr, OsString, c_void},
    io,
    mem::{size_of, zeroed},
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::ExitStatusExt,
    },
    path::Path,
    process::ExitStatus,
    ptr::{null, null_mut},
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::{
        GENERIC_READ, GENERIC_WRITE, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE,
        SetHandleInformation, WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    Security::SECURITY_ATTRIBUTES,
    Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    },
    System::{
        JobObjects::{
            CreateJobObjectW, JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOB_OBJECT_LIMIT_PROCESS_MEMORY, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectBasicAccountingInformation,
            JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
            TerminateJobObject,
        },
        Pipes::CreatePipe,
        Threading::{
            CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, CreateProcessW,
            DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess,
            InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION,
            STARTF_USESTDHANDLES, STARTUPINFOEXW, UpdateProcThreadAttribute, WaitForSingleObject,
        },
    },
};

#[derive(Clone, Copy, Default)]
pub struct Limits {
    pub active_processes: Option<u32>,
    pub process_memory_bytes: Option<usize>,
}

pub struct Child {
    // Neither the job handle nor the process handle is inherited by the child.
    job: OwnedHandle,
    process: OwnedHandle,
    id: u32,
    pub stdout: Option<tokio::process::ChildStdout>,
    pub stdin: Option<tokio::process::ChildStdin>,
    pub stderr: Option<tokio::process::ChildStderr>,
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}
fn checked(ok: i32) -> io::Result<()> {
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}
fn wide(value: &OsStr) -> io::Result<Vec<u16>> {
    let mut value: Vec<_> = value.encode_wide().collect();
    if value.contains(&0) {
        return Err(invalid("process argument contains NUL"));
    }
    value.push(0);
    Ok(value)
}

// All arguments are quoted using the documented Microsoft CRT convention;
// application name is explicit and .cmd/.bat never invoke a shell implicitly.
fn command_line(executable: &Path, args: &[String]) -> io::Result<Vec<u16>> {
    let mut result = Vec::new();
    for value in std::iter::once(executable.as_os_str()).chain(args.iter().map(OsStr::new)) {
        if !result.is_empty() {
            result.push(b' ' as u16);
        }
        result.push(b'"' as u16);
        let mut slashes = 0;
        for unit in value.encode_wide() {
            if unit == 0 {
                return Err(invalid("process argument contains NUL"));
            }
            if unit == b'\\' as u16 {
                slashes += 1;
                continue;
            }
            result.extend(std::iter::repeat_n(
                b'\\' as u16,
                if unit == b'"' as u16 {
                    slashes * 2 + 1
                } else {
                    slashes
                },
            ));
            result.push(unit);
            slashes = 0;
        }
        result.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
        result.push(b'"' as u16);
    }
    result.push(0);
    if result.len() > 32767 {
        return Err(invalid("process command line too long"));
    }
    Ok(result)
}

fn environment(overrides: &[(&str, &str)], inherit: bool) -> io::Result<Vec<u16>> {
    let mut entries: Vec<(OsString, OsString)> = if inherit {
        std::env::vars_os().collect()
    } else {
        Vec::new()
    };
    for (key, value) in overrides {
        if key.is_empty() || key.contains(['=', '\0']) {
            return Err(invalid("invalid environment key"));
        }
        entries.retain(|(existing, _)| !existing.to_string_lossy().eq_ignore_ascii_case(key));
        entries.push((key.into(), value.into()));
    }
    entries.sort_by_cached_key(|(key, _)| key.to_string_lossy().to_uppercase());
    let mut result = Vec::new();
    for (key, value) in entries {
        let mut entry = key;
        entry.push("=");
        entry.push(value);
        result.extend(wide(&entry)?);
    }
    result.push(0);
    if result.len() == 1 {
        result.push(0);
    }
    Ok(result)
}

fn raw(handle: &OwnedHandle) -> HANDLE {
    handle.as_raw_handle()
}
unsafe fn owned(handle: HANDLE) -> io::Result<OwnedHandle> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: caller passes a newly created, valid handle exactly once.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}
fn pipe(attributes: &SECURITY_ATTRIBUTES) -> io::Result<(OwnedHandle, OwnedHandle)> {
    let (mut read, mut write) = (null_mut(), null_mut());
    // SAFETY: output pointers and security descriptor live through this call.
    unsafe {
        checked(CreatePipe(&mut read, &mut write, attributes, 0))?;
        let read = owned(read)?;
        let write = owned(write)?;
        checked(SetHandleInformation(raw(&read), HANDLE_FLAG_INHERIT, 0))?;
        Ok((read, write))
    }
}

struct Attributes {
    _storage: Vec<usize>,
    list: LPPROC_THREAD_ATTRIBUTE_LIST,
}
impl Attributes {
    fn new() -> io::Result<Self> {
        let mut bytes = 0;
        unsafe {
            InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut bytes);
        }
        if bytes == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
        let list = storage.as_mut_ptr().cast();
        unsafe {
            checked(InitializeProcThreadAttributeList(list, 2, 0, &mut bytes))?;
        }
        Ok(Self {
            _storage: storage,
            list,
        })
    }
    // Values must remain alive until this attribute list is dropped.
    unsafe fn add(&self, key: u32, values: &mut [HANDLE]) -> io::Result<()> {
        unsafe {
            checked(UpdateProcThreadAttribute(
                self.list,
                0,
                key as usize,
                values.as_mut_ptr().cast(),
                std::mem::size_of_val(values),
                null_mut(),
                null(),
            ))
        }
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe {
            DeleteProcThreadAttributeList(self.list);
        }
    }
}

pub fn spawn(
    executable: &Path,
    args: &[String],
    cwd: Option<&Path>,
    overrides: &[(&str, &str)],
    limits: Limits,
    capture_stderr: bool,
) -> io::Result<Child> {
    spawn_inner(
        executable,
        args,
        cwd,
        overrides,
        limits,
        capture_stderr,
        false,
        true,
    )
}

/// Credentials travel in an inherited pipe, never command-line arguments.
pub fn spawn_with_stdin(
    executable: &Path,
    args: &[String],
    cwd: Option<&Path>,
    overrides: &[(&str, &str)],
    limits: Limits,
    capture_stderr: bool,
) -> io::Result<Child> {
    spawn_inner(
        executable,
        args,
        cwd,
        overrides,
        limits,
        capture_stderr,
        true,
        true,
    )
}

/// Start trusted workers without leaking the API's provider/broker environment.
pub fn spawn_isolated_with_stdin(
    executable: &Path,
    args: &[String],
    cwd: Option<&Path>,
    environment: &[(&str, &str)],
    limits: Limits,
    capture_stderr: bool,
) -> io::Result<Child> {
    spawn_inner(
        executable,
        args,
        cwd,
        environment,
        limits,
        capture_stderr,
        true,
        false,
    )
}

fn spawn_inner(
    executable: &Path,
    args: &[String],
    cwd: Option<&Path>,
    overrides: &[(&str, &str)],
    limits: Limits,
    capture_stderr: bool,
    piped_input: bool,
    inherit_environment: bool,
) -> io::Result<Child> {
    if !executable.is_absolute()
        || !executable
            .extension()
            .is_some_and(|v| v.eq_ignore_ascii_case("exe"))
    {
        return Err(invalid("owned process requires an absolute .exe path"));
    }
    if cwd.is_some_and(|value| !value.is_absolute())
        || limits.active_processes == Some(0)
        || limits.process_memory_bytes == Some(0)
    {
        return Err(invalid("invalid process working directory or limits"));
    }
    let application = wide(executable.as_os_str())?;
    let mut command = command_line(executable, args)?;
    let cwd = cwd.map(|p| wide(p.as_os_str())).transpose()?;
    let environment = environment(overrides, inherit_environment)?;
    let security = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    };
    // SAFETY: Win32 structures are zero-initializable; all buffers/handles remain
    // alive through CreateProcessW and only the three stdio handles are inherited.
    unsafe {
        let job = owned(CreateJobObjectW(null(), null()))?;
        let mut information: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if let Some(value) = limits.active_processes {
            information.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
            information.BasicLimitInformation.ActiveProcessLimit = value;
        }
        if let Some(value) = limits.process_memory_bytes {
            information.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            information.ProcessMemoryLimit = value;
        }
        checked(SetInformationJobObject(
            raw(&job),
            JobObjectExtendedLimitInformation,
            (&information as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ))?;
        let input = owned(CreateFileW(
            wide(OsStr::new("NUL"))?.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &security,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            null_mut(),
        ))?;
        let (input, stdin) = if piped_input {
            let (mut read, mut write) = (null_mut(), null_mut());
            checked(CreatePipe(&mut read, &mut write, &security, 0))?;
            let read = owned(read)?;
            let write = owned(write)?;
            checked(SetHandleInformation(raw(&write), HANDLE_FLAG_INHERIT, 0))?;
            (read, Some(write))
        } else {
            (input, None)
        };
        let (stdout, output) = pipe(&security)?;
        let (stderr, error) = if capture_stderr {
            let (read, write) = pipe(&security)?;
            (Some(read), write)
        } else {
            (
                None,
                owned(CreateFileW(
                    wide(OsStr::new("NUL"))?.as_ptr(),
                    GENERIC_WRITE,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    &security,
                    OPEN_EXISTING,
                    FILE_ATTRIBUTE_NORMAL,
                    null_mut(),
                ))?,
            )
        };
        let mut jobs = [raw(&job)];
        let mut handles = [raw(&input), raw(&output), raw(&error)];
        let attributes = Attributes::new()?;
        attributes.add(PROC_THREAD_ATTRIBUTE_JOB_LIST, &mut jobs)?;
        attributes.add(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &mut handles)?;
        let mut startup: STARTUPINFOEXW = zeroed();
        startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = raw(&input);
        startup.StartupInfo.hStdOutput = raw(&output);
        startup.StartupInfo.hStdError = raw(&error);
        startup.lpAttributeList = attributes.list;
        let mut info: PROCESS_INFORMATION = zeroed();
        checked(CreateProcessW(
            application.as_ptr(),
            command.as_mut_ptr(),
            null(),
            null(),
            1,
            CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
            environment.as_ptr().cast::<c_void>(),
            cwd.as_ref().map_or(null(), |p| p.as_ptr()),
            &startup.StartupInfo,
            &mut info,
        ))?;
        let process = owned(info.hProcess)?;
        let _thread = owned(info.hThread)?;
        // If stdio conversion ever fails, dropping the job still kills the tree.
        let mut child = Child {
            job,
            process,
            id: info.dwProcessId,
            stdout: None,
            stdin: None,
            stderr: None,
        };
        child.stdout = Some(tokio::process::ChildStdout::from_std(stdout.into())?);
        child.stdin = stdin
            .map(|handle| tokio::process::ChildStdin::from_std(handle.into()))
            .transpose()?;
        child.stderr = stderr
            .map(|handle| tokio::process::ChildStderr::from_std(handle.into()))
            .transpose()?;
        Ok(child)
    }
}

impl Child {
    pub fn id(&self) -> u32 {
        self.id
    }
    pub fn try_wait(&self) -> io::Result<Option<ExitStatus>> {
        unsafe {
            match WaitForSingleObject(raw(&self.process), 0) {
                WAIT_TIMEOUT => Ok(None),
                WAIT_OBJECT_0 => {
                    let mut code = 0;
                    checked(GetExitCodeProcess(raw(&self.process), &mut code))?;
                    Ok(Some(ExitStatus::from_raw(code)))
                }
                WAIT_FAILED => Err(io::Error::last_os_error()),
                _ => Err(io::Error::other("unexpected process wait result")),
            }
        }
    }
    pub async fn wait(&mut self) -> io::Result<ExitStatus> {
        loop {
            if let Some(status) = self.try_wait()? {
                return Ok(status);
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
    pub async fn kill(&mut self) -> io::Result<()> {
        unsafe {
            checked(TerminateJobObject(raw(&self.job), 1))?;
        }
        self.wait().await?;
        self.wait_tree().await
    }
    pub async fn wait_tree(&self) -> io::Result<()> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
            unsafe {
                checked(QueryInformationJobObject(
                    raw(&self.job),
                    JobObjectBasicAccountingInformation,
                    (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                    size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    null_mut(),
                ))?;
            }
            if accounting.ActiveProcesses == 0 {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "owned process tree did not exit",
                ));
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}

#[cfg(test)]
mod tests;
