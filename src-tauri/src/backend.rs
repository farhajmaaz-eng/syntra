use std::{
    fs::OpenOptions,
    io::{self, BufRead, BufReader, Write},
    os::windows::{io::AsRawHandle, process::CommandExt},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::CREATE_NO_WINDOW,
    },
};

struct Job(HANDLE);

impl Job {
    fn new() -> io::Result<Self> {
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = Self(handle);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&info) as u32,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(job)
        }
    }

    fn assign(&self, child: &Child) -> io::Result<()> {
        if unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle().cast()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

pub struct Backend {
    pub child: Child,
    pub port: u16,
    pub token: String,
    _job: Job,
}

impl Backend {
    pub fn launch(
        runtime: &Path,
        data: &Path,
        on_notice: impl Fn(&str) + Send + 'static,
    ) -> io::Result<Self> {
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(data.join("desktop.log"))?;
        let mut output = log.try_clone()?;
        let job = Job::new()?;
        let app = runtime.join("app");
        let mut child = Command::new(runtime.join("node.exe"))
            .arg(app.join("desktop-server.cjs"))
            .current_dir(&app)
            .env("SYNTRA_DATA_DIR", data)
            .env("CODEX_PROJECT_ROOT", data.join("workspace"))
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(log))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()?;
        if let Err(error) = job.assign(&child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        let (tx, rx) = mpsc::sync_channel(1);
        let stdout = child.stdout.take().unwrap();
        thread::spawn(move || {
            let mut ready = Some(tx);
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(payload) = line.strip_prefix("SYNTRA_READY ") {
                    if let Some(sender) = ready.take() {
                        let _ = sender.send(payload.to_owned());
                    }
                } else if let Some(kind) = line.strip_prefix("SYNTRA_NOTICE ") {
                    on_notice(kind);
                } else {
                    let _ = writeln!(output, "{line}");
                }
            }
        });
        let result = (|| {
            child.stdin.as_mut().unwrap().write_all(b"start\n")?;
            let address = rx.recv_timeout(Duration::from_secs(45)).map_err(|error| {
                io::Error::other(format!("Backend did not report readiness: {error}"))
            })?;
            let (port, token) = address
                .split_once(' ')
                .filter(|(_, token)| token.len() == 64 && token.bytes().all(|c| c.is_ascii_hexdigit()))
                .ok_or_else(|| io::Error::other("Invalid backend readiness response"))?;
            let port = port.parse::<u16>().ok().filter(|port| *port != 0)
                .ok_or_else(|| io::Error::other("Invalid backend port"))?;
            Ok((port, token.to_owned()))
        })();
        match result {
            Ok((port, token)) => Ok(Self { child, port, token, _job: job }),
            Err(error) => {
                drop(job);
                let _ = child.wait();
                Err(error)
            }
        }
    }

    pub fn shutdown(&mut self) {
        drop(self.child.stdin.take());
        for _ in 0..180 {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
