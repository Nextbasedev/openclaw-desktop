use super::*;

// SYNC: Input structs


// ============================================================================
// SYNC ENGINE
// ============================================================================

pub(crate) fn snapshot_dirty_entities(conn: &Connection, device_id: &str) -> Result<LocalSnapshot, String> {
  let mut projects = Vec::new();
  {
    let mut stmt = conn
      .prepare("SELECT id, name, profile_id, workspace_root, repo_root, archived, updated_at FROM projects WHERE sync_dirty = 1")
      .map_err(|e| format!("Failed to query dirty projects: {e}"))?;
    let rows = stmt
      .query_map([], |row| {
        Ok(SyncProject {
          id: row.get(0)?,
          name: row.get(1)?,
          profile_id: row.get(2)?,
          workspace_root: row.get(3)?,
          repo_root: row.get(4)?,
          archived: sql_to_bool(row.get::<_, i64>(5)?),
          updated_at: row.get(6)?,
          updated_by: device_id.to_string(),
        })
      })
      .map_err(|e| format!("Failed to read dirty projects: {e}"))?;
    for row in rows {
      projects.push(row.map_err(|e| format!("Failed to decode dirty project: {e}"))?);
    }
  }

  let mut topics = Vec::new();
  {
    let mut stmt = conn
      .prepare("SELECT id, project_id, name, archived, sort_order, updated_at FROM topics WHERE sync_dirty = 1")
      .map_err(|e| format!("Failed to query dirty topics: {e}"))?;
    let rows = stmt
      .query_map([], |row| {
        Ok(SyncTopic {
          id: row.get(0)?,
          project_id: row.get(1)?,
          name: row.get(2)?,
          archived: sql_to_bool(row.get::<_, i64>(3)?),
          sort_order: row.get(4)?,
          updated_at: row.get(5)?,
          updated_by: device_id.to_string(),
        })
      })
      .map_err(|e| format!("Failed to read dirty topics: {e}"))?;
    for row in rows {
      topics.push(row.map_err(|e| format!("Failed to decode dirty topic: {e}"))?);
    }
  }

  let mut session_mappings = Vec::new();
  {
    let mut stmt = conn
      .prepare("SELECT session_key, session_id, project_id, topic_id, agent_id, label, status, pinned, hidden, source, updated_at FROM session_mappings WHERE sync_dirty = 1")
      .map_err(|e| format!("Failed to query dirty session mappings: {e}"))?;
    let rows = stmt
      .query_map([], |row| {
        Ok(SyncSessionMapping {
          session_key: row.get(0)?,
          session_id: row.get(1)?,
          project_id: row.get(2)?,
          topic_id: row.get(3)?,
          agent_id: row.get(4)?,
          label: row.get(5)?,
          status: row.get(6)?,
          pinned: sql_to_bool(row.get::<_, i64>(7)?),
          hidden: sql_to_bool(row.get::<_, i64>(8)?),
          source: row.get(9)?,
          updated_at: row.get(10)?,
          updated_by: device_id.to_string(),
        })
      })
      .map_err(|e| format!("Failed to read dirty session mappings: {e}"))?;
    for row in rows {
      session_mappings.push(row.map_err(|e| format!("Failed to decode dirty session mapping: {e}"))?);
    }
  }

  let mut branches = Vec::new();
  {
    let mut stmt = conn
      .prepare("SELECT id, source_session_key, source_message_id, branch_session_key, branch_topic_id, branch_reason, created_at FROM branches WHERE sync_dirty = 1")
      .map_err(|e| format!("Failed to query dirty branches: {e}"))?;
    let rows = stmt
      .query_map([], |row| {
        let created_at: String = row.get(6)?;
        Ok(SyncBranch {
          id: row.get(0)?,
          source_session_key: row.get(1)?,
          source_message_id: row.get(2)?,
          branch_session_key: row.get(3)?,
          branch_topic_id: row.get(4)?,
          branch_reason: row.get(5)?,
          created_at: created_at.clone(),
          updated_at: created_at,
          updated_by: device_id.to_string(),
        })
      })
      .map_err(|e| format!("Failed to read dirty branches: {e}"))?;
    for row in rows {
      branches.push(row.map_err(|e| format!("Failed to decode dirty branch: {e}"))?);
    }
  }

  let mut tombstones = Vec::new();
  {
    let mut stmt = conn
      .prepare("SELECT entity_type, entity_id, deleted_at, deleted_by, expires_at FROM sync_tombstones WHERE expires_at > ?")
      .map_err(|e| format!("Failed to query tombstones: {e}"))?;
    let rows = stmt
      .query_map(params![now_iso()], |row| {
        Ok(SyncTombstone {
          entity_type: row.get(0)?,
          entity_id: row.get(1)?,
          deleted_at: row.get(2)?,
          deleted_by: row.get(3)?,
          expires_at: row.get(4)?,
        })
      })
      .map_err(|e| format!("Failed to read tombstones: {e}"))?;
    for row in rows {
      tombstones.push(row.map_err(|e| format!("Failed to decode tombstone: {e}"))?);
    }
  }

  Ok(LocalSnapshot { projects, topics, session_mappings, branches, tombstones })
}

