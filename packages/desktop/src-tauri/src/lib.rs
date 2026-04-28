mod backend;
#[cfg(target_os = "windows")]
mod windows_toast;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(target_os = "windows")]
  std::env::set_var(
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "--enable-features=OverlayScrollbar,OverlayScrollbarFlashAfterAnyScrollUpdate",
  );

  let builder = tauri::Builder::default()
    .manage(backend::BackendState::default())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_dialog::init());

  #[cfg(not(target_os = "windows"))]
  let builder = builder.invoke_handler(tauri::generate_handler![
    backend::read_backend_log,
  ]);

  #[cfg(target_os = "windows")]
  let builder = builder.invoke_handler(tauri::generate_handler![
    backend::read_backend_log,
    windows_toast::show_reply_notification,
  ]);

  let app = builder
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      backend::ensure_backend(&app.handle())
        .map_err(|err| -> Box<dyn std::error::Error> {
          std::io::Error::other(err).into()
        })?;
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app_handle, event| {
    if let tauri::RunEvent::Exit = event {
      backend::stop_backend(app_handle);
    }
  });
}
