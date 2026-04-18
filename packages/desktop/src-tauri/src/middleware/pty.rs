use super::*;

pub(crate) fn emit_pty_event(app: &AppHandle, pty_id: &str, event: Value) {
  let _ = app.emit(
    PTY_STREAM_EVENT_NAME,
    json!({
      "ptyId": pty_id,
      "event": event,
    }),
  );
}


#[tauri::command]
pub async fn middleware_pty_spawn(
  app: AppHandle,
  state: State<'_, MiddlewareState>,
  input: PtySpawnInput,
) -> Result<Value, String> {
  let cwd = input
    .cwd
    .clone()
    .map(PathBuf::from)
    .unwrap_or(std::env::current_dir().map_err(|e| format!("Failed to resolve current dir: {e}"))?);
  let pty_system = native_pty_system();
  let pair = pty_system
    .openpty(PtySize {
      rows: input.rows.unwrap_or(24),
      cols: input.cols.unwrap_or(80),
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|e| format!("Failed to open PTY: {e}"))?;

  let shell = input.shell.unwrap_or_else(shell_command);
  let mut command = CommandBuilder::new(shell);
  command.cwd(cwd.clone());
  let child = pair.slave.spawn_command(command).map_err(|e| format!("Failed to spawn shell: {e}"))?;
  let reader = pair.master.try_clone_reader().map_err(|e| format!("Failed to create PTY reader: {e}"))?;
  let writer = pair.master.take_writer().map_err(|e| format!("Failed to create PTY writer: {e}"))?;

  let pty_id = format!("pty_{}", Uuid::new_v4().simple());
  let handle = Arc::new(TerminalHandle {
    master: StdMutex::new(pair.master),
    writer: StdMutex::new(writer),
    child: StdMutex::new(child),
  });
  state.terminals.lock().await.insert(pty_id.clone(), handle);
  spawn_pty_reader(app, pty_id.clone(), reader);

  Ok(json!({ "ptyId": pty_id, "cwd": cwd.to_string_lossy().to_string() }))
}

#[tauri::command]
pub async fn middleware_pty_write(
  state: State<'_, MiddlewareState>,
  input: PtyWriteInput,
) -> Result<Value, String> {
  let terminals = state.terminals.lock().await;
  let handle = terminals.get(&input.pty_id).cloned().ok_or_else(|| format!("PTY session not found: {}", input.pty_id))?;
  drop(terminals);
  handle
    .writer
    .lock()
    .map_err(|_| "Failed to lock PTY writer".to_string())?
    .write_all(input.data.as_bytes())
    .map_err(|e| format!("Failed to write to PTY: {e}"))?;
  Ok(json!({ "written": true, "ptyId": input.pty_id }))
}

#[tauri::command]
pub async fn middleware_pty_resize(
  state: State<'_, MiddlewareState>,
  input: PtyResizeInput,
) -> Result<Value, String> {
  let terminals = state.terminals.lock().await;
  let handle = terminals.get(&input.pty_id).cloned().ok_or_else(|| format!("PTY session not found: {}", input.pty_id))?;
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
    .map_err(|e| format!("Failed to resize PTY: {e}"))?;
  Ok(json!({ "resized": true, "ptyId": input.pty_id }))
}

#[tauri::command]
pub async fn middleware_pty_kill(
  state: State<'_, MiddlewareState>,
  input: PtyKillInput,
) -> Result<Value, String> {
  let handle = state.terminals.lock().await.remove(&input.pty_id);
  if let Some(handle) = handle {
    let _ = handle.child.lock().map_err(|_| "Failed to lock PTY child".to_string())?.kill();
    return Ok(json!({ "killed": true, "ptyId": input.pty_id }));
  }
  Ok(json!({ "killed": false, "ptyId": input.pty_id }))
}