pub(crate) fn merge_sync_states(
  local: &LocalSnapshot,
  remote: &SyncState,
  device_id: &str,
  device_name: &str,
) -> MergeResult {
  let mut merged = remote.clone();
  let mut to_upsert_locally: Vec<MergeEntity> = Vec::new();
  let mut to_delete_locally: Vec<(String, String)> = Vec::new();
  let mut pulled: usize = 0;
  let mut pushed: usize = 0;
  let mut pushed_project_ids: Vec<String> = Vec::new();
  let mut pushed_topic_ids: Vec<String> = Vec::new();
  let mut pushed_session_keys: Vec<String> = Vec::new();
  let mut pushed_branch_ids: Vec<String> = Vec::new();

  // Merge projects
  for lp in &local.projects {
    match merged.projects.get(&lp.id) {
      Some(rp) if rp.updated_at >= lp.updated_at => {}
      _ => {
        merged.projects.insert(lp.id.clone(), lp.clone());
        pushed_project_ids.push(lp.id.clone());
        pushed += 1;
      }
    }
  }
  for (id, rp) in &remote.projects {
    if !local.projects.iter().any(|lp| lp.id == *id) {
      to_upsert_locally.push(MergeEntity::Project(rp.clone()));
      pulled += 1;
    } else {
      let lp = local.projects.iter().find(|lp| lp.id == *id).unwrap();
      if rp.updated_at > lp.updated_at {
        to_upsert_locally.push(MergeEntity::Project(rp.clone()));
        pulled += 1;
      }
    }
  }

  // Merge topics
  for lt in &local.topics {
    match merged.topics.get(&lt.id) {
      Some(rt) if rt.updated_at >= lt.updated_at => {}
      _ => {
        merged.topics.insert(lt.id.clone(), lt.clone());
        pushed_topic_ids.push(lt.id.clone());
        pushed += 1;
      }
    }
  }
  for (id, rt) in &remote.topics {
    if !local.topics.iter().any(|lt| lt.id == *id) {
      to_upsert_locally.push(MergeEntity::Topic(rt.clone()));
      pulled += 1;
    } else {
      let lt = local.topics.iter().find(|lt| lt.id == *id).unwrap();
      if rt.updated_at > lt.updated_at {
        to_upsert_locally.push(MergeEntity::Topic(rt.clone()));
        pulled += 1;
      }
    }
  }

  // Merge session mappings
  for ls in &local.session_mappings {
    match merged.session_mappings.get(&ls.session_key) {
      Some(rs) if rs.updated_at >= ls.updated_at => {}
      _ => {
        merged.session_mappings.insert(ls.session_key.clone(), ls.clone());
        pushed_session_keys.push(ls.session_key.clone());
        pushed += 1;
      }
    }
  }
  for (key, rs) in &remote.session_mappings {
    if !local.session_mappings.iter().any(|ls| ls.session_key == *key) {
      to_upsert_locally.push(MergeEntity::SessionMapping(rs.clone()));
      pulled += 1;
    } else {
      let ls = local.session_mappings.iter().find(|ls| ls.session_key == *key).unwrap();
      if rs.updated_at > ls.updated_at {
        to_upsert_locally.push(MergeEntity::SessionMapping(rs.clone()));
        pulled += 1;
      }
    }
  }

  // Merge branches
  for lb in &local.branches {
    match merged.branches.get(&lb.branch_session_key) {
      Some(rb) if rb.updated_at >= lb.updated_at => {}
      _ => {
        merged.branches.insert(lb.branch_session_key.clone(), lb.clone());
        pushed_branch_ids.push(lb.id.clone());
        pushed += 1;
      }
    }
  }
  for (key, rb) in &remote.branches {
    if !local.branches.iter().any(|lb| lb.branch_session_key == *key) {
      to_upsert_locally.push(MergeEntity::Branch(rb.clone()));
      pulled += 1;
    } else {
      let lb = local.branches.iter().find(|lb| lb.branch_session_key == *key).unwrap();
      if rb.updated_at > lb.updated_at {
        to_upsert_locally.push(MergeEntity::Branch(rb.clone()));
        pulled += 1;
      }
    }
  }

  // Merge tombstones: combine all non-expired tombstones
  let now = now_iso();
  let mut all_tombstones: HashMap<(String, String), SyncTombstone> = HashMap::new();
  for t in &remote.tombstones {
    if t.expires_at > now {
      all_tombstones.insert((t.entity_type.clone(), t.entity_id.clone()), t.clone());
    }
  }
  for t in &local.tombstones {
    if t.expires_at > now {
      let key = (t.entity_type.clone(), t.entity_id.clone());
      match all_tombstones.get(&key) {
        Some(existing) if existing.deleted_at >= t.deleted_at => {}
        _ => { all_tombstones.insert(key, t.clone()); }
      }
    }
  }

  // Apply tombstones: remove entities that have been deleted
  for ((etype, eid), tombstone) in &all_tombstones {
    match etype.as_str() {
      "project" => {
        if let Some(p) = merged.projects.get(eid) {
          if tombstone.deleted_at > p.updated_at {
            merged.projects.remove(eid);
            to_delete_locally.push((etype.clone(), eid.clone()));
          }
        }
      }
      "topic" => {
        if let Some(t) = merged.topics.get(eid) {
          if tombstone.deleted_at > t.updated_at {
            merged.topics.remove(eid);
            to_delete_locally.push((etype.clone(), eid.clone()));
          }
        }
      }
      "session_mapping" => {
        if let Some(s) = merged.session_mappings.get(eid) {
          if tombstone.deleted_at > s.updated_at {
            merged.session_mappings.remove(eid);
            to_delete_locally.push((etype.clone(), eid.clone()));
          }
        }
      }
      "branch" => {
        if let Some(b) = merged.branches.get(eid) {
          if tombstone.deleted_at > b.updated_at {
            merged.branches.remove(eid);
            to_delete_locally.push((etype.clone(), eid.clone()));
          }
        }
      }
      _ => {}
    }
  }

  // Remove upserts for entities that were tombstoned
  let delete_set: HashSet<(String, String)> = to_delete_locally.iter().cloned().collect();
  to_upsert_locally.retain(|entity| {
    let key = match entity {
      MergeEntity::Project(p) => ("project".to_string(), p.id.clone()),
      MergeEntity::Topic(t) => ("topic".to_string(), t.id.clone()),
      MergeEntity::SessionMapping(s) => ("session_mapping".to_string(), s.session_key.clone()),
      MergeEntity::Branch(b) => ("branch".to_string(), b.branch_session_key.clone()),
    };
    !delete_set.contains(&key)
  });

  merged.tombstones = all_tombstones.into_values().collect();
  merged.last_writer = SyncLastWriter {
    device_id: device_id.to_string(),
    device_name: device_name.to_string(),
    written_at: now_iso(),
  };

  MergeResult {
    to_upsert_locally,
    to_delete_locally,
    new_remote_state: merged,
    pulled,
    pushed,
    pushed_project_ids,
    pushed_topic_ids,
    pushed_session_keys,
    pushed_branch_ids,
  }
}

