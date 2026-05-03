use std::{
  fs::{self, OpenOptions},
  io::{Read, Seek, SeekFrom, Write},
  net::{SocketAddr, TcpStream},
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::Mutex,
  thread,
  time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::{io::AsRawHandle, process::CommandExt};

#[cfg(target_os = "windows")]
use windows::Win32::{
  Foundation::{CloseHandle, HANDLE},
  System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  },
};

const SERVER_PORT: u16 = 8787;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(15);
const HEALTHCHECK_TIMEOUT: Duration = Duration::from_millis(500);
#[cfg(debug_assertions)]
const EXISTING_BACKEND_WAIT: Duration = Duration::from_secs(30);
#[cfg(not(debug_assertions))]
const EXISTING_BACKEND_WAIT: Duration = Duration::from_secs(1);
const BACKEND_LOG_NAME: &str = "middleware.log";
const BUNDLED_TOKEN_NAME: &str = "middleware-token";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct BackendState {
  child: Mutex<Option<Child>>,
  monitor_started: Mutex<bool>,
  #[cfg(target_os = "windows")]
  job: Mutex<Option<WindowsJobObject>>,
}

#[cfg(target_os = "windows")]
struct WindowsJobObject {
  handle: HANDLE,
}

#[cfg(target_os = "windows")]
unsafe impl Send for WindowsJobObject {}

#[cfg(target_os = "windows")]
unsafe impl Sync for WindowsJobObject {}

#[cfg(target_os = "windows")]
impl Drop for WindowsJobObject {
  fn drop(&mut self) {
    unsafe {
      let _ = CloseHandle(self.handle);
    }
  }
}

pub fn ensure_backend(app: &AppHandle) -> Result<(), String> {
  let log_path = resolve_log_path(app);

  if wait_for_existing_backend(EXISTING_BACKEND_WAIT, &log_path) {
    append_backend_log(&log_path, "Detected middleware already listening on :8787");
    #[cfg(not(debug_assertions))]
    start_backend_monitor(app.clone(), log_path.clone());
    return Ok(());
  }

  #[cfg(debug_assertions)]
  {
    let message = format!(
      "No middleware on http://127.0.0.1:{SERVER_PORT} after {}s. In dev, Middleware is started by `pnpm dev:local` (the Tauri beforeDevCommand). Check that script's output.",
      EXISTING_BACKEND_WAIT.as_secs()
    );
    append_backend_log(&log_path, &message);
    return Err(message);
  }

  #[cfg(not(debug_assertions))]
  {
    spawn_bundled_backend(app, &log_path)?;
    start_backend_monitor(app.clone(), log_path.clone());
    Ok(())
  }
}

#[cfg(not(debug_assertions))]
fn spawn_bundled_backend(app: &AppHandle, log_path: &Path) -> Result<(), String> {
  append_backend_log(
    log_path,
    "Middleware healthcheck failed, attempting bundled startup",
  );

  let server_dir = resolve_server_dir(app, log_path)?;
  let node_path = server_dir.join("bin").join(node_binary_name());
  let entry_path = server_dir.join("dist").join("index.js");
  let middleware_token = ensure_bundled_middleware_token(app, log_path)?;

  append_backend_log(
    &log_path,
    &format!("Using bundled middleware directory {}", server_dir.display()),
  );

  if !node_path.exists() {
    return Err(format!(
      "Bundled Node runtime not found at {}. See {}",
      node_path.display(),
      log_path.display()
    ));
  }

  if !entry_path.exists() {
    return Err(format!(
      "Bundled middleware entrypoint not found at {}. See {}",
      entry_path.display(),
      log_path.display()
    ));
  }

  let stdout = open_log_stdio(&log_path)?;
  let stderr = open_log_stdio(&log_path)?;
  let mut command = Command::new(&node_path);

  command
    .arg(&entry_path)
    .current_dir(&server_dir)
    .env("NODE_ENV", "production")
    .env("PORT", SERVER_PORT.to_string())
    .env("HOST", "127.0.0.1")
    .env("MIDDLEWARE_TOKEN", middleware_token)
    .stdin(Stdio::null())
    .stdout(stdout)
    .stderr(stderr);

  #[cfg(target_os = "windows")]
  command.creation_flags(CREATE_NO_WINDOW);

  let mut child = command
    .spawn()
    .map_err(|err| format!("Failed to start bundled middleware: {err}"))?;

  #[cfg(target_os = "windows")]
  let job = create_kill_on_close_job_object(&mut child, &log_path)?;

  append_backend_log(
    &log_path,
    &format!("Spawned bundled middleware process with pid {}", child.id()),
  );

  if let Err(err) = wait_for_backend(&mut child, &log_path) {
    let _ = child.kill();
    let _ = child.wait();
    append_backend_log(&log_path, &format!("Middleware startup failed: {err}"));
    return Err(err);
  }

  let state = app.state::<BackendState>();
  let mut guard = state.inner().child.lock().unwrap();
  *guard = Some(child);

  #[cfg(target_os = "windows")]
  {
    let mut job_guard = state.inner().job.lock().unwrap();
    *job_guard = Some(job);
  }

  append_backend_log(&log_path, "Bundled middleware reported healthy");

  Ok(())
}

