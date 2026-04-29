import * as runtime from "../services/runtime.service.js"
import * as profiles from "../services/profiles.service.js"
import * as projects from "../services/projects.service.js"
import * as topics from "../services/topics.service.js"
import * as sessions from "../services/sessions.service.js"
import * as branches from "../services/branches.service.js"
import * as files from "../services/files.service.js"
import * as fsRaw from "../services/fs.service.js"
import * as git from "../services/git.service.js"
import * as memory from "../services/memory.service.js"
import * as skills from "../services/skills.service.js"
import * as skillRuntime from "../services/skill-runtime.service.js"
import * as chats from "../services/chats.service.js"
import * as autonaming from "../services/autonaming.service.js"
import * as recent from "../services/recent.service.js"
import * as chat from "../services/chat.service.js"
import * as cron from "../services/cron.service.js"
import * as sync from "../services/sync.service.js"
import * as usage from "../services/usage.service.js"
import * as onboarding from "../services/onboarding.service.js"
import * as connect from "../services/connect.service.js"
import * as terminal from "../services/terminal.service.js"
import * as ptyService from "../services/pty.service.js"
import * as models from "../services/models.service.js"
import * as repos from "../services/repos.service.js"
import * as version from "../services/version.service.js"
import * as sandbox from "../services/sandbox.service.js"
import * as pins from "../services/pins.service.js"
import * as feedback from "../services/feedback.service.js"

type Handler = (input: Record<string, unknown>) => unknown | Promise<unknown>