pub(crate) fn apply_sync_changes(conn: &Connection, result: &MergeResult) -> Result<(), String> {
  let tx = conn.unchecked_transaction().map_err(|e| format!("Failed to begin sync transaction: {e}"))?;

  // Apply upserts
  for entity in &result.to_upsert_locally {
    match entity {
      MergeEntity::Project(p) => {
        tx.execute(
          "INSERT INTO projects (id, name, profile_id, workspace_root, repo_root, archived, unread_count, created_at, updated_at, sync_dirty) \
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0) \
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, workspace_root=excluded.workspace_root, repo_root=excluded.repo_root, archived=excluded.archived, updated_at=excluded.updated_at, sync_dirty=0",
          params![p.id, p.name, p.profile_id, p.workspace_root, p.repo_root, bool_to_sql(p.archived), p.updated_at, p.updated_at],
        ).map_err(|e| format!("Failed to upsert synced project: {e}"))?;
      }
      MergeEntity::Topic(t) => {
        tx.execute(
          "INSERT INTO topics (id, project_id, name, archived, unread_count, sort_order, created_at, updated_at, sync_dirty) \
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0) \
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, archived=excluded.archived, sort_order=excluded.sort_order, updated_at=excluded.updated_at, sync_dirty=0",
          params![t.id, t.project_id, t.name, bool_to_sql(t.archived), t.sort_order, t.updated_at, t.updated_at],
        ).map_err(|e| format!("Failed to upsert synced topic: {e}"))?;
      }
      MergeEntity::SessionMapping(s) => {
        tx.execute(
          "INSERT INTO session_mappings (session_key, session_id, project_id, topic_id, agent_id, label, status, created_at, updated_at, pinned, hidden, source, sync_dirty) \
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0) \
           ON CONFLICT(session_key) DO UPDATE SET session_id=excluded.session_id, project_id=excluded.project_id, topic_id=excluded.topic_id, agent_id=excluded.agent_id, label=excluded.label, status=excluded.status, pinned=excluded.pinned, hidden=excluded.hidden, updated_at=excluded.updated_at, sync_dirty=0",
          params![s.session_key, s.session_id, s.project_id, s.topic_id, s.agent_id, s.label, s.status, s.updated_at, s.updated_at, bool_to_sql(s.pinned), bool_to_sql(s.hidden), s.source],
        ).map_err(|e| format!("Failed to upsert synced session mapping: {e}"))?;
      }
      MergeEntity::Branch(b) => {
        tx.execute(
          "INSERT INTO branches (id, source_session_key, source_message_id, branch_session_key, branch_topic_id, branch_reason, created_at, metadata_json, sync_dirty) \
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0) \
           ON CONFLICT(branch_session_key) DO UPDATE SET branch_topic_id=excluded.branch_topic_id, branch_reason=excluded.branch_reason, sync_dirty=0",
          params![b.id, b.source_session_key, b.source_message_id, b.branch_session_key, b.branch_topic_id, b.branch_reason, b.created_at],
        ).map_err(|e| format!("Failed to upsert synced branch: {e}"))?;
      }
    }
  }

  // Apply deletes from tombstones
  for (etype, eid) in &result.to_delete_locally {
    match etype.as_str() {
      "project" => {
        tx.execute("DELETE FROM projects WHERE id = ?", params![eid])
          .map_err(|e| format!("Failed to delete synced project: {e}"))?;
      }
      "topic" => {
        tx.execute("DELETE FROM topics WHERE id = ?", params![eid])
          .map_err(|e| format!("Failed to delete synced topic: {e}"))?;
      }
      "session_mapping" => {
        tx.execute("DELETE FROM session_mappings WHERE session_key = ?", params![eid])
          .map_err(|e| format!("Failed to delete synced session mapping: {e}"))?;
      }
      "branch" => {
        tx.execute("DELETE FROM branches WHERE branch_session_key = ?", params![eid])
          .map_err(|e| format!("Failed to delete synced branch: {e}"))?;
      }
      _ => {}
    }
  }

  // Clear sync_dirty only on entities that were actually pushed
  for id in &result.pushed_project_ids {
    tx.execute("UPDATE projects SET sync_dirty = 0 WHERE id = ? AND sync_dirty = 1", params![id])
      .map_err(|e| format!("Failed to clear project sync_dirty: {e}"))?;
  }
  for id in &result.pushed_topic_ids {
    tx.execute("UPDATE topics SET sync_dirty = 0 WHERE id = ? AND sync_dirty = 1", params![id])
      .map_err(|e| format!("Failed to clear topic sync_dirty: {e}"))?;
  }
  for key in &result.pushed_session_keys {
    tx.execute("UPDATE session_mappings SET sync_dirty = 0 WHERE session_key = ? AND sync_dirty = 1", params![key])
      .map_err(|e| format!("Failed to clear session_mappings sync_dirty: {e}"))?;
  }
  for id in &result.pushed_branch_ids {
    tx.execute("UPDATE branches SET sync_dirty = 0 WHERE id = ? AND sync_dirty = 1", params![id])
      .map_err(|e| format!("Failed to clear branches sync_dirty: {e}"))?;
  }

  // Prune expired tombstones
  tx.execute("DELETE FROM sync_tombstones WHERE expires_at <= ?", params![now_iso()])
    .map_err(|e| format!("Failed to prune expired tombstones: {e}"))?;

  tx.commit().map_err(|e| format!("Failed to commit sync changes: {e}"))?;
  Ok(())
}

