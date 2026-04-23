use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};
use windows::{
  core::{HSTRING, IInspectable, Interface},
  Data::Xml::Dom::XmlDocument,
  Foundation::TypedEventHandler,
  UI::Notifications::{ToastActivatedEventArgs, ToastNotification, ToastNotificationManager},
};

/// Debounce: ignore duplicate activations within 500ms.
static LAST_ACTIVATION: Mutex<Option<(String, Instant)>> = Mutex::new(None);
const DEBOUNCE_MS: u64 = 500;

/// Keep the most recent ToastNotification alive so Windows can route
/// body-clicks and button-clicks back to its Activated handler.
static LAST_TOAST: Mutex<Option<ToastNotification>> = Mutex::new(None);

fn escape_xml(s: &str) -> String {
  s.replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
    .replace('\'', "&apos;")
}

fn should_emit(action: &str, session: &str) -> bool {
  let now = Instant::now();
  let key = format!("{}:{}", session, action);
  if let Ok(mut guard) = LAST_ACTIVATION.lock() {
    if let Some((last_key, last_time)) = guard.as_ref() {
      if last_key == &key && now.duration_since(*last_time) < Duration::from_millis(DEBOUNCE_MS) {
        log::info!("[windows_toast] debounced duplicate activation: {}", key);
        return false;
      }
    }
    *guard = Some((key, now));
  }
  true
}

fn get_activated_reply<R: Runtime>(
  insp: &Option<IInspectable>,
  session: &str,
  app: &AppHandle<R>,
) -> Result<(), String> {
  if let Some(insp) = insp {
    if let Ok(args) = insp.cast::<ToastActivatedEventArgs>() {
      let action = args.Arguments().unwrap_or_default().to_string();
      log::info!("[windows_toast] activated: action={}, session={}", action, session);

      if action == "send" {
        if !should_emit("send", session) {
          return Ok(());
        }
        if let Ok(user_input) = args.UserInput() {
          if let Ok(value) = user_input.Lookup(&HSTRING::from("replyText")) {
            if let Ok(prop) = value.cast::<windows::Foundation::IPropertyValue>() {
              if let Ok(text) = prop.GetString() {
                let reply = text.to_string();
                if !reply.is_empty() {
                  let _ = app.emit("toast-reply", serde_json::json!({
                    "sessionKey": session,
                    "text": reply,
                  }));
                }
              }
            }
          }
        }
      } else {
        if !should_emit("open", session) {
          return Ok(());
        }
        let _ = app.emit("toast-open", serde_json::json!({
          "sessionKey": session,
        }));
      }
    }
  }
  Ok(())
}

/// Detects whether we're running from cargo's target/debug or target/release.
#[cfg(windows)]
fn is_dev_mode() -> bool {
  use std::path::MAIN_SEPARATOR as SEP;

  let exe = match tauri::utils::platform::current_exe() {
    Ok(p) => p,
    Err(_) => return cfg!(debug_assertions),
  };
  let exe_dir = match exe.parent() {
    Some(d) => d.display().to_string(),
    None => return cfg!(debug_assertions),
  };

  exe_dir.ends_with(format!("{SEP}target{SEP}debug").as_str())
    || exe_dir.ends_with(format!("{SEP}target{SEP}release").as_str())
}

#[cfg(not(windows))]
fn is_dev_mode() -> bool {
  cfg!(debug_assertions)
}

#[tauri::command]
pub async fn show_reply_notification<R: Runtime>(
  app: AppHandle<R>,
  title: String,
  body: String,
  session_key: String,
) -> Result<(), String> {
  log::info!("[windows_toast] show_reply_notification called: title={}, session={}", title, session_key);

  let xml = XmlDocument::new().map_err(|e| e.to_string())?;

  let toast_xml = format!(
    r#"<toast activationType="foreground" launch="open">
      <visual>
        <binding template="ToastGeneric">
          <text>{}</text>
          <text>{}</text>
        </binding>
      </visual>
      <actions>
        <input id="replyText" type="text" placeHolderContent="Type a reply..." />
        <action activationType="foreground" arguments="send" content="Send" hint-inputId="replyText" />
        <action activationType="foreground" arguments="open" content="Open" />
      </actions>
    </toast>"#,
    escape_xml(&title),
    escape_xml(&body),
  );

  xml.LoadXml(&HSTRING::from(toast_xml)).map_err(|e| e.to_string())?;

  let toast = ToastNotification::CreateToastNotification(&xml).map_err(|e| e.to_string())?;

  let app_clone = app.clone();
  let session = session_key.clone();
  toast
    .Activated(&TypedEventHandler::new(move |_, insp| {
      let _ = get_activated_reply(&insp, &session, &app_clone);
      Ok(())
    }))
    .map_err(|e| e.to_string())?;

  // In dev mode, use the PowerShell AUMID fallback (same as tauri-winrt-notification).
  // This AUMID is registered with Windows COM so actions (input, buttons) work.
  // In production, use the app's real registered identifier.
  let app_id = if is_dev_mode() {
    "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"
  } else {
    app.config().identifier.as_str()
  };
  log::info!("[windows_toast] using app_id={}", app_id);

  let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))
    .map_err(|e| e.to_string())?;
  notifier.Show(&toast).map_err(|e| e.to_string())?;

  // Store the toast in a static so its Activated handler stays alive.
  if let Ok(mut guard) = LAST_TOAST.lock() {
    *guard = Some(toast);
  }

  log::info!("[windows_toast] toast shown successfully");
  Ok(())
}
