use std::{
  io::{Read, Write},
  net::{SocketAddr, TcpStream},
  process::{Child, Command, Stdio},
  sync::Mutex,
  thread,
  time::{Duration, Instant},
};

use tauri::{AppHandle, Manager};

const SERVER_PORT: u16 = 3001;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
const HEALTHCHECK_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Default)]
pub struct BackendState {
  child: Mutex<Option<Child>>,
}

pub fn ensure_backend(app: &AppHandle) -> Result<(), String> {
  if is_backend_healthy() {
    return Ok(());
  }

  let server_dir = app
    .path()
    .resource_dir()
    .map_err(|err| format!("Unable to resolve app resources: {err}"))?
    .join("bundled")
    .join("server");

  let node_path = server_dir.join("bin").join(node_binary_name());
  let entry_path = server_dir.join("dist").join("index.js");

  if !node_path.exists() {
    return Err(format!(
      "Bundled Node runtime not found at {}",
      node_path.display()
    ));
  }

  if !entry_path.exists() {
    return Err(format!(
      "Bundled backend entrypoint not found at {}",
      entry_path.display()
    ));
  }

  let mut child = Command::new(&node_path)
    .arg(&entry_path)
    .current_dir(&server_dir)
    .env("NODE_ENV", "production")
    .env("JARVIS_SERVER_PORT", SERVER_PORT.to_string())
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|err| format!("Failed to start bundled backend: {err}"))?;

  if let Err(err) = wait_for_backend() {
    let _ = child.kill();
    let _ = child.wait();
    return Err(err);
  }

  let state = app.state::<BackendState>();
  let mut guard = state.child.lock().unwrap();
  *guard = Some(child);

  Ok(())
}

pub fn stop_backend(app: &AppHandle) {
  let state = app.state::<BackendState>();
  let mut guard = state.child.lock().unwrap();

  if let Some(child) = guard.as_mut() {
    let _ = child.kill();
    let _ = child.wait();
  }

  *guard = None;
}

fn wait_for_backend() -> Result<(), String> {
  let started_at = Instant::now();

  while started_at.elapsed() < STARTUP_TIMEOUT {
    if is_backend_healthy() {
      return Ok(());
    }

    thread::sleep(Duration::from_millis(250));
  }

  Err(format!(
    "Bundled backend did not become healthy on http://127.0.0.1:{SERVER_PORT}"
  ))
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