export const commandRegistry: Record<string, Handler> = {
  // Runtime
  middleware_runtime_info: () => runtime.runtimeInfo(),
  middleware_openclaw_bot_name: () => runtime.botName(),
  middleware_openclaw_bot_name_get: () => runtime.botNameGet(),
  middleware_openclaw_bot_name_set: (i) => runtime.botNameSet(i as { botName: string }),
  middleware_request_admin_access: (i) => runtime.requestAdminAccess(i as { actionId: string; actionLabel?: string }),
  middleware_approve_admin_access: (i) => runtime.approveAdminAccess(i as { actionId: string }),

  // Profiles
  middleware_profiles_list: () => profiles.profilesList(),
  middleware_profiles_create: (i) => profiles.profilesCreate(i as Parameters<typeof profiles.profilesCreate>[0]),
  middleware_profiles_update: (i) => profiles.profilesUpdate(i as Parameters<typeof profiles.profilesUpdate>[0]),
  middleware_profiles_delete: (i) => profiles.profilesDelete(i as { profileId: string }),
  middleware_profile_token_set: (i) => profiles.profileTokenSet(i as { profileId: string; token: string }),
  middleware_profile_token_get: (i) => profiles.profileTokenGet(i as { profileId: string }),
  middleware_profile_token_delete: (i) => profiles.profileTokenDelete(i as { profileId: string }),

  // Environment
  middleware_environment_connect: (i) => profiles.environmentConnect(i as { profileId: string }),
  middleware_environment_status: (i) => profiles.environmentStatus(i as { profileId: string }),
  middleware_environment_detect: (i) => profiles.environmentDetect(i as { profileId: string }),

  // Projects
  middleware_projects_list: () => projects.projectsList(),
  middleware_projects_create: (i) => projects.projectsCreate(i as Parameters<typeof projects.projectsCreate>[0]),
  middleware_projects_get: (i) => projects.projectsGet(i as { projectId: string }),
  middleware_projects_update: (i) => projects.projectsUpdate(i as Parameters<typeof projects.projectsUpdate>[0]),
  middleware_projects_archive: (i) => projects.projectsArchive(i as { projectId: string; archived?: boolean }),
  middleware_projects_pin: (i) => projects.projectsPin(i as { projectId: string; pinned?: boolean }),
  middleware_projects_delete: (i) => projects.projectsDelete(i as { projectId: string }),
  middleware_projects_sidebar: (i) => projects.projectsSidebar(i as { projectId: string }),

  // Topics
  middleware_topics_list: (i) => topics.topicsList(i as { projectId: string }),
  middleware_topics_create: (i) => topics.topicsCreate(i as { projectId: string; name: string }),
  middleware_topics_update: (i) => topics.topicsUpdate(i as Parameters<typeof topics.topicsUpdate>[0]),
  middleware_topics_archive: (i) => topics.topicsArchive(i as { topicId: string; archived?: boolean }),
  middleware_topics_delete: (i) => topics.topicsDelete(i as { topicId: string }),
  middleware_topics_attach_session: (i) => topics.topicsAttachSession(i as { topicId: string; sessionKey: string }),
  middleware_topics_rename: (i) => topics.topicsRename(i as { topicId: string; name: string }),
  middleware_topics_detach_session: (i) => topics.topicsDetachSession(i as { topicId: string; sessionKey: string }),

  // Sessions
  middleware_sessions_list: (i) => sessions.sessionsList(i as Parameters<typeof sessions.sessionsList>[0]),
  middleware_sessions_create: (i) => sessions.sessionsCreate(i as Parameters<typeof sessions.sessionsCreate>[0]),
  middleware_sessions_update: (i) => sessions.sessionsUpdate(i as Parameters<typeof sessions.sessionsUpdate>[0]),
  middleware_sessions_delete: (i) => sessions.sessionsDelete(i as { sessionKey: string }),

  // Branches
  middleware_branch_create: (i) => branches.branchCreate(i as Parameters<typeof branches.branchCreate>[0]),
  middleware_branch_list: (i) => branches.branchList(i as { sourceSessionKey: string }),
  middleware_branch_get: (i) => branches.branchGet(i as { branchSessionKey: string }),
  middleware_branch_delete: (i) => branches.branchDelete(i as { branchSessionKey: string }),
  middleware_branch_from_regenerate: (i) => branches.branchFromRegenerate(i as Parameters<typeof branches.branchFromRegenerate>[0]),
  middleware_branch_from_edit: (i) => branches.branchFromEdit(i as Parameters<typeof branches.branchFromEdit>[0]),
  middleware_branch_create_thread: (i) => branches.branchCreateThread(i as Parameters<typeof branches.branchCreateThread>[0]),

  // Files (project-scoped)
  middleware_files_tree: (i) => files.filesTree(i as { projectId: string; path: string }),
  middleware_files_read: (i) => files.filesRead(i as { projectId: string; path: string }),
  middleware_files_prepare_attachment: (i) => files.filesPrepareAttachment(i as { projectId: string; path: string }),
  middleware_files_write: (i) => files.filesWrite(i as { projectId: string; path: string; content: string }),
  middleware_files_mkdir: (i) => files.filesMkdir(i as { projectId: string; path: string }),
  middleware_files_rename: (i) => files.filesRename(i as { projectId: string; from: string; to: string }),
  middleware_files_delete: (i) => files.filesDelete(i as { projectId: string; path: string }),
  middleware_files_search: (i) => files.filesSearch(i as { projectId: string; query: string }),

  // Filesystem (raw, absolute paths)
  middleware_fs_read_dir: (i) => fsRaw.fsReadDir(i as { path: string }),
  middleware_fs_read_file: (i) => fsRaw.fsReadFile(i as { path: string }),
  middleware_fs_prepare_attachment: (i) => fsRaw.fsPrepareAttachment(i as { path: string }),
  middleware_fs_write_file: (i) => fsRaw.fsWriteFile(i as { path: string; content: string }),
  middleware_fs_create_dir: (i) => fsRaw.fsCreateDir(i as { path: string; recursive?: boolean }),
  middleware_fs_remove: (i) => fsRaw.fsRemove(i as { path: string; recursive?: boolean }),
  middleware_fs_rename: (i) => fsRaw.fsRename(i as { oldPath: string; newPath: string }),
  middleware_fs_metadata: (i) => fsRaw.fsMetadata(i as { path: string }),
  middleware_fs_search: (i) => fsRaw.fsSearch(i as { path: string; query: string; maxResults?: number }),

  // Git
  middleware_git_remote_add: (i) => git.gitRemoteAdd(i as Parameters<typeof git.gitRemoteAdd>[0]),
  middleware_git_remote_list: (i) => git.gitRemoteList(i as { projectId: string }),
  middleware_git_remote_remove: (i) => git.gitRemoteRemove(i as Parameters<typeof git.gitRemoteRemove>[0]),
  middleware_git_context: (i) => git.gitContext(i as { projectId?: string; topicId?: string }),
  middleware_git_switch_branch: (i) => git.gitSwitchBranch(i as Parameters<typeof git.gitSwitchBranch>[0]),
  middleware_git_branches: (i) => git.gitBranches(i as { projectId: string }),
  middleware_git_commit_details: (i) => git.gitCommitDetails(i as { projectId: string; hash: string }),

  // Memory
  middleware_memory_list: (i) => memory.memoryList(i as { projectId?: string }),
  middleware_memory_read: (i) => memory.memoryRead(i as Parameters<typeof memory.memoryRead>[0]),
  middleware_memory_write: (i) => memory.memoryWrite(i as Parameters<typeof memory.memoryWrite>[0]),
  middleware_memory_search: (i) => memory.memorySearch(i as Parameters<typeof memory.memorySearch>[0]),
  middleware_memory_store: (i) => memory.memoryStore(i as Parameters<typeof memory.memoryStore>[0]),
  middleware_memory_recall: (i) => memory.memoryRecall(i as Parameters<typeof memory.memoryRecall>[0]),
  middleware_memory_reindex: () => memory.memoryReindex(),

  // Skills
  middleware_skills_discover: (i) => skills.skillsDiscover(i as Parameters<typeof skills.skillsDiscover>[0]),
  middleware_skills_detail: (i) => skills.skillsDetail(i as { slug: string }),
  middleware_skills_versions: (i) => skills.skillsVersions(i as { slug: string; limit?: number; cursor?: string }),
  middleware_skills_install: (i) => skills.skillsInstall(i as Parameters<typeof skills.skillsInstall>[0]),
  middleware_skills_installed: (i) => skills.skillsInstalled(i as Parameters<typeof skills.skillsInstalled>[0]),
  middleware_skills_search_hub: (i) => skills.skillsSearchHub(i as Parameters<typeof skills.skillsSearchHub>[0]),
  middleware_skills_catalog: () => skills.getSkillCatalog(),
  middleware_skills_catalog_add: (i) => skills.addSkillToCatalog(i as Parameters<typeof skills.addSkillToCatalog>[0]),
  middleware_skills_catalog_remove: (i) => skills.removeSkillFromCatalog((i as { slug: string }).slug),
  middleware_skills_active: () => skillRuntime.getInstalledSkills(),
  middleware_skills_toggle: (i) => skillRuntime.setSkillEnabled((i as { slug: string; enabled: boolean }).slug, (i as { slug: string; enabled: boolean }).enabled),
  middleware_skills_enabled_map: () => skillRuntime.getSkillEnabledMap(),
  middleware_commands_list: (i) => skills.commandsList(i as Parameters<typeof skills.commandsList>[0]),
  middleware_tools_catalog: (i) => skills.toolsCatalog(i as Parameters<typeof skills.toolsCatalog>[0]),

  // Standalone Chats
  middleware_chats_list: (i) => chats.chatsList(i as { archived?: boolean } | undefined),
  middleware_chats_create: (i) => chats.chatsCreate(i as Parameters<typeof chats.chatsCreate>[0]),
  middleware_chats_get: (i) => chats.chatsGet(i as { chatId: string }),
  middleware_chats_update: (i) => chats.chatsUpdate(i as Parameters<typeof chats.chatsUpdate>[0]),
  middleware_chats_rename: (i) => chats.chatsRename(i as { chatId: string; name: string }),
  middleware_chats_archive: (i) => chats.chatsArchive(i as { chatId: string; archived?: boolean }),
  middleware_chats_delete: (i) => chats.chatsDelete(i as { chatId: string }),
  middleware_chats_attach_session: (i) => chats.chatsAttachSession(i as { chatId: string; sessionKey: string }),
  middleware_chats_update_activity: (i) => chats.chatsUpdateActivity(i as { chatId: string }),

  // Auto-naming
  middleware_autonaming_generate: (i) => autonaming.generateConversationName(i as { sessionKey: string; firstMessage: string }),
  middleware_autonaming_quick: (i) => autonaming.quickName(i as { text: string }),

  // Recent feed
  middleware_recent_list: (i) => recent.recentList(i as { limit?: number; includeArchived?: boolean } | undefined),

  // Chat (Gateway-dependent)
  middleware_chat_create_session: (i) => chat.chatCreateSession(i as Parameters<typeof chat.chatCreateSession>[0]),
  middleware_chat_delete_session: (i) => chat.chatDeleteSession(i as { sessionKey: string }),
  middleware_chat_send: (i) => chat.chatSend(i as Parameters<typeof chat.chatSend>[0]),
  middleware_chat_stop: (i) => chat.chatStop(i as { sessionKey: string }),
  middleware_chat_history: (i) => chat.chatHistory(i as { sessionKey: string }),
  middleware_chat_edit_and_resend: (i) => chat.chatEditAndResend(i as Parameters<typeof chat.chatEditAndResend>[0]),
  middleware_chat_regenerate: (i) => chat.chatRegenerate(i as Parameters<typeof chat.chatRegenerate>[0]),
  middleware_chat_start_subagent_stream: (i) => chat.chatStartSubagentStream(i as { sessionKey: string }),
  middleware_chat_fork: (i) => chat.chatFork(i as Parameters<typeof chat.chatFork>[0]),
  middleware_chat_fork_history: (i) => chat.chatForkHistory(i as { sessionKey: string }),

  // Cron (Gateway-dependent)
  middleware_cron_list_jobs: () => cron.cronListJobs(),
  middleware_cron_recent_activity: (i) => cron.cronRecentActivity(i as { limit?: number } | undefined),
  middleware_cron_get_job: (i) => cron.cronGetJob(i as { jobId: string }),
  middleware_cron_create_job: (i) => cron.cronCreateJob(i as Parameters<typeof cron.cronCreateJob>[0]),
  middleware_cron_update_job: (i) => cron.cronUpdateJob(i as Parameters<typeof cron.cronUpdateJob>[0]),
  middleware_cron_delete_job: (i) => cron.cronDeleteJob(i as { jobId: string }),
  middleware_cron_run_job: (i) => cron.cronRunJob(i as Parameters<typeof cron.cronRunJob>[0]),
  middleware_cron_job_status: (i) => cron.cronJobStatus(i as { jobId: string }),
  middleware_cron_list_runs: (i) => cron.cronListRuns(i as Parameters<typeof cron.cronListRuns>[0]),
  middleware_cron_get_run: (i) => cron.cronGetRun(i as Parameters<typeof cron.cronGetRun>[0]),
  middleware_cron_pause_job: (i) => cron.cronPauseJob(i as { jobId: string; paused: boolean }),
  middleware_cron_poll_run_completion: (i) => cron.cronPollRunCompletion(i as Parameters<typeof cron.cronPollRunCompletion>[0]),
  middleware_cron_create_notification_job: (i) => cron.cronCreateNotificationJob(i as Parameters<typeof cron.cronCreateNotificationJob>[0]),
  middleware_cron_job_conversation: (i) => cron.cronJobConversation(i as { jobId: string }),

  // Sync
  middleware_sync_status: () => sync.syncStatus(),
  middleware_sync_mark_clean: (i) => sync.syncMarkClean(i as { table: string; ids: string[] }),
  middleware_sync_purge_tombstones: () => sync.syncPurgeTombstones(),
  middleware_sync_set_device_id: (i) => sync.syncSetDeviceId(i as { deviceId: string }),
  middleware_sync_pull_now: () => sync.syncPullNow(),
  middleware_sync_push_now: (i) => sync.syncPushNow(i as { limit?: number } | undefined),
  middleware_sync_backfill_now: () => sync.syncBackfillNow(),

  // Usage (Gateway-dependent)
  middleware_usage_summary: (i) => usage.usageSummary(i as { startDate?: string; endDate?: string }),
  middleware_usage_current: () => usage.usageCurrent(),
  middleware_usage_history: (i) => usage.usageHistory(i as { period?: string }),
  middleware_usage_limits: () => usage.usageLimits(),
  middleware_usage_estimate: (i) => usage.usageEstimate(i as { model?: string; tokens?: number }),

  // Onboarding
  middleware_onboarding_status: () => onboarding.onboardingStatus(),
  middleware_onboarding_set_step: (i) => onboarding.onboardingSetStep(i as { step: string }),
  middleware_onboarding_complete: () => onboarding.onboardingComplete(),
  middleware_onboarding_reset: () => onboarding.onboardingReset(),
  middleware_onboarding_check_gateway: () => onboarding.onboardingCheckGateway(),
  middleware_onboarding_check_identity: () => onboarding.onboardingCheckIdentity(),
  middleware_onboarding_check_workspace: () => onboarding.onboardingCheckWorkspace(),
  middleware_onboarding_validate_gateway_url: (i) => onboarding.onboardingValidateGatewayUrl(i as { url: string }),
  middleware_onboarding_create_workspace: () => onboarding.onboardingCreateWorkspace(),
  middleware_onboarding_check_dependencies: () => onboarding.onboardingCheckDependencies(),
  middleware_onboarding_save_gateway_config: (i) => onboarding.onboardingSaveGatewayConfig(i as { gatewayUrl: string; token?: string }),
  middleware_onboarding_generate_identity: () => onboarding.onboardingGenerateIdentity(),
  middleware_onboarding_core: (i) => onboarding.onboardingCore(i as { action?: string; gatewayUrl?: string }),
  middleware_onboarding_providers: () => onboarding.onboardingProviders(),
  middleware_onboarding_provider_types: () => onboarding.onboardingProviderTypes(),
  middleware_onboarding_provider_details: (i) => onboarding.onboardingProviderDetails(i as { providerId: string }),
  middleware_onboarding_provider_submit: (i) => onboarding.onboardingProviderSubmit(i as Parameters<typeof onboarding.onboardingProviderSubmit>[0]),
  middleware_onboarding_model_contract: (i) => onboarding.onboardingModelContract(i as { providerId?: string } | undefined),
  middleware_onboarding_model_submit: (i) => onboarding.onboardingModelSubmit(i as Parameters<typeof onboarding.onboardingModelSubmit>[0]),
  middleware_onboarding_flow: (i) => onboarding.onboardingFlow(i as { action?: string; gatewayUrl?: string } | undefined),
  middleware_onboarding_sign_out: () => onboarding.onboardingSignOut(),
  middleware_onboarding_delete_account: () => onboarding.onboardingDeleteAccount(),

  // Connect
  middleware_connect_status: () => connect.connectStatus(),
  middleware_connect_test: () => connect.connectTest(),
  middleware_connect_disconnect: () => connect.connectDisconnect(),
  middleware_connect_bootstrap: () => connect.connectBootstrap(),
  middleware_connect_reset: () => connect.connectReset(),

  // Terminal
  middleware_terminal_create: (i) => terminal.terminalCreate(i as Parameters<typeof terminal.terminalCreate>[0]),
  middleware_terminal_list: (i) => terminal.terminalList(i as { projectId: string }),
  middleware_terminal_write: (i) => terminal.terminalWrite(i as { sessionId: string; data: string }),
  middleware_terminal_resize: (i) => terminal.terminalResize(i as { sessionId: string; cols: number; rows: number }),
  middleware_terminal_close: (i) => terminal.terminalClose(i as { sessionId: string }),

  // PTY (ephemeral)
  middleware_pty_spawn: (i) => ptyService.ptySpawn(i as Parameters<typeof ptyService.ptySpawn>[0]),
  middleware_pty_write: (i) => ptyService.ptyWrite(i as { ptyId: string; data: string }),
  middleware_pty_resize: (i) => ptyService.ptyResize(i as { ptyId: string; cols: number; rows: number }),
  middleware_pty_kill: (i) => ptyService.ptyKill(i as { ptyId: string }),

  // Models (Gateway-dependent)
  middleware_models_list: () => models.modelsList(),
  middleware_models_auth_status: () => models.modelsAuthStatus(),
  middleware_models_set_default: (i) => models.modelsSetDefault(i as { modelId: string }),

  // Repos
  middleware_repos_scan: (i) => repos.reposScan(i as { extraPaths?: string[] } | undefined),
  middleware_repos_recent: (i) => repos.reposRecent(i as { limit?: number } | undefined),
  middleware_repos_select: (i) => repos.reposSelect(i as { path: string; name: string }),

  // Version
  middleware_version_info: () => version.versionInfo(),

  // Sandbox
  middleware_sandbox_cleanup_audit_data: (i) => sandbox.sandboxCleanupAuditData(i as { dryRun?: boolean } | undefined),

  // Pinned Messages
  middleware_pins_list: (i) => pins.pinsList(i as { sessionKey: string }),
  middleware_pins_add: (i) => pins.pinsAdd(i as { sessionKey: string; messageId: string; messageText: string }),
  middleware_pins_remove: (i) => pins.pinsRemove(i as { sessionKey: string; messageId: string; messageText?: string }),

  // Feedback
  middleware_message_feedback: (i) => feedback.messageFeedback(i as any),
  middleware_message_feedback_delete: (i) => feedback.deleteMessageFeedback(i as any),
}
