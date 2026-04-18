use super::*;

// ============================================================================
// USAGE: Input structs
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageByProjectInput {
  pub(crate) profile_id: String,
  pub(crate) project_id: Option<String>,
  pub(crate) start_date: Option<String>,
  pub(crate) end_date: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageByTopicInput {
  pub(crate) profile_id: String,
  pub(crate) project_id: String,
  pub(crate) topic_id: Option<String>,
  pub(crate) start_date: Option<String>,
  pub(crate) end_date: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummaryInput {
  pub(crate) start_date: Option<String>,
  pub(crate) end_date: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSessionInput {
  pub(crate) session_key: String,
}


// ============================================================================
// USAGE: Helpers
// ============================================================================

pub(crate) fn empty_cost_totals() -> Value {
  json!({
    "input": 0.0, "output": 0.0, "cacheRead": 0.0, "cacheWrite": 0.0,
    "totalTokens": 0.0, "totalCost": 0.0,
    "inputCost": 0.0, "outputCost": 0.0, "cacheReadCost": 0.0, "cacheWriteCost": 0.0,
  })
}

pub(crate) fn extract_session_usage_entry(session: &Value) -> Value {
  let usage = session.get("usage").unwrap_or(&Value::Null);
  json!({
    "key": session.get("key").and_then(Value::as_str).unwrap_or(""),
    "label": session.get("label").and_then(Value::as_str),
    "model": session.get("model").and_then(Value::as_str),
    "totals": usage_to_totals(usage),
    "messageCounts": usage.get("messageCounts"),
    "firstActivity": usage.get("firstActivity").and_then(Value::as_f64),
    "lastActivity": usage.get("lastActivity").and_then(Value::as_f64),
  })
}

pub(crate) fn usage_to_totals(usage: &Value) -> Value {
  if usage.is_null() {
    return empty_cost_totals();
  }
  json!({
    "input": usage.get("input").and_then(Value::as_f64).unwrap_or(0.0),
    "output": usage.get("output").and_then(Value::as_f64).unwrap_or(0.0),
    "cacheRead": usage.get("cacheRead").and_then(Value::as_f64).unwrap_or(0.0),
    "cacheWrite": usage.get("cacheWrite").and_then(Value::as_f64).unwrap_or(0.0),
    "totalTokens": usage.get("totalTokens").and_then(Value::as_f64).unwrap_or(0.0),
    "totalCost": usage.get("totalCost").and_then(Value::as_f64).unwrap_or(0.0),
    "inputCost": usage.get("inputCost").and_then(Value::as_f64).unwrap_or(0.0),
    "outputCost": usage.get("outputCost").and_then(Value::as_f64).unwrap_or(0.0),
    "cacheReadCost": usage.get("cacheReadCost").and_then(Value::as_f64).unwrap_or(0.0),
    "cacheWriteCost": usage.get("cacheWriteCost").and_then(Value::as_f64).unwrap_or(0.0),
  })
}

pub(crate) fn add_totals(a: &Value, b: &Value) -> Value {
  let get = |v: &Value, k: &str| v.get(k).and_then(Value::as_f64).unwrap_or(0.0);
  json!({
    "input": get(a, "input") + get(b, "input"),
    "output": get(a, "output") + get(b, "output"),
    "cacheRead": get(a, "cacheRead") + get(b, "cacheRead"),
    "cacheWrite": get(a, "cacheWrite") + get(b, "cacheWrite"),
    "totalTokens": get(a, "totalTokens") + get(b, "totalTokens"),
    "totalCost": get(a, "totalCost") + get(b, "totalCost"),
    "inputCost": get(a, "inputCost") + get(b, "inputCost"),
    "outputCost": get(a, "outputCost") + get(b, "outputCost"),
    "cacheReadCost": get(a, "cacheReadCost") + get(b, "cacheReadCost"),
    "cacheWriteCost": get(a, "cacheWriteCost") + get(b, "cacheWriteCost"),
  })
}

pub(crate) fn aggregate_usage_by_group(
  gateway_sessions: &[Value],
  group_map: &HashMap<String, String>,
  group_names: &HashMap<String, String>,
) -> Vec<Value> {
  let mut groups: HashMap<String, (Value, Vec<Value>)> = HashMap::new();
  for session in gateway_sessions {
    let key = session.get("key").and_then(Value::as_str).unwrap_or("").to_string();
    let group_id = group_map.get(&key).cloned().unwrap_or_default();
    if group_id.is_empty() {
      continue;
    }
    let entry = extract_session_usage_entry(session);
    let (totals, sessions) = groups
      .entry(group_id.clone())
      .or_insert_with(|| (empty_cost_totals(), Vec::new()));
    *totals = add_totals(totals, &entry["totals"]);
    sessions.push(entry);
  }

  groups
    .into_iter()
    .map(|(gid, (totals, sessions))| {
      let name = group_names.get(&gid).cloned().unwrap_or_else(|| "Unknown".to_string());
      json!({
        "groupId": gid,
        "groupName": name,
        "totals": totals,
        "sessionCount": sessions.len(),
        "sessions": sessions,
      })
    })
    .collect()
}

pub(crate) async fn fetch_gateway_sessions_usage(
  start_date: &Option<String>,
  end_date: &Option<String>,
) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read"]).await?;
  let mut params = json!({ "limit": 500 });
  if let Some(sd) = start_date {
    params["startDate"] = json!(sd);
  }
  if let Some(ed) = end_date {
    params["endDate"] = json!(ed);
  }
  let response = gateway_request(&mut socket, "sessions.usage", params, 60_000).await?;
  let _ = socket.close(None).await;
  extract_ok_payload(response, "sessions.usage")
}

// ============================================================================
// USAGE: Tauri commands
// ============================================================================

#[tauri::command]
pub async fn middleware_usage_by_project(input: UsageByProjectInput) -> Result<Value, String> {
  let payload = fetch_gateway_sessions_usage(&input.start_date, &input.end_date).await?;
  let gateway_sessions = payload.get("sessions").and_then(Value::as_array).cloned().unwrap_or_default();

  let conn = open_db()?;

  // Build session_key → project_id mapping
  let mut group_map: HashMap<String, String> = HashMap::new();
  {
    let mut stmt = conn
      .prepare("SELECT session_key, project_id FROM session_mappings WHERE project_id IS NOT NULL")
      .map_err(|e| format!("Failed to query session mappings: {e}"))?;
    let rows = stmt
      .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
      .map_err(|e| format!("Failed to read session mappings: {e}"))?;
    for row in rows {
      let (key, pid) = row.map_err(|e| format!("Failed to decode mapping: {e}"))?;
      group_map.insert(key, pid);
    }
  }

  // Build project_id → name mapping
  let mut group_names: HashMap<String, String> = HashMap::new();
  {
    let mut stmt = conn
      .prepare("SELECT id, name FROM projects")
      .map_err(|e| format!("Failed to query projects: {e}"))?;
    let rows = stmt
      .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
      .map_err(|e| format!("Failed to read projects: {e}"))?;
    for row in rows {
      let (id, name): (String, String) = row.map_err(|e| format!("Failed to decode project: {e}"))?;
      group_names.insert(id, name);
    }
  }

  // Filter group_map if specific project requested
  if let Some(pid) = &input.project_id {
    group_map.retain(|_, v| v == pid);
  }

  let truncated = gateway_sessions.len() >= 500;
  let grouped = aggregate_usage_by_group(&gateway_sessions, &group_map, &group_names);
  let projects: Vec<Value> = grouped
    .into_iter()
    .map(|g| {
      json!({
        "projectId": g["groupId"],
        "projectName": g["groupName"],
        "totals": g["totals"],
        "sessionCount": g["sessionCount"],
        "sessions": g["sessions"],
      })
    })
    .collect();

  Ok(json!({ "projects": projects, "truncated": truncated }))
}

#[tauri::command]
pub async fn middleware_usage_by_topic(input: UsageByTopicInput) -> Result<Value, String> {
  let payload = fetch_gateway_sessions_usage(&input.start_date, &input.end_date).await?;
  let gateway_sessions = payload.get("sessions").and_then(Value::as_array).cloned().unwrap_or_default();

  let conn = open_db()?;

  // Build session_key → topic_id mapping (only for this project)
  let mut group_map: HashMap<String, String> = HashMap::new();
  let mut unassigned_keys: HashSet<String> = HashSet::new();
  {
    let mut stmt = conn
      .prepare("SELECT session_key, topic_id FROM session_mappings WHERE project_id = ?")
      .map_err(|e| format!("Failed to query session mappings: {e}"))?;
    let rows = stmt
      .query_map(params![input.project_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
      })
      .map_err(|e| format!("Failed to read session mappings: {e}"))?;
    for row in rows {
      let (key, tid) = row.map_err(|e| format!("Failed to decode mapping: {e}"))?;
      match tid {
        Some(t) => { group_map.insert(key, t); }
        None => { unassigned_keys.insert(key); }
      }
    }
  }

  // Filter to specific topic if requested
  if let Some(tid) = &input.topic_id {
    group_map.retain(|_, v| v == tid);
    unassigned_keys.clear();
  }

  // Build topic_id → name mapping
  let mut group_names: HashMap<String, String> = HashMap::new();
  {
    let mut stmt = conn
      .prepare("SELECT id, name FROM topics WHERE project_id = ?")
      .map_err(|e| format!("Failed to query topics: {e}"))?;
    let rows = stmt
      .query_map(params![input.project_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
      })
      .map_err(|e| format!("Failed to read topics: {e}"))?;
    for row in rows {
      let (id, name) = row.map_err(|e| format!("Failed to decode topic: {e}"))?;
      group_names.insert(id, name);
    }
  }

  let truncated = gateway_sessions.len() >= 500;
  let grouped = aggregate_usage_by_group(&gateway_sessions, &group_map, &group_names);
  let topics: Vec<Value> = grouped
    .into_iter()
    .map(|g| {
      json!({
        "topicId": g["groupId"],
        "topicName": g["groupName"],
        "totals": g["totals"],
        "sessionCount": g["sessionCount"],
        "sessions": g["sessions"],
      })
    })
    .collect();

  // Build unassigned bucket
  let mut unassigned_totals = empty_cost_totals();
  let mut unassigned_sessions = Vec::new();
  for session in &gateway_sessions {
    let key = session.get("key").and_then(Value::as_str).unwrap_or("");
    if unassigned_keys.contains(key) {
      let entry = extract_session_usage_entry(session);
      unassigned_totals = add_totals(&unassigned_totals, &entry["totals"]);
      unassigned_sessions.push(entry);
    }
  }

  Ok(json!({
    "topics": topics,
    "unassigned": {
      "topicId": null,
      "topicName": null,
      "totals": unassigned_totals,
      "sessionCount": unassigned_sessions.len(),
      "sessions": unassigned_sessions,
    },
    "truncated": truncated,
  }))
}

#[tauri::command]
pub async fn middleware_usage_summary(input: UsageSummaryInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read"]).await?;
  let mut params = json!({});
  if let Some(sd) = &input.start_date {
    params["startDate"] = json!(sd);
  }
  if let Some(ed) = &input.end_date {
    params["endDate"] = json!(ed);
  }
  let response = gateway_request(&mut socket, "usage.cost", params, 30_000).await?;
  let _ = socket.close(None).await;
  let payload = extract_ok_payload(response, "usage.cost")?;

  let totals = payload.get("totals").cloned().unwrap_or_else(empty_cost_totals);
  let days = payload.get("days").and_then(Value::as_i64).unwrap_or(0);
  let daily = payload
    .get("daily")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default()
    .into_iter()
    .map(|d| {
      json!({
        "date": d.get("date").and_then(Value::as_str).unwrap_or(""),
        "totalTokens": d.get("totalTokens").and_then(Value::as_f64).unwrap_or(0.0),
        "totalCost": d.get("totalCost").and_then(Value::as_f64).unwrap_or(0.0),
      })
    })
    .collect::<Vec<_>>();

  Ok(json!({
    "totals": usage_to_totals(&totals),
    "daily": daily,
    "days": days,
  }))
}

#[tauri::command]
pub async fn middleware_usage_session(input: UsageSessionInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read"]).await?;
  let response = gateway_request(
    &mut socket,
    "sessions.usage",
    json!({ "key": input.session_key }),
    30_000,
  )
  .await?;
  let _ = socket.close(None).await;
  let payload = extract_ok_payload(response, "sessions.usage")?;

  let sessions = payload.get("sessions").and_then(Value::as_array);
  let session = sessions
    .and_then(|s| s.first())
    .map(extract_session_usage_entry)
    .ok_or_else(|| format!("Session not found: {}", input.session_key))?;

  Ok(json!({ "session": session }))
}
