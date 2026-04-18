use super::*;

pub(crate) fn shell_command() -> String {
  std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}


pub(crate) fn spawn_terminal_reader(
  app: AppHandle,
  session_id: String,
  mut reader: Box<dyn Read + Send>,
  terminals_map: Arc<Mutex<HashMap<String, Arc<TerminalHandle>>>>,
) {
  std::thread::spawn(move || {
    let mut buffer = [0_u8; 4096];
    loop {
      match reader.read(&mut buffer) {
        Ok(0) => {
          emit_terminal_event(&app, &session_id, json!({
            "type": "terminal.closed",
            "sessionId": session_id,
          }));
          break;
        }
        Ok(count) => {
          let text = String::from_utf8_lossy(&buffer[..count]).to_string();
          emit_terminal_event(&app, &session_id, json!({
            "type": "terminal.output",
            "sessionId": session_id,
            "data": text,
          }));
        }
        Err(error) => {
          emit_terminal_event(&app, &session_id, json!({
            "type": "terminal.error",
            "sessionId": session_id,
            "message": error.to_string(),
          }));
          break;
        }
      }
    }
    // Clean up the terminals map entry when the terminal process exits.
    let id = session_id.clone();
    let map = terminals_map.clone();
    tauri::async_runtime::spawn(async move {
      map.lock().await.remove(&id);
    });
  });
}


#[tauri::command]
pub fn middleware_terminal_list(input: TerminalListInput) -> Result<Value, String> {
  let conn = open_db()?;
  let mut stmt = conn.prepare("SELECT id, project_id, topic_id, title, cwd, status, last_active_at, runtime_id FROM terminal_sessions WHERE project_id = ? ORDER BY last_active_at DESC")
    .map_err(|error| format!("Failed to prepare terminal list query: {error}"))?;
  let terminals = stmt
    .query_map(params![input.project_id], terminal_row_to_json)
    .map_err(|error| format!("Failed to list terminal sessions: {error}"))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| format!("Failed to decode terminal sessions: {error}"))?;
  Ok(json!({ "terminals": terminals }))
}

#[tauri::command]
pub async fn middleware_terminal_create(
  app: AppHandle,
  state: State<'_, MiddlewareState>,
  input: TerminalCreateInput,
) -> Result<Value, String> {
  let project_root = project_workspace_root(&input.project_id)?;
  // Validate that the requested cwd exists and is a directory.
  if let Some(ref cwd) = input.cwd {
    let cwd_path = PathBuf::from(cwd);
    if !cwd_path.exists() || !cwd_path.is_dir() {
      return Err(format!("Terminal cwd does not exist or is not a directory: {cwd}"));
    }
  }
  let cwd = input.cwd.clone().map(PathBuf::from).unwrap_or(project_root);
  let title = input.title.unwrap_or_else(|| "Terminal".to_string());
  let pty_system = native_pty_system();
  let pair = pty_system
    .openpty(PtySize {
      rows: input.rows.unwrap_or(30),
      cols: input.cols.unwrap_or(120),
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|error| format!("Failed to open PTY: {error}"))?;

  let mut command = CommandBuilder::new(shell_command());
  command.cwd(cwd.clone());
  let child = pair.slave.spawn_command(command).map_err(|error| format!("Failed to spawn shell: {error}"))?;
  let reader = pair.master.try_clone_reader().map_err(|error| format!("Failed to create PTY reader: {error}"))?;
  let writer = pair.master.take_writer().map_err(|error| format!("Failed to create PTY writer: {error}"))?;

  let id = format!("term_{}", Uuid::new_v4().simple());
  let runtime_id = Uuid::new_v4().to_string();
  let handle = Arc::new(TerminalHandle {
    master: StdMutex::new(pair.master),
    writer: StdMutex::new(writer),
    child: StdMutex::new(child),
  });
  state.terminals.lock().await.insert(id.clone(), handle);
  spawn_terminal_reader(app, id.clone(), reader, Arc::clone(&state.terminals));

  let conn = open_db()?;
  conn.execute(
    "INSERT OR REPLACE INTO terminal_sessions (id, project_id, topic_id, title, cwd, status, last_active_at, runtime_id) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)",
    params![id, input.project_id, input.topic_id, title, cwd.to_string_lossy().to_string(), now_iso(), runtime_id],
  ).map_err(|error| format!("Failed to store terminal session: {error}"))?;

  let mut stmt = conn.prepare("SELECT id, project_id, topic_id, title, cwd, status, last_active_at, runtime_id FROM terminal_sessions WHERE id = ?")
    .map_err(|error| format!("Failed to fetch created terminal session: {error}"))?;
  let terminal = stmt.query_row(params![id], terminal_row_to_json).map_err(|error| format!("Failed to decode created terminal session: {error}"))?;
  Ok(json!({ "terminal": terminal }))
}

#[tauri::command]
pub async fn middleware_terminal_write(
  state: State<'_, MiddlewareState>,
  input: TerminalWriteInput,
) -> Result<Value, String> {
  let terminals = state.terminals.lock().await;
  let handle = terminals.get(&input.session_id).cloned().ok_or_else(|| format!("Terminal session not found: {}", input.session_id))?;
  drop(terminals);
  handle
    .writer
    .lock()
    .map_err(|_| "Failed to lock PTY writer".to_string())?
    .write_all(input.data.as_bytes())
    .map_err(|error| format!("Failed to write to PTY: {error}"))?;
  let conn = open_db()?;
  conn.execute("UPDATE terminal_sessions SET last_active_at = ? WHERE id = ?", params![now_iso(), input.session_id])
    .map_err(|error| format!("Failed to update terminal last_active_at: {error}"))?;
  Ok(json!({ "ok": true, "sessionId": input.session_id }))
}

#[tauri::command]
pub async fn middleware_terminal_resize(
  state: State<'_, MiddlewareState>,
  input: TerminalResizeInput,
) -> Result<Value, String> {
  let terminals = state.terminals.lock().await;
  let handle = terminals.get(&input.session_id).cloned().ok_or_else(|| format!("Terminal session not found: {}", input.session_id))?;
  drop(terminals);
  handle
    .master
    .lock()
    .map_err(|_| "Failed to lock PTY master".to_string())?
    .resize(PtySize {
      rows: input.rows,
      cols: input.cols,
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|error| format!("Failed to resize PTY: {error}"))?;
  Ok(json!({ "ok": true, "sessionId": input.session_id }))
}

#[tauri::command]
pub async fn middleware_terminal_close(
  state: State<'_, MiddlewareState>,
  input: TerminalSessionInput,
) -> Result<Value, String> {
  let handle = state.terminals.lock().await.remove(&input.session_id).ok_or_else(|| format!("Terminal session not found: {}", input.session_id))?;
  handle
    .child
    .lock()
    .map_err(|_| "Failed to lock PTY child".to_string())?
    .kill()
    .map_err(|error| format!("Failed to kill PTY child: {error}"))?;
  let conn = open_db()?;
  conn.execute("UPDATE terminal_sessions SET status = 'closed', last_active_at = ? WHERE id = ?", params![now_iso(), input.session_id])
    .map_err(|error| format!("Failed to mark terminal closed: {error}"))?;
  Ok(json!({ "ok": true, "sessionId": input.session_id }))
}