// ============================================================================
// SYNC: Dual-path I/O (local filesystem vs remote agents.files)
// ============================================================================

pub(crate) fn sync_file_path(workspace_root: &str) -> PathBuf {
  Path::new(workspace_root).join(".jarvis-sync.json")
}

pub(crate) fn read_sync_file_local(workspace_root: &str) -> Result<Option<SyncState>, String> {
  let path = sync_file_path(workspace_root);
  if !path.exists() {
    return Ok(None);
  }
  let data = fs::read_to_string(&path)
    .map_err(|e| format!("Failed to read sync file: {e}"))?;
  let state: SyncState = serde_json::from_str(&data)
    .map_err(|e| format!("Failed to parse sync file: {e}"))?;
  if state.schema_version != 1 {
    return Err(format!("Unsupported sync schema version: {}", state.schema_version));
  }
  Ok(Some(state))
}

pub(crate) fn write_sync_file_local(workspace_root: &str, state: &SyncState) -> Result<(), String> {
  let path = sync_file_path(workspace_root);
  let tmp_path = path.with_extension("json.tmp");
  let data = serde_json::to_string_pretty(state)
    .map_err(|e| format!("Failed to serialize sync state: {e}"))?;
  fs::write(&tmp_path, &data)
    .map_err(|e| format!("Failed to write sync temp file: {e}"))?;
  fs::rename(&tmp_path, &path)
    .map_err(|e| format!("Failed to rename sync file: {e}"))?;
  Ok(())
}

