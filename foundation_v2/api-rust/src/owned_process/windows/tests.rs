use super::*;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

fn python() -> std::path::PathBuf {
    let config =
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.venv/pyvenv.cfg"))
            .unwrap();
    let home = config
        .lines()
        .find_map(|line| line.strip_prefix("home = "))
        .unwrap();
    Path::new(home).join("python.exe")
}
fn launch(code: &str, limits: Limits) -> Child {
    spawn(
        &python(),
        &["-I".into(), "-c".into(), code.into()],
        None,
        &[],
        limits,
        true,
    )
    .unwrap()
}
async fn line(child: &mut Child) -> String {
    let mut line = String::new();
    let mut reader = BufReader::new(child.stdout.as_mut().unwrap());
    tokio::time::timeout(Duration::from_secs(8), reader.read_line(&mut line))
        .await
        .unwrap()
        .unwrap();
    line.trim().into()
}
fn hold(pid: u32) -> OwnedHandle {
    unsafe {
        owned(windows_sys::Win32::System::Threading::OpenProcess(
            windows_sys::Win32::System::Threading::PROCESS_SYNCHRONIZE,
            0,
            pid,
        ))
        .unwrap()
    }
}
async fn exited(handle: &OwnedHandle) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if unsafe { WaitForSingleObject(raw(handle), 0) } == WAIT_OBJECT_0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("owned process survived its worker/job");
}
async fn tree() -> (Child, Vec<OwnedHandle>, Vec<u32>) {
    let mut child = launch(
        "import os,subprocess,sys,time; p=subprocess.Popen([sys.executable,'-I','-c','import os,time; print(os.getpid(),flush=True); time.sleep(60)'],stdout=subprocess.PIPE,text=True); actual=p.stdout.readline().strip(); print(str(os.getpid())+','+str(p.pid)+','+actual,flush=True); time.sleep(60)",
        Limits::default(),
    );
    let ids = line(&mut child).await;
    let mut ids: Vec<u32> = ids.split(',').map(|pid| pid.parse().unwrap()).collect();
    ids.push(child.id());
    ids.sort_unstable();
    ids.dedup();
    let handles = ids.iter().map(|pid| hold(*pid)).collect();
    (child, handles, ids)
}

#[tokio::test]
async fn drop_and_explicit_kill_terminate_the_entire_tree() {
    let (child, handles, _) = tree().await;
    drop(child);
    for handle in &handles {
        exited(handle).await;
    }
    let (mut child, handles, _) = tree().await;
    child.kill().await.unwrap();
    for handle in &handles {
        exited(handle).await;
    }
    assert!(child.try_wait().unwrap().is_some());
}

#[tokio::test]
async fn cancelled_wait_and_deadline_keep_tree_owned() {
    let (mut child, handles, _) = tree().await;
    assert!(
        tokio::time::timeout(Duration::from_millis(30), child.wait())
            .await
            .is_err()
    );
    assert!(child.try_wait().unwrap().is_none());
    child.kill().await.unwrap();
    for handle in &handles {
        exited(handle).await;
    }
}

#[tokio::test]
async fn arguments_environment_cwd_and_full_pipes() {
    let arguments = [
        "",
        "with space",
        "quote\"here",
        "slash\\",
        "\\\"",
        "Tiếng Việt",
    ]
    .map(String::from);
    let code = "import json,os,sys; print(json.dumps({'args':sys.argv[1:],'cwd':os.getcwd(),'env':os.environ['TW_OWNED_PROBE']},ensure_ascii=False),flush=True); sys.stdout.write('x'*262144); sys.stderr.write('e'*262144)";
    let mut args = vec![
        "-I".into(),
        "-X".into(),
        "utf8".into(),
        "-c".into(),
        code.into(),
    ];
    args.extend(arguments.clone());
    let cwd = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut child = spawn(
        &python(),
        &args,
        Some(cwd),
        &[("TW_OWNED_PROBE", "kiểm tra")],
        Limits::default(),
        true,
    )
    .unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let result = tokio::time::timeout(Duration::from_secs(10), async {
        let mut output = Vec::new();
        let mut error = Vec::new();
        let mut stdout = BufReader::new(stdout);
        let mut stderr = BufReader::new(stderr);
        let (status, a, b) = tokio::join!(
            child.wait(),
            stdout.read_to_end(&mut output),
            stderr.read_to_end(&mut error)
        );
        assert!(status.unwrap().success());
        a.unwrap();
        b.unwrap();
        let end = output.iter().position(|v| *v == b'\n').unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&output[..end]).unwrap();
        assert_eq!(parsed["args"], serde_json::json!(arguments));
        assert_eq!(parsed["env"], "kiểm tra");
        assert_eq!(
            Path::new(parsed["cwd"].as_str().unwrap())
                .canonicalize()
                .unwrap(),
            cwd.canonicalize().unwrap()
        );
        assert_eq!(output.len() - end - 1, 262144);
        assert_eq!(error.len(), 262144);
    })
    .await;
    if result.is_err() {
        child.kill().await.unwrap();
    }
    result.unwrap();
}

