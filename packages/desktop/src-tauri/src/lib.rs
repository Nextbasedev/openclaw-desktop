mod backend;
#[cfg(target_os = "windows")]
mod windows_toast;

use base64::{engine::general_purpose, Engine as _};
use tauri::Manager;

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
  let trimmed = url.trim();
  if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
    return Err("Only http(s) URLs can be opened externally".to_string());
  }

  #[cfg(target_os = "windows")]
  let result = std::process::Command::new("rundll32")
    .args(["url.dll,FileProtocolHandler", trimmed])
    .spawn();

  #[cfg(target_os = "macos")]
  let result = std::process::Command::new("open").arg(trimmed).spawn();

  #[cfg(all(unix, not(target_os = "macos")))]
  let result = std::process::Command::new("xdg-open").arg(trimmed).spawn();

  result
    .map(|_| ())
    .map_err(|err| format!("Failed to open external URL: {err}"))
}

fn sanitize_download_filename(filename: &str) -> String {
  let sanitized: String = filename
    .chars()
    .map(|ch| match ch {
      '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
      ch if ch.is_control() => '_',
      ch => ch,
    })
    .collect();
  let trimmed = sanitized.trim().trim_matches('.');
  if trimmed.is_empty() {
    "attachment".to_string()
  } else {
    trimmed.to_string()
  }
}

fn unique_download_path(dir: &std::path::Path, filename: &str) -> std::path::PathBuf {
  let candidate = dir.join(filename);
  if !candidate.exists() {
    return candidate;
  }

  let path = std::path::Path::new(filename);
  let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("attachment");
  let extension = path.extension().and_then(|value| value.to_str());

  for index in 1..10_000 {
    let next_name = match extension {
      Some(ext) if !ext.is_empty() => format!("{stem} ({index}).{ext}"),
      _ => format!("{stem} ({index})"),
    };
    let next = dir.join(next_name);
    if !next.exists() {
      return next;
    }
  }

  candidate
}

#[tauri::command]
fn save_attachment_to_downloads(
  app: tauri::AppHandle,
  filename: String,
  base64_data: String,
) -> Result<String, String> {
  let bytes = general_purpose::STANDARD
    .decode(base64_data.trim())
    .map_err(|err| format!("Invalid attachment data: {err}"))?;
  let downloads_dir = app
    .path()
    .download_dir()
    .map_err(|err| format!("Unable to resolve Downloads folder: {err}"))?;
  std::fs::create_dir_all(&downloads_dir)
    .map_err(|err| format!("Unable to create Downloads folder: {err}"))?;

  let filename = sanitize_download_filename(&filename);
  let target = unique_download_path(&downloads_dir, &filename);
  std::fs::write(&target, bytes).map_err(|err| format!("Unable to save attachment: {err}"))?;
  Ok(target.to_string_lossy().into_owned())
}

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
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build());

  #[cfg(not(target_os = "windows"))]
  let builder = builder.invoke_handler(tauri::generate_handler![
    backend::read_backend_log,
    backend::set_backend_mode,
    open_external_url,
    save_attachment_to_downloads,
  ]);

  #[cfg(target_os = "windows")]
  let builder = builder.invoke_handler(tauri::generate_handler![
    backend::read_backend_log,
    backend::set_backend_mode,
    windows_toast::show_reply_notification,
    open_external_url,
    save_attachment_to_downloads,
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
      if let Err(err) = backend::ensure_backend(&app.handle()) {
        eprintln!("OpenClaw middleware startup failed; continuing so the UI can recover: {err}");
      }
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