#[cfg(not(debug_assertions))]
fn ensure_bundled_middleware_token(app: &AppHandle, log_path: &Path) -> Result<String, String> {
  let dir = app
    .path()
    .app_config_dir()
    .map_err(|err| format!("Failed to resolve app config dir: {err}"))?;
  fs::create_dir_all(&dir)
    .map_err(|err| format!("Failed to create app config dir {}: {err}", dir.display()))?;
  let token_path = dir.join(BUNDLED_TOKEN_NAME);
  if let Ok(existing) = fs::read_to_string(&token_path) {
    let token = existing.trim().to_string();
    if !token.is_empty() {
      return Ok(token);
    }
  }
  let token = format!("desktop-{}-{}", std::process::id(), unix_timestamp_seconds());
  fs::write(&token_path, &token)
    .map_err(|err| format!("Failed to write middleware token {}: {err}", token_path.display()))?;
  append_backend_log(log_path, &format!("Created bundled middleware token at {}", token_path.display()));
  Ok(token)
}

#[cfg(not(debug_assertions))]
fn start_backend_monitor(app: AppHandle, log_path: PathBuf) {
  {
    let state = app.state::<BackendState>();
    let mut started = state.inner().monitor_started.lock().unwrap();
    if *started {
      return;
    }
    *started = true;
  }

  thread::spawn(move || loop {
    thread::sleep(Duration::from_secs(5));
    if is_backend_healthy() {
      continue;
    }

    append_backend_log(&log_path, "Middleware healthcheck failed in monitor; restarting bundled middleware");

    {
      let state = app.state::<BackendState>();
      let mut guard = state.inner().child.lock().unwrap();
      if let Some(child) = guard.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
      }
      *guard = None;

      #[cfg(target_os = "windows")]
      {
        let mut job_guard = state.inner().job.lock().unwrap();
        *job_guard = None;
      }
    }

    if let Err(err) = spawn_bundled_backend(&app, &log_path) {
      append_backend_log(&log_path, &format!("Bundled middleware restart failed: {err}"));
    }
  });
}

pub fn stop_backend(app: &AppHandle) {
  let log_path = resolve_log_path(app);
  let state = app.state::<BackendState>();
  let mut guard = state.inner().child.lock().unwrap();

  if let Some(child) = guard.as_mut() {
    append_backend_log(
      &log_path,
      &format!("Stopping bundled middleware process {}", child.id()),
    );
    let _ = child.kill();
    let _ = child.wait();
  }

  *guard = None;

  #[cfg(target_os = "windows")]
  {
    let mut job_guard = state.inner().job.lock().unwrap();
    *job_guard = None;
  }
}