pub(crate) fn encode_sync_state_to_markdown(state: &SyncState) -> Result<String, String> {
  let json = serde_json::to_string_pretty(state)
    .map_err(|e| format!("Failed to serialize sync state: {e}"))?;
  Ok(format!("# Jarvis Sync State\n\nDo not edit this file manually.\n\n```json\n{json}\n```\n"))
}

pub(crate) fn decode_sync_state_from_markdown(markdown: &str) -> Result<Option<SyncState>, String> {
  let start = match markdown.find("```json\n") {
    Some(idx) => idx + 8,
    None => return Ok(None),
  };
  let end = match markdown[start..].find("\n```") {
    Some(idx) => start + idx,
    None => return Err("Malformed sync markdown: missing closing code fence".to_string()),
  };
  let json_str = &markdown[start..end];
  let state: SyncState = serde_json::from_str(json_str)
    .map_err(|e| format!("Failed to parse sync JSON from markdown: {e}"))?;
  if state.schema_version != 1 {
    return Err(format!("Unsupported sync schema version: {}", state.schema_version));
  }
  Ok(Some(state))
}

pub(crate) async fn ensure_sync_agent(socket: &mut GatewaySocket) -> Result<String, String> {
  let list_response = gateway_request(socket, "agents.list", json!({}), 10_000).await?;
  let payload = extract_ok_payload(list_response, "agents.list")?;
  if let Some(agents) = payload.get("agents").and_then(Value::as_array) {
    for agent in agents {
      if agent.get("agentId").and_then(Value::as_str) == Some("jarvis-sync") {
        return Ok("jarvis-sync".to_string());
      }
    }
  }
  let create_response = gateway_request(
    socket,
    "agents.create",
    json!({ "agentId": "jarvis-sync", "displayName": "Jarvis Sync" }),
    10_000,
  )
  .await?;
  extract_ok_payload(create_response, "agents.create")?;
  Ok("jarvis-sync".to_string())
}

