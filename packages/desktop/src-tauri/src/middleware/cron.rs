use super::*;

// ============================================================================
// CRON MIDDLEWARE COMMANDS
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronListJobsInput {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronGetJobInput {
  pub(crate) job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronCreateJobInput {
  pub(crate) name: String,
  pub(crate) schedule: String,
  pub(crate) task: String,
  pub(crate) params: Option<Value>,
  pub(crate) enabled: Option<bool>,
  pub(crate) metadata: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronUpdateJobInput {
  pub(crate) job_id: String,
  pub(crate) name: Option<String>,
  pub(crate) schedule: Option<String>,
  pub(crate) task: Option<String>,
  pub(crate) params: Option<Value>,
  pub(crate) enabled: Option<bool>,
  pub(crate) metadata: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronDeleteJobInput {
  pub(crate) job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronRunJobInput {
  pub(crate) job_id: String,
  pub(crate) params: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJobStatusInput {
  pub(crate) job_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronListRunsInput {
  pub(crate) job_id: String,
  pub(crate) limit: Option<u32>,
  pub(crate) sort_dir: Option<String>,
  pub(crate) after_ts: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronGetRunInput {
  pub(crate) job_id: String,
  pub(crate) run_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronPauseJobInput {
  pub(crate) job_id: String,
  pub(crate) paused: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronPollRunCompletionInput {
  pub(crate) job_id: String,
  pub(crate) after_ts: i64,
  pub(crate) timeout_ms: Option<u64>,
  pub(crate) interval_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronCreateNotificationJobInput {
  pub(crate) name: String,
  pub(crate) schedule: String,
  pub(crate) notification_message: String,
  pub(crate) session_key: String,
}

pub(crate) fn parse_cron_schedule(schedule: &str) -> Result<Value, String> {
  let trimmed = schedule.trim();
  if trimmed.is_empty() {
    return Err("Cron schedule cannot be empty".to_string());
  }

  Ok(json!({
    "kind": "cron",
    "expr": trimmed,
  }))
}

pub(crate) fn is_invalid_cron_params_error(error: &str, method: &str) -> bool {
  error.contains(&format!("{method} failed: invalid {method} params"))
}

pub(crate) fn legacy_cron_schedule(schedule: &str) -> Value {
  json!(schedule.trim())
}

pub(crate) fn legacy_cron_run_params(input: &CronRunJobInput) -> Value {
  json!({
    "id": input.job_id,
    "params": input.params,
  })
}

pub(crate) fn cron_task_to_job_fields(task: &str, params: Option<Value>, _metadata: Option<Value>) -> Result<Value, String> {
  match task {
    "session.message" => {
      let params_obj = params
        .as_ref()
        .and_then(Value::as_object)
        .ok_or_else(|| "session.message cron job requires params object".to_string())?;
      let session_key = params_obj
        .get("key")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "session.message cron job requires params.key".to_string())?;
      let message = params_obj
        .get("message")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "session.message cron job requires params.message".to_string())?;

      Ok(json!({
        "sessionTarget": format!("session:{session_key}"),
        "wakeMode": "now",
        "sessionKey": session_key,
        "payload": {
          "kind": "agentTurn",
          "message": message,
        },
        "delivery": {
          "mode": "none"
        }
      }))
    }
    "system.event" => {
      let params_obj = params
        .as_ref()
        .and_then(Value::as_object)
        .ok_or_else(|| "system.event cron job requires params object".to_string())?;
      let text = params_obj
        .get("text")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "system.event cron job requires params.text".to_string())?;

      Ok(json!({
        "sessionTarget": "main",
        "wakeMode": "next-heartbeat",
        "payload": {
          "kind": "systemEvent",
          "text": text,
        }
      }))
    }
    _ => Err(format!("Unsupported cron task: {task}")),
  }
}

pub(crate) fn normalize_cron_schedule(value: &Value) -> String {
  match value.get("kind").and_then(Value::as_str) {
    Some("cron") => value
      .get("expr")
      .and_then(Value::as_str)
      .unwrap_or_default()
      .to_string(),
    Some("at") => value.get("at").and_then(Value::as_str).unwrap_or_default().to_string(),
    Some("every") => value
      .get("everyMs")
      .and_then(Value::as_i64)
      .map(|ms| format!("every:{ms}"))
      .unwrap_or_default(),
    _ => string_from_value(Some(value)).unwrap_or_default(),
  }
}

pub(crate) fn normalize_cron_job(value: &Value) -> Value {
  let raw_job = value.get("job").unwrap_or(value);
  let payload = raw_job.get("payload").unwrap_or(&Value::Null);
  let legacy_params = raw_job.get("params").cloned();
  let session_key = string_from_value(raw_job.get("sessionKey")).or_else(|| {
    legacy_params
      .as_ref()
      .and_then(Value::as_object)
      .and_then(|params| params.get("key"))
      .and_then(Value::as_str)
      .map(ToString::to_string)
  });
  let task = match payload.get("kind").and_then(Value::as_str) {
    Some("agentTurn") => "session.message".to_string(),
    Some("systemEvent") => "system.event".to_string(),
    _ => string_from_value(raw_job.get("task")).unwrap_or_default(),
  };
  let params = match payload.get("kind").and_then(Value::as_str) {
    Some("agentTurn") => Some(json!({
      "key": session_key,
      "message": payload.get("message").and_then(Value::as_str),
    })),
    Some("systemEvent") => Some(json!({
      "text": payload.get("text").and_then(Value::as_str),
    })),
    _ => legacy_params,
  };
  let state = raw_job.get("state").unwrap_or(&Value::Null);

  json!({
    "id": string_from_value(raw_job.get("id")),
    "name": string_from_value(raw_job.get("name")).unwrap_or_default(),
    "schedule": normalize_cron_schedule(raw_job.get("schedule").unwrap_or(&Value::Null)),
    "enabled": raw_job.get("enabled").and_then(Value::as_bool).unwrap_or(true),
    "task": task,
    "params": params,
    "lastRunAt": timestamp_to_string(state.get("lastRunAtMs").or_else(|| raw_job.get("lastRunAtMs")).or_else(|| raw_job.get("lastRunAt"))),
    "nextRunAt": timestamp_to_string(state.get("nextRunAtMs").or_else(|| raw_job.get("nextRunAtMs")).or_else(|| raw_job.get("nextRunAt"))),
    "createdAt": timestamp_to_string(raw_job.get("createdAtMs").or_else(|| raw_job.get("createdAt"))).unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
    "updatedAt": timestamp_to_string(raw_job.get("updatedAtMs").or_else(|| raw_job.get("updatedAt"))).unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
    "status": string_from_value(state.get("lastRunStatus").or_else(|| state.get("lastStatus")).or_else(|| raw_job.get("status"))).unwrap_or_else(|| "idle".to_string()),
    "runCount": raw_job.get("runCount").and_then(Value::as_i64).unwrap_or(0),
    "failCount": state.get("consecutiveErrors").and_then(Value::as_i64).or_else(|| raw_job.get("failCount").and_then(Value::as_i64)).unwrap_or(0),
    "metadata": raw_job.get("metadata").cloned(),
    "sessionTarget": string_from_value(raw_job.get("sessionTarget")),
    "payload": raw_job.get("payload").cloned(),
    "delivery": raw_job.get("delivery").cloned(),
    "sessionKey": session_key,
  })
}

pub(crate) fn normalize_cron_run(value: &Value) -> Value {
  let raw_run = value.get("run").unwrap_or(value);
  json!({
    "id": string_from_value(raw_run.get("id")),
    "jobId": string_from_value(raw_run.get("jobId")),
    "status": string_from_value(raw_run.get("status")).unwrap_or_else(|| "unknown".to_string()),
    "startedAt": timestamp_to_string(raw_run.get("startedAt").or_else(|| raw_run.get("startedAtMs"))),
    "completedAt": timestamp_to_string(raw_run.get("completedAt").or_else(|| raw_run.get("completedAtMs"))),
    "summary": string_from_value(raw_run.get("summary")),
    "error": string_from_value(raw_run.get("error")),
    "output": string_from_value(raw_run.get("output")),
    "deliveryStatus": string_from_value(raw_run.get("deliveryStatus")),
    "metadata": raw_run.get("metadata").cloned(),
    "sessionKey": string_from_value(raw_run.get("sessionKey")),
  })
}

#[tauri::command]
pub async fn middleware_cron_list_jobs(_input: CronListJobsInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read"]).await?;
  let payload = extract_ok_payload(
    gateway_request(&mut socket, "cron.list", json!({ "includeDisabled": true }), 30_000).await?,
    "cron.list",
  )?;
  let _ = socket.close(None).await;

  let jobs = payload
    .get("jobs")
    .and_then(Value::as_array)
    .map(|arr| arr.iter().map(normalize_cron_job).collect::<Vec<_>>())
    .unwrap_or_default();

  Ok(json!({ "jobs": jobs }))
}

#[tauri::command]
pub async fn middleware_cron_get_job(input: CronGetJobInput) -> Result<Value, String> {
  let listed = middleware_cron_list_jobs(CronListJobsInput {}).await?;
  let jobs = listed
    .get("jobs")
    .and_then(Value::as_array)
    .ok_or("Failed to list jobs")?;

  let job = jobs
    .iter()
    .find(|entry| entry.get("id").and_then(Value::as_str) == Some(input.job_id.as_str()))
    .cloned()
    .ok_or("Job not found")?;

  Ok(json!({
    "job": job,
    "currentRun": Value::Null,
  }))
}

#[tauri::command]
pub async fn middleware_cron_create_job(input: CronCreateJobInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.admin"]).await?;
  let schedule = parse_cron_schedule(&input.schedule)?;
  let job_fields = cron_task_to_job_fields(&input.task, input.params.clone(), input.metadata.clone())?;
  let new_params = json!({
    "name": input.name,
    "schedule": schedule,
    "enabled": input.enabled.unwrap_or(true),
    "sessionTarget": job_fields.get("sessionTarget").cloned().unwrap_or(Value::Null),
    "wakeMode": job_fields.get("wakeMode").cloned().unwrap_or(Value::Null),
    "sessionKey": job_fields.get("sessionKey").cloned().unwrap_or(Value::Null),
    "payload": job_fields.get("payload").cloned().unwrap_or(Value::Null),
    "delivery": job_fields.get("delivery").cloned().unwrap_or(Value::Null),
  });
  let legacy_params = json!({
    "name": input.name,
    "schedule": legacy_cron_schedule(&input.schedule),
    "task": input.task,
    "params": input.params,
    "enabled": input.enabled.unwrap_or(true),
    "metadata": input.metadata,
  });

  let payload = match extract_ok_payload(
    gateway_request(&mut socket, "cron.add", new_params, 30_000).await?,
    "cron.add",
  ) {
    Ok(payload) => payload,
    Err(error) if is_invalid_cron_params_error(&error, "cron.add") => extract_ok_payload(
      gateway_request(&mut socket, "cron.add", legacy_params, 30_000).await?,
      "cron.add",
    )?,
    Err(error) => return Err(error),
  };
  let _ = socket.close(None).await;

  let job = normalize_cron_job(&payload);
  Ok(json!({ "job": job }))
}

#[tauri::command]
pub async fn middleware_cron_update_job(input: CronUpdateJobInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.admin"]).await?;

  let mut patch = json!({});
  let mut legacy_update_params = json!({ "id": input.job_id });
  if let Some(name) = input.name.clone() {
    patch["name"] = json!(name.clone());
    legacy_update_params["name"] = json!(name);
  }
  if let Some(schedule) = input.schedule.clone() {
    patch["schedule"] = parse_cron_schedule(&schedule)?;
    legacy_update_params["schedule"] = legacy_cron_schedule(&schedule);
  }
  if input.task.is_some() || input.params.is_some() || input.metadata.is_some() {
    let task = input.task.clone().unwrap_or_else(|| "session.message".to_string());
    let job_fields = cron_task_to_job_fields(&task, input.params.clone(), input.metadata.clone())?;
    if let Some(value) = job_fields.get("sessionTarget") {
      patch["sessionTarget"] = value.clone();
    }
    if let Some(value) = job_fields.get("wakeMode") {
      patch["wakeMode"] = value.clone();
    }
    if let Some(value) = job_fields.get("sessionKey") {
      patch["sessionKey"] = value.clone();
    }
    if let Some(value) = job_fields.get("payload") {
      patch["payload"] = value.clone();
    }
    if let Some(value) = job_fields.get("delivery") {
      patch["delivery"] = value.clone();
    }
    legacy_update_params["task"] = json!(task);
    legacy_update_params["params"] = input.params.clone().unwrap_or(Value::Null);
    legacy_update_params["metadata"] = input.metadata.clone().unwrap_or(Value::Null);
  }
  if let Some(enabled) = input.enabled {
    patch["enabled"] = json!(enabled);
    legacy_update_params["enabled"] = json!(enabled);
  }

  let payload = match extract_ok_payload(
    gateway_request(&mut socket, "cron.update", json!({ "id": input.job_id, "patch": patch }), 30_000).await?,
    "cron.update",
  ) {
    Ok(payload) => payload,
    Err(error) if is_invalid_cron_params_error(&error, "cron.update") => extract_ok_payload(
      gateway_request(&mut socket, "cron.update", legacy_update_params, 30_000).await?,
      "cron.update",
    )?,
    Err(error) => return Err(error),
  };
  let _ = socket.close(None).await;

  let job = normalize_cron_job(&payload);
  Ok(json!({ "job": job }))
}

#[tauri::command]
pub async fn middleware_cron_delete_job(input: CronDeleteJobInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.admin"]).await?;
  extract_ok_payload(
    gateway_request(&mut socket, "cron.remove", json!({ "id": input.job_id }), 30_000).await?,
    "cron.remove",
  )?;
  let _ = socket.close(None).await;

  Ok(json!({ "ok": true, "jobId": input.job_id }))
}

#[tauri::command]
pub async fn middleware_cron_run_job(input: CronRunJobInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read", "operator.admin"]).await?;
  let new_params = json!({
    "id": input.job_id,
    "mode": "force",
  });
  let payload = match extract_ok_payload(
    gateway_request(&mut socket, "cron.run", new_params, 60_000).await?,
    "cron.run",
  ) {
    Ok(payload) => payload,
    Err(error) if is_invalid_cron_params_error(&error, "cron.run") => extract_ok_payload(
      gateway_request(&mut socket, "cron.run", legacy_cron_run_params(&input), 60_000).await?,
      "cron.run",
    )?,
    Err(error) => return Err(error),
  };
  let _ = socket.close(None).await;

  Ok(json!({
    "runId": string_from_value(payload.get("runId")),
    "jobId": input.job_id,
    "status": if payload.get("enqueued").and_then(Value::as_bool).unwrap_or(false) { "queued".to_string() } else { string_from_value(payload.get("status")).unwrap_or_else(|| "started".to_string()) },
  }))
}

#[tauri::command]
pub async fn middleware_cron_job_status(input: CronJobStatusInput) -> Result<Value, String> {
  middleware_cron_get_job(CronGetJobInput { job_id: input.job_id }).await
}

#[tauri::command]
pub async fn middleware_cron_list_runs(input: CronListRunsInput) -> Result<Value, String> {
  let mut socket = connect_to_gateway(&["operator.read"]).await?;
  let new_params = json!({
    "id": input.job_id,
    "limit": input.limit.unwrap_or(20),
    "sortDir": input.sort_dir.as_deref().unwrap_or("desc"),
  });
  let legacy_params = json!({
    "id": input.job_id,
    "limit": input.limit.unwrap_or(20),
    "sortDir": input.sort_dir.as_deref().unwrap_or("desc"),
    "afterTs": input.after_ts,
  });
  let payload = match extract_ok_payload(
    gateway_request(&mut socket, "cron.runs", new_params, 30_000).await?,
    "cron.runs",
  ) {
    Ok(payload) => payload,
    Err(error) if is_invalid_cron_params_error(&error, "cron.runs") => extract_ok_payload(
      gateway_request(&mut socket, "cron.runs", legacy_params, 30_000).await?,
      "cron.runs",
    )?,
    Err(error) => return Err(error),
  };
  let _ = socket.close(None).await;

  let runs = payload
    .get("entries")
    .and_then(Value::as_array)
    .map(|arr| {
      arr
        .iter()
        .filter(|entry| {
          input.after_ts.map_or(true, |after_ts| {
            entry
              .get("startedAtMs")
              .and_then(Value::as_i64)
              .or_else(|| entry.get("completedAtMs").and_then(Value::as_i64))
              .map(|ts| ts > after_ts)
              .unwrap_or(true)
          })
        })
        .map(normalize_cron_run)
        .collect::<Vec<_>>()
    })
    .unwrap_or_default();

  Ok(json!({ "jobId": input.job_id, "runs": runs }))
}

#[tauri::command]
pub async fn middleware_cron_get_run(input: CronGetRunInput) -> Result<Value, String> {
  // cron.runs returns a list; we need to find the specific run
  let runs_result = middleware_cron_list_runs(CronListRunsInput {
    job_id: input.job_id.clone(),
    limit: Some(100),
    sort_dir: Some("desc".to_string()),
    after_ts: None,
  }).await?;

  let runs = runs_result
    .get("runs")
    .and_then(Value::as_array)
    .ok_or("Failed to fetch runs")?;

  let run = runs
    .iter()
    .find(|r| {
      r.get("id")
        .and_then(Value::as_str)
        .map(|id| id == input.run_id)
        .unwrap_or(false)
    })
    .cloned()
    .ok_or("Run not found")?;

  Ok(json!({ "run": run }))
}

#[tauri::command]
pub async fn middleware_cron_pause_job(input: CronPauseJobInput) -> Result<Value, String> {
  middleware_cron_update_job(CronUpdateJobInput {
    job_id: input.job_id,
    name: None,
    schedule: None,
    task: None,
    params: None,
    enabled: Some(!input.paused),
    metadata: None,
  }).await
}

#[tauri::command]
pub async fn middleware_cron_poll_run_completion(
  input: CronPollRunCompletionInput,
) -> Result<Value, String> {
  let timeout_ms = input.timeout_ms.unwrap_or(90_000);
  let interval_ms = input.interval_ms.unwrap_or(1_000);
  let started_at = std::time::Instant::now();
  let after_ts = input.after_ts;

  loop {
    if started_at.elapsed().as_millis() > timeout_ms as u128 {
      return Err(format!(
        "Timed out waiting for cron run completion for job {}",
        input.job_id
      ));
    }

    let runs_result = middleware_cron_list_runs(CronListRunsInput {
      job_id: input.job_id.clone(),
      limit: Some(20),
      sort_dir: Some("desc".to_string()),
      after_ts: Some(after_ts),
    }).await?;

    let runs = runs_result
      .get("runs")
      .and_then(Value::as_array)
      .unwrap_or(&vec![])
      .clone();

    if let Some(completed) = runs.iter().find(|r| {
      let status = r
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("");
      status == "ok" || status == "error" || status == "skipped"
    }) {
      return Ok(json!({ "completed": true, "run": completed }));
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(interval_ms)).await;
  }
}

#[tauri::command]
pub async fn middleware_cron_create_notification_job(
  input: CronCreateNotificationJobInput,
) -> Result<Value, String> {
  // Create a cron job that sends a message to a session when triggered
  // The session subscription will then push the notification to Jarvis UI in real-time
  let task = "session.message";
  let params = json!({
    "key": input.session_key,
    "message": input.notification_message,
  });

  middleware_cron_create_job(CronCreateJobInput {
    name: input.name,
    schedule: input.schedule,
    task: task.to_string(),
    params: Some(params),
    enabled: Some(true),
    metadata: Some(json!({
      "type": "notification",
      "sessionKey": input.session_key,
    })),
  }).await
}


