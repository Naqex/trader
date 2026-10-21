//! A worker owns the entire adapter process tree, including after worker crash.
//! Windows 10's atomic job-list spawn avoids the create/assign race.
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{Child, Limits, spawn, spawn_with_stdin};

#[cfg(not(windows))]
pub type Child = tokio::process::Child;
#[cfg(not(windows))]
#[derive(Default)]
pub struct Limits {
    pub active_processes: Option<u32>,
    pub process_memory_bytes: Option<usize>,
}
#[cfg(not(windows))]
pub fn spawn(
    _: &std::path::Path,
    _: &[String],
    _: Option<&std::path::Path>,
    _: &[(&str, &str)],
    _: Limits,
    _: bool,
) -> std::io::Result<Child> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "owned adapter processes are verified on Windows only",
    ))
}

#[cfg(not(windows))]
pub use spawn as spawn_with_stdin;
