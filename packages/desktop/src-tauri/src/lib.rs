mod backend;
mod windows_toast;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(target_os = "windows")]
  std::env::set_var(
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "--enable-features=OverlayScrollbar,OverlayScrollbarFlashAfterAnyScrollUpdate",
  );

  let app = tauri::Builder::default()
    .manage(backend::BackendState::default())
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(tauri::generate_handler![windows_toast::show_reply_notification])
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