fn wait_for_existing_backend(timeout: Duration, log_path: &Path) -> bool {
  let started_at = Instant::now();
  let mut logged_wait = false;

  loop {
    if is_backend_healthy() {
      return true;
    }

    if started_at.elapsed() >= timeout {
      return false;
    }

    if !logged_wait {
      append_backend_log(
        log_path,
        &format!(
          "Waiting up to {}s for middleware on :{}",
          timeout.as_secs(),
          SERVER_PORT
        ),
      );
      logged_wait = true;
    }

    thread::sleep(Duration::from_millis(500));
  }
}

#[cfg(not(debug_assertions))]
fn wait_for_backend(child: &mut Child, log_path: &Path) -> Result<(), String> {
  let started_at = Instant::now();

  while started_at.elapsed() < STARTUP_TIMEOUT {
    if is_backend_healthy() {
      return Ok(());
    }

    match child.try_wait() {
      Ok(Some(status)) => {
        return Err(format!(
          "Bundled middleware exited early with status {status}. See {}",
          log_path.display()
        ));
      }
      Ok(None) => {}
      Err(err) => {
        return Err(format!(
          "Failed to inspect bundled middleware status: {err}. See {}",
          log_path.display()
        ));
      }
    }

    thread::sleep(Duration::from_millis(250));
  }

  Err(format!(
    "Bundled middleware did not become healthy on http://127.0.0.1:{SERVER_PORT}. See {}",
    log_path.display()
  ))
}

fn resolve_server_dir(app: &AppHandle, log_path: &Path) -> Result<PathBuf, String> {
  let mut candidates = Vec::new();

  if let Ok(resource_dir) = app.path().resource_dir() {
    let resource_dir = normalize_path(resource_dir);
    candidates.push(resource_dir.join("bundled").join("middleware"));
    candidates.push(resource_dir.join("middleware"));
  }

  if let Ok(executable_dir) = app.path().executable_dir() {
    let executable_dir = normalize_path(executable_dir);
    candidates.push(executable_dir.join("bundled").join("middleware"));
    candidates.push(executable_dir.join("resources").join("bundled").join("middleware"));
    candidates.push(
      executable_dir
        .join("..")
        .join("Resources")
        .join("bundled")
        .join("middleware"),
    );
  }

  for candidate in &candidates {
    append_backend_log(
      log_path,
      &format!("Checking bundled middleware candidate {}", candidate.display()),
    );

    if candidate.exists() {
      return Ok(candidate.clone());
    }
  }

  Err(format!(
    "Unable to locate the bundled middleware resources. Checked {}. See {}",
    candidates
      .iter()
      .map(|candidate| candidate.display().to_string())
      .collect::<Vec<_>>()
      .join(", "),
    log_path.display()
  ))
}

fn resolve_log_path(app: &AppHandle) -> PathBuf {
  if let Ok(log_dir) = app.path().app_log_dir() {
    let _ = fs::create_dir_all(&log_dir);
    return log_dir.join(BACKEND_LOG_NAME);
  }

  std::env::temp_dir().join(format!("jarvis-{BACKEND_LOG_NAME}"))
}

#[cfg(target_os = "windows")]
fn normalize_path(path: PathBuf) -> PathBuf {
  let raw = path.to_string_lossy();

  if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
    return PathBuf::from(format!(r"\\{stripped}"));
  }

  if let Some(stripped) = raw.strip_prefix(r"\\?\") {
    return PathBuf::from(stripped);
  }

  path
}

#[cfg(not(target_os = "windows"))]
fn normalize_path(path: PathBuf) -> PathBuf {
  path
}

fn open_log_stdio(log_path: &Path) -> Result<Stdio, String> {
  if let Some(parent) = log_path.parent() {
    fs::create_dir_all(parent)
      .map_err(|err| format!("Failed to create backend log directory: {err}"))?;
  }

  let file = OpenOptions::new()
    .create(true)
    .append(true)
    .open(log_path)
    .map_err(|err| format!("Failed to open backend log file {}: {err}", log_path.display()))?;

  Ok(Stdio::from(file))
}

