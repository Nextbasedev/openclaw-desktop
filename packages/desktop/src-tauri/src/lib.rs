mod middleware;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(middleware::MiddlewareState::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      middleware::middleware_runtime_info,
      middleware::middleware_request_admin_access,
      middleware::middleware_approve_admin_access,
      middleware::middleware_chat_create_session,
      middleware::middleware_chat_delete_session,
      middleware::middleware_chat_history,
      middleware::middleware_chat_send,
      middleware::middleware_chat_stream_start,
      middleware::middleware_chat_stream_stop
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