pub(crate) async fn read_sync_file_remote(socket: &mut GatewaySocket, agent_id: &str) -> Result<Option<SyncState>, String> {
  let response = gateway_request(
    socket,
    "agents.files.get",
    json!({ "agentId": agent_id, "name": "memory.md" }),
    10_000,
  )
  .await?;
  let payload = extract_ok_payload(response, "agents.files.get")?;
  let content = payload
    .get("content")
    .and_then(Value::as_str)
    .unwrap_or("");
  if content.is_empty() {
    return Ok(None);
  }
  decode_sync_state_from_markdown(content)
}

pub(crate) async fn write_sync_file_remote(socket: &mut GatewaySocket, agent_id: &str, state: &SyncState) -> Result<(), String> {
  let markdown = encode_sync_state_to_markdown(state)?;
  let response = gateway_request(
    socket,
    "agents.files.set",
    json!({ "agentId": agent_id, "name": "memory.md", "content": markdown }),
    10_000,
  )
  .await?;
  extract_ok_payload(response, "agents.files.set")?;
  Ok(())
}


#[tauri::command]
pub async fn middleware_sync_full(input: SyncFullInput) -> Result<Value, String> {
  let conn = open_db()?;

  let enabled = get_app_setting(&conn, APP_SETTING_SYNC_ENABLED)?.unwrap_or_default();
  if enabled != "true" {
    return Err("Sync is not enabled".to_string());
  }

  let device_id = match get_app_setting(&conn, APP_SETTING_SYNC_DEVICE_ID)? {
    Some(id) => id,
    None => {
      let new_id = Uuid::new_v4().to_string();
      set_app_setting(&conn, APP_SETTING_SYNC_DEVICE_ID, &new_id)?;
      new_id
    }
  };
  let device_name = get_app_setting(&conn, APP_SETTING_SYNC_DEVICE_NAME)?
    .unwrap_or_else(|| "Unknown Device".to_string());

  // Load profile to determine sync path
  let profile: Option<(String, String, String)> = conn
    .query_row(
      "SELECT mode, gateway_url, workspace_root FROM profiles WHERE id = ?",
      params![input.profile_id],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .map_err(|e| format!("Failed to load profile: {e}"))?;
  let (mode, _gateway_url, workspace_root) = profile.ok_or("Profile not found")?;

  let local_snapshot = snapshot_dirty_entities(&conn, &device_id)?;

  let (remote_state, is_local_mode) = if mode == "local" {
    (read_sync_file_local(&workspace_root)?, true)
  } else {
    let mut socket = connect_to_gateway(&["operator.read", "operator.write"]).await?;
    let agent_id = ensure_sync_agent(&mut socket).await?;
    let state = read_sync_file_remote(&mut socket, &agent_id).await?;
    let _ = socket.close(None).await;
    (state, false)
  };

  let remote = remote_state.unwrap_or_else(SyncState::empty);
  let merge_result = merge_sync_states(&local_snapshot, &remote, &device_id, &device_name);

  // Apply changes locally
  apply_sync_changes(&conn, &merge_result)?;

  // Write merged state back
  if is_local_mode {
    write_sync_file_local(&workspace_root, &merge_result.new_remote_state)?;
  } else {
    let mut socket = connect_to_gateway(&["operator.read", "operator.write"]).await?;
    let agent_id = ensure_sync_agent(&mut socket).await?;
    write_sync_file_remote(&mut socket, &agent_id, &merge_result.new_remote_state).await?;
    let _ = socket.close(None).await;
  }

  set_app_setting(&conn, APP_SETTING_SYNC_LAST_SYNC_AT, &now_iso())?;

  Ok(json!({
    "ok": true,
    "pulled": merge_result.pulled,
    "pushed": merge_result.pushed,
    "conflicts": 0,
  }))
}

#[tauri::command]
pub fn middleware_sync_status() -> Result<Value, String> {
  let conn = open_db()?;
  let enabled = get_app_setting(&conn, APP_SETTING_SYNC_ENABLED)?.unwrap_or_default() == "true";
  let device_id = get_app_setting(&conn, APP_SETTING_SYNC_DEVICE_ID)?;
  let device_name = get_app_setting(&conn, APP_SETTING_SYNC_DEVICE_NAME)?;
  let last_sync_at = get_app_setting(&conn, APP_SETTING_SYNC_LAST_SYNC_AT)?;

  let dirty_count: i64 = conn
    .query_row(
      "SELECT \
        (SELECT COUNT(*) FROM projects WHERE sync_dirty = 1) + \
        (SELECT COUNT(*) FROM topics WHERE sync_dirty = 1) + \
        (SELECT COUNT(*) FROM session_mappings WHERE sync_dirty = 1) + \
        (SELECT COUNT(*) FROM branches WHERE sync_dirty = 1)",
      [],
      |row| row.get(0),
    )
    .map_err(|e| format!("Failed to count dirty entities: {e}"))?;

  Ok(json!({
    "enabled": enabled,
    "deviceId": device_id,
    "deviceName": device_name,
    "lastSyncAt": last_sync_at,
    "dirtyCount": dirty_count,
  }))
}

#[tauri::command]
pub fn middleware_sync_enable(input: SyncEnableInput) -> Result<Value, String> {
  let conn = open_db()?;

  if input.enabled {
    // Generate device ID if not already set
    let existing_id = get_app_setting(&conn, APP_SETTING_SYNC_DEVICE_ID)?;
    if existing_id.is_none() {
      let device_id = format!("device_{}", Uuid::new_v4().simple());
      set_app_setting(&conn, APP_SETTING_SYNC_DEVICE_ID, &device_id)?;
    }
    let name = input.device_name.unwrap_or_else(|| {
      std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "Unknown Device".to_string())
    });
    set_app_setting(&conn, APP_SETTING_SYNC_DEVICE_NAME, &name)?;
  }

  set_app_setting(
    &conn,
    APP_SETTING_SYNC_ENABLED,
    if input.enabled { "true" } else { "false" },
  )?;

  Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn middleware_sync_devices(input: SyncDevicesInput) -> Result<Value, String> {
  let conn = open_db()?;

  let profile: Option<(String, String)> = conn
    .query_row(
      "SELECT mode, workspace_root FROM profiles WHERE id = ?",
      params![input.profile_id],
      |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|e| format!("Failed to load profile: {e}"))?;
  let (mode, workspace_root) = profile.ok_or("Profile not found")?;

  let remote_state = if mode == "local" {
    read_sync_file_local(&workspace_root)?
  } else {
    let mut socket = connect_to_gateway(&["operator.read"]).await?;
    let agent_id = ensure_sync_agent(&mut socket).await?;
    let state = read_sync_file_remote(&mut socket, &agent_id).await?;
    let _ = socket.close(None).await;
    state
  };

  let mut devices: Vec<Value> = Vec::new();
  if let Some(state) = &remote_state {
    // Collect unique device IDs from all entities
    let mut seen: HashMap<String, (String, String)> = HashMap::new();
    seen.insert(
      state.last_writer.device_id.clone(),
      (state.last_writer.device_name.clone(), state.last_writer.written_at.clone()),
    );
    for p in state.projects.values() {
      seen.entry(p.updated_by.clone()).or_insert_with(|| ("Unknown".to_string(), p.updated_at.clone()));
    }
    for t in state.topics.values() {
      seen.entry(t.updated_by.clone()).or_insert_with(|| ("Unknown".to_string(), t.updated_at.clone()));
    }
    for s in state.session_mappings.values() {
      seen.entry(s.updated_by.clone()).or_insert_with(|| ("Unknown".to_string(), s.updated_at.clone()));
    }
    for b in state.branches.values() {
      seen.entry(b.updated_by.clone()).or_insert_with(|| ("Unknown".to_string(), b.updated_at.clone()));
    }
    for (did, (dname, last_seen)) in seen {
      if !did.is_empty() {
        devices.push(json!({
          "deviceId": did,
          "deviceName": dname,
          "lastSeen": last_seen,
        }));
      }
    }
  }

  Ok(json!({ "devices": devices }))
}