#[cfg(target_os = "windows")]
fn create_kill_on_close_job_object(
  child: &mut Child,
  log_path: &Path,
) -> Result<WindowsJobObject, String> {
  unsafe {
    let job = CreateJobObjectW(None, None)
      .map_err(|err| format!("Failed to create backend job object: {err}"))?;
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

    SetInformationJobObject(
      job,
      JobObjectExtendedLimitInformation,
      &info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const _,
      std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
    )
    .map_err(|err| {
      let _ = CloseHandle(job);
      format!("Failed to configure backend job object: {err}")
    })?;

    let process_handle = HANDLE(child.as_raw_handle() as _);
    AssignProcessToJobObject(job, process_handle).map_err(|err| {
      let _ = CloseHandle(job);
      format!("Failed to attach bundled backend to job object: {err}")
    })?;

    append_backend_log(
      log_path,
      &format!("Attached bundled middleware process {} to Windows job object", child.id()),
    );

    Ok(WindowsJobObject { handle: job })
  }
}

fn append_backend_log(log_path: &Path, message: &str) {
  if let Some(parent) = log_path.parent() {
    let _ = fs::create_dir_all(parent);
  }

  if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
    let _ = writeln!(file, "[{}] {message}", unix_timestamp_seconds());
  }
}

fn unix_timestamp_seconds() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs()
}

fn is_backend_healthy() -> bool {
  let addr = SocketAddr::from(([127, 0, 0, 1], SERVER_PORT));
  let mut stream = match TcpStream::connect_timeout(&addr, HEALTHCHECK_TIMEOUT) {
    Ok(stream) => stream,
    Err(_) => return false,
  };

  let _ = stream.set_read_timeout(Some(HEALTHCHECK_TIMEOUT));
  let _ = stream.set_write_timeout(Some(HEALTHCHECK_TIMEOUT));

  if stream
    .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
    .is_err()
  {
    return false;
  }

  let mut response = String::new();
  if stream.read_to_string(&mut response).is_err() {
    return false;
  }

  response.contains("\"ok\":true")
}

fn node_binary_name() -> &'static str {
  if cfg!(target_os = "windows") {
    "node.exe"
  } else {
    "node"
  }
}

#[derive(Serialize)]
pub struct BackendLogResponse {
  pub path: String,
  pub content: String,
  pub size: u64,
  pub truncated: bool,
}

const DEFAULT_LOG_TAIL_BYTES: u64 = 256 * 1024;
const MAX_LOG_TAIL_BYTES: u64 = 4 * 1024 * 1024;

#[tauri::command]
pub fn read_backend_log(
  app: AppHandle,
  max_bytes: Option<u64>,
) -> Result<BackendLogResponse, String> {
  let path = resolve_log_path(&app);
  let path_string = path.to_string_lossy().to_string();

  if !path.exists() {
    return Ok(BackendLogResponse {
      path: path_string,
      content: String::new(),
      size: 0,
      truncated: false,
    });
  }

  let cap = max_bytes
    .unwrap_or(DEFAULT_LOG_TAIL_BYTES)
    .min(MAX_LOG_TAIL_BYTES)
    .max(1024);

  let mut file = fs::File::open(&path)
    .map_err(|err| format!("Failed to open backend log: {err}"))?;
  let size = file
    .metadata()
    .map_err(|err| format!("Failed to read backend log metadata: {err}"))?
    .len();

  let truncated = size > cap;
  if truncated {
    file
      .seek(SeekFrom::Start(size - cap))
      .map_err(|err| format!("Failed to seek backend log: {err}"))?;
  }

  let mut content = String::new();
  file
    .read_to_string(&mut content)
    .map_err(|err| format!("Failed to read backend log: {err}"))?;

  if truncated {
    if let Some(idx) = content.find('\n') {
      content = content[idx + 1..].to_string();
    }
  }

  Ok(BackendLogResponse {
    path: path_string,
    content,
    size,
    truncated,
  })
}