#[tokio::test]
async fn limits_apply_before_child_code() {
    let code = "import ctypes,subprocess,sys; from ctypes import wintypes; k=ctypes.WinDLL('kernel32',use_last_error=True); k.GetCurrentProcess.restype=wintypes.HANDLE; k.IsProcessInJob.argtypes=[wintypes.HANDLE,wintypes.HANDLE,ctypes.POINTER(wintypes.BOOL)]; inside=wintypes.BOOL(); assert k.IsProcessInJob(k.GetCurrentProcess(),None,ctypes.byref(inside)) and inside.value;\ntry: p=subprocess.Popen([sys.executable,'-I','-c','import time; time.sleep(60)'])\nexcept OSError: print('blocked',flush=True)\nelse: p.kill(); raise RuntimeError('descendant escaped active-process limit')\ntry: data=bytearray(160*1024*1024)\nexcept MemoryError: print('memory-bounded',flush=True)\nelse: raise RuntimeError('memory ceiling not enforced')";
    let mut child = launch(
        code,
        Limits {
            active_processes: Some(1),
            process_memory_bytes: Some(96 * 1024 * 1024),
        },
    );
    let mut output = String::new();
    tokio::time::timeout(
        Duration::from_secs(8),
        child.stdout.as_mut().unwrap().read_to_string(&mut output),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(child.wait().await.unwrap().success(), "{}", {
        let mut err = String::new();
        child
            .stderr
            .as_mut()
            .unwrap()
            .read_to_string(&mut err)
            .await
            .unwrap();
        err
    });
    assert_eq!(
        output.lines().collect::<Vec<_>>(),
        ["blocked", "memory-bounded"]
    );
}

#[tokio::test]
async fn spawn_failure_and_invalid_arguments_leave_no_process() {
    let missing = Path::new(env!("CARGO_MANIFEST_DIR")).join("missing-owned-fixture.exe");
    assert!(spawn(&missing, &[], None, &[], Limits::default(), false).is_err());
    assert!(
        spawn(
            Path::new("cmd.exe"),
            &[],
            None,
            &[],
            Limits::default(),
            false
        )
        .is_err()
    );
    assert!(
        spawn(
            &python(),
            &["a\0b".into()],
            None,
            &[],
            Limits::default(),
            false
        )
        .is_err()
    );
    assert!(
        spawn(
            &python(),
            &[],
            None,
            &[],
            Limits {
                active_processes: Some(0),
                ..Limits::default()
            },
            false
        )
        .is_err()
    );
}

// The outer test kills this worker without running Rust destructors.
#[tokio::test]
#[ignore]
async fn abrupt_worker_fixture() {
    let Some(folder) = std::env::var_os("TW_OWNED_CRASH_FIXTURE") else {
        return;
    };
    let (child, _handles, ids) = tree().await;
    // The helper publishes live PIDs while retaining the only job handle.
    use windows_sys::Win32::System::JobObjects::{
        JOBOBJECT_BASIC_PROCESS_ID_LIST, JobObjectBasicProcessIdList,
    };
    let mut storage = vec![0usize; 130];
    let list = storage
        .as_mut_ptr()
        .cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>();
    let actual: Vec<u32> = unsafe {
        checked(QueryInformationJobObject(
            raw(&child.job),
            JobObjectBasicProcessIdList,
            list.cast(),
            (storage.len() * size_of::<usize>()) as u32,
            null_mut(),
        ))
        .unwrap();
        std::slice::from_raw_parts(
            (*list).ProcessIdList.as_ptr(),
            (*list).NumberOfProcessIdsInList as usize,
        )
        .iter()
        .map(|pid| *pid as u32)
        .collect()
    };
    // Windows may also attach a console host; capture every live member rather
    // than assuming the interpreter tree always contains exactly two processes.
    assert!(ids.iter().all(|pid| actual.contains(pid)));
    std::fs::write(
        Path::new(&folder).join("pids.json"),
        serde_json::to_vec(&actual).unwrap(),
    )
    .unwrap();
    std::fs::write(Path::new(&folder).join("ready"), "ready").unwrap();
    std::future::pending::<()>().await;
}

#[tokio::test]
async fn abrupt_worker_exit_reaps_descendants() {
    let root = std::env::temp_dir().join(format!("tw-owned-crash-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let log = std::fs::File::create(root.join("worker.log")).unwrap();
    let mut parent = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "owned_process::windows::tests::abrupt_worker_fixture",
            "--ignored",
            "--nocapture",
        ])
        .env("TW_OWNED_CRASH_FIXTURE", &root)
        .stdin(std::process::Stdio::null())
        .stdout(log.try_clone().unwrap())
        .stderr(log)
        .spawn()
        .unwrap();
    let ready = tokio::time::timeout(Duration::from_secs(12), async {
        while !root.join("ready").exists() {
            assert!(
                parent.try_wait().unwrap().is_none(),
                "fixture exited before ready: {}",
                std::fs::read_to_string(root.join("worker.log")).unwrap()
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    if ready.is_err() {
        let _ = parent.kill();
        let _ = parent.wait();
        panic!("crash fixture failed to start");
    }
    let ids: Vec<u32> =
        serde_json::from_slice(&std::fs::read(root.join("pids.json")).unwrap()).unwrap();
    let handles: Vec<_> = ids.into_iter().map(hold).collect();
    parent.kill().unwrap();
    parent.wait().unwrap();
    for handle in &handles {
        exited(handle).await;
    }
    std::fs::remove_dir_all(&root).unwrap();
}
