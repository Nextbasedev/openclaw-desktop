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
      middleware::middleware_openclaw_bot_name,
      middleware::middleware_openclaw_bot_name_get,
      middleware::middleware_openclaw_bot_name_set,
      middleware::middleware_request_admin_access,
      middleware::middleware_approve_admin_access,
      middleware::middleware_chat_create_session,
      middleware::middleware_chat_delete_session,
      middleware::middleware_chat_history,
      middleware::middleware_chat_send,
      middleware::middleware_chat_stream_start,
      middleware::middleware_chat_stream_stop,
      middleware::middleware_pty_spawn,
      middleware::middleware_pty_write,
      middleware::middleware_pty_resize,
      middleware::middleware_pty_kill,
      // File operations (fs_ prefix)
      middleware::middleware_fs_read_dir,
      middleware::middleware_fs_read_file,
      middleware::middleware_fs_write_file,
      middleware::middleware_fs_create_dir,
      middleware::middleware_fs_remove,
      middleware::middleware_fs_rename,
      middleware::middleware_fs_metadata,
      middleware::middleware_fs_search,
      // File operations (files_ naming)
      middleware::middleware_files_tree,
      middleware::middleware_files_read,
      middleware::middleware_files_write,
      middleware::middleware_files_mkdir,
      middleware::middleware_files_rename,
      middleware::middleware_files_delete,
      middleware::middleware_files_search,
      // Projects
      middleware::middleware_projects_list,
      middleware::middleware_projects_create,
      middleware::middleware_projects_get,
      middleware::middleware_projects_update,
      middleware::middleware_projects_archive,
      middleware::middleware_projects_sidebar,
      // Topics
      middleware::middleware_topics_list,
      middleware::middleware_topics_create,
      middleware::middleware_topics_update,
      middleware::middleware_topics_archive,
      middleware::middleware_topics_attach_session,
      middleware::middleware_topics_detach_session,
      // Sessions
      middleware::middleware_sessions_list,
      middleware::middleware_sessions_create,
      middleware::middleware_sessions_update,
      middleware::middleware_sessions_reset,
      middleware::middleware_sessions_delete,
      // Profile tokens (keychain)
      middleware::middleware_profile_token_set,
      middleware::middleware_profile_token_get,
      middleware::middleware_profile_token_delete,
      // Branch Chat commands
      middleware::middleware_branch_create,
      middleware::middleware_branch_list,
      middleware::middleware_branch_get,
      middleware::middleware_branch_delete,
      middleware::middleware_branch_from_regenerate,
      middleware::middleware_branch_from_edit,
      middleware::middleware_branch_create_thread,
      // Onboarding enhancements
      middleware::middleware_onboarding_core,
      middleware::middleware_onboarding_providers,
      middleware::middleware_onboarding_provider_types,
      middleware::middleware_onboarding_provider_details,
      middleware::middleware_onboarding_provider_submit,
      middleware::middleware_openclaw_check,
      middleware::middleware_openclaw_install,
      middleware::middleware_git_remote_add,
      middleware::middleware_git_remote_list,
      middleware::middleware_git_remote_remove,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
