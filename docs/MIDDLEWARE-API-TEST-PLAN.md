# Middleware API Test Plan

Source of truth: `packages/desktop/src-tauri/src/lib.rs` command registrations and `packages/desktop/src-tauri/src/middleware.rs` handlers.

## Goal
Validate the full desktop middleware surface with automated tests first, then targeted runtime checks where pure unit tests are insufficient.

## Test strategy

### 1. Compile gate
- Run `cargo check`
- Run `cargo test`
- This is the minimum gate for every middleware change

### 2. Rust automated tests
Best for deterministic logic and local side effects.

Cover with Rust tests:
- Filesystem commands
- SQLite project/topic/session persistence
- Admin access payload builders
- Runtime info payload
- Keychain helpers where mockable or behind a small abstraction

### 3. Runtime integration checks
Needed for features that depend on OS/runtime behavior.

Cover with runtime checks:
- PTY spawn, write, resize, kill behavior
- Keychain actual OS storage/retrieval
- Chat stream start/stop and gateway roundtrip

## Endpoint inventory and test plan

### Runtime
- `middleware_runtime_info`
- Tests:
  - returns contract metadata
  - transport/runtime fields are present

### Admin access
- `middleware_request_admin_access`
- `middleware_approve_admin_access`
- Tests:
  - request payload shape
  - approval payload shape
  - retry metadata contains expected action ids

### Chat
- `middleware_chat_create_session`
- `middleware_chat_delete_session`
- `middleware_chat_history`
- `middleware_chat_send`
- `middleware_chat_stream_start`
- `middleware_chat_stream_stop`
- Tests:
  - unit tests only for payload normalization/helpers
  - runtime integration for gateway-connected flows
- Notes:
  - requires live OpenClaw gateway/device auth flow
  - stream behavior should be tested with a controlled session

### Terminal PTY
- `middleware_pty_spawn`
- `middleware_pty_write`
- `middleware_pty_resize`
- `middleware_pty_kill`
- Tests:
  - runtime integration: spawn shell, send `echo`, verify output event
  - resize returns success
  - kill removes tracked session
- Notes:
  - PTY is OS/runtime-dependent, not ideal for pure unit tests

### Filesystem, direct fs commands
- `middleware_fs_read_dir`
- `middleware_fs_read_file`
- `middleware_fs_write_file`
- `middleware_fs_create_dir`
- `middleware_fs_remove`
- `middleware_fs_rename`
- `middleware_fs_metadata`
- `middleware_fs_search`
- Tests:
  - automated Rust tests with temp directories/files
  - verify UTF-8 read/write
  - verify directory listing shape
  - verify rename/delete
  - verify recursive search and result limit

### Filesystem aliases
- `middleware_files_tree`
- `middleware_files_read`
- `middleware_files_write`
- `middleware_files_mkdir`
- `middleware_files_rename`
- `middleware_files_delete`
- `middleware_files_search`
- Tests:
  - automated Rust tests that prove aliases behave the same as underlying fs commands

### Projects, SQLite-backed persistence
- `middleware_projects_list`
- `middleware_projects_create`
- `middleware_projects_get`
- `middleware_projects_update`
- `middleware_projects_archive`
- `middleware_projects_sidebar`
- Tests:
  - create/list/get/update/archive lifecycle
  - sidebar payload includes expected project summary
  - archived filtering works

### Topics, SQLite-backed persistence
- `middleware_topics_list`
- `middleware_topics_create`
- `middleware_topics_update`
- `middleware_topics_archive`
- `middleware_topics_attach_session`
- `middleware_topics_detach_session`
- Tests:
  - create/list/update/archive lifecycle
  - attach/detach session links persist correctly

### Sessions, SQLite-backed persistence
- `middleware_sessions_list`
- `middleware_sessions_create`
- `middleware_sessions_update`
- `middleware_sessions_reset`
- `middleware_sessions_delete`
- Tests:
  - create/list/update/delete lifecycle
  - reset clears or updates expected local state
  - topic/session link integrity after reset/delete

### Keychain profile tokens
- `middleware_profile_token_set`
- `middleware_profile_token_get`
- `middleware_profile_token_delete`
- Tests:
  - if abstracted: unit tests against a fake store
  - runtime integration: set/get/delete against OS keychain in dev environment
- Notes:
  - OS keychain behavior differs by platform
  - best split is logic/unit tests plus one real integration smoke check

## Recommended execution order
1. Filesystem automated tests
2. Filesystem alias tests
3. SQLite project/topic/session tests
4. Runtime/admin payload tests
5. Keychain tests
6. PTY runtime tests
7. Chat runtime tests

## Current known status
- Filesystem middleware has automated Rust coverage started
- PTY, SQLite, keychain, and chat still need proper endpoint-level test coverage
- Runtime-heavy features should not be marked fully verified from `cargo check` alone

## Definition of done
A middleware feature group is only "tested" when:
- `cargo check` passes
- relevant `cargo test` coverage exists and passes
- runtime-only features have at least one documented integration check
- caveats are written down where full automation is not practical
