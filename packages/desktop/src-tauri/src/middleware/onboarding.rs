use super::*;

// ============================================================================
// ONBOARDING ENHANCEMENTS: OpenClaw Detection, Install, Git Remote
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawCheckInput {
  pub(crate) gateway_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingCoreInput {
  pub(crate) action: Option<String>,
  pub(crate) gateway_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawInstallInput {
  pub(crate) install_path: Option<String>,
  pub(crate) version: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingProviderInput {
  pub(crate) provider_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingProviderSubmitInput {
  pub(crate) provider_id: String,
  pub(crate) auth_method: Option<String>,
  pub(crate) values: Option<Value>,
  pub(crate) set_default: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingModelContractInput {
  pub(crate) provider_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingModelSubmitInput {
  pub(crate) provider_id: Option<String>,
  pub(crate) model_ref: String,
  pub(crate) set_default: Option<bool>,
}


pub(crate) async fn command_version(binary: &str, version_arg: &str) -> Option<String> {
  tokio::process::Command::new(binary)
    .arg(version_arg)
    .output()
    .await
    .ok()
    .filter(|output| output.status.success())
    .and_then(|output| String::from_utf8(output.stdout).ok())
    .map(|stdout| stdout.trim().to_string())
    .filter(|stdout| !stdout.is_empty())
}

pub(crate) async fn gateway_running(gateway_url: &str) -> bool {
  matches!(
    timeout(Duration::from_secs(2), async {
      let request = gateway_url.to_string().into_client_request().map_err(|e| e.to_string())?;
      connect_async(request).await.map_err(|e| e.to_string())
    })
    .await,
    Ok(Ok(_))
  )
}

pub(crate) fn onboarding_recommendation(
  node_installed: bool,
  npm_installed: bool,
  openclaw_installed: bool,
  gateway_running: bool,
) -> &'static str {
  if !node_installed {
    "install_node"
  } else if !npm_installed {
    "install_npm"
  } else if !openclaw_installed {
    "install_openclaw"
  } else if !gateway_running {
    "start_gateway"
  } else {
    "ready"
  }
}

pub(crate) async fn onboarding_snapshot(gateway_url: String) -> Value {
  let node_version = command_version("node", "--version").await;
  let npm_version = command_version("npm", "--version").await;
  let openclaw_version = command_version("openclaw", "--version").await;
  let gateway_is_running = gateway_running(&gateway_url).await;

  json!({
    "node": {
      "installed": node_version.is_some(),
      "version": node_version,
    },
    "npm": {
      "installed": npm_version.is_some(),
      "version": npm_version,
    },
    "openclaw": {
      "installed": openclaw_version.is_some(),
      "version": openclaw_version,
      "installMethod": "npm i -g openclaw",
    },
    "gateway": {
      "url": gateway_url,
      "running": gateway_is_running,
      "status": if gateway_is_running { "running" } else { "stopped" },
    },
    "recommendation": onboarding_recommendation(
      node_version.is_some(),
      npm_version.is_some(),
      openclaw_version.is_some(),
      gateway_is_running,
    )
  })
}

pub(crate) fn openclaw_extensions_dir() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("../../..")
    .join(".openclaw-src")
    .join("extensions")
}

pub(crate) fn title_case_provider_id(provider_id: &str) -> String {
  provider_id
    .split('-')
    .filter(|part| !part.is_empty())
    .map(|part| {
      let mut chars = part.chars();
      match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
        None => String::new(),
      }
    })
    .collect::<Vec<_>>()
    .join(" ")
}

pub(crate) fn onboarding_provider_category(provider_id: &str) -> &'static str {
  match provider_id {
    "openai" | "openai-codex" | "anthropic" | "google" | "google-gemini-cli" | "openrouter" | "deepseek" | "mistral" | "xai" | "qwen" | "moonshot" | "together" => "core",
    "ollama" | "lmstudio" | "vllm" | "sglang" | "github-copilot" | "codex" | "copilot-proxy" | "opencode" | "opencode-go" | "kilocode" => "local",
    _ => "advanced",
  }
}

pub(crate) fn flatten_config_schema_fields(
  prefix: Option<&str>,
  schema: &Value,
  ui_hints: &Value,
  output: &mut Vec<Value>,
) {
  let properties = match schema.get("properties").and_then(Value::as_object) {
    Some(properties) => properties,
    None => return,
  };

  let required = schema
    .get("required")
    .and_then(Value::as_array)
    .map(|arr| {
      arr.iter()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect::<HashSet<_>>()
    })
    .unwrap_or_default();

  for (key, field_schema) in properties {
    let path = match prefix {
      Some(prefix) if !prefix.is_empty() => format!("{prefix}.{key}"),
      _ => key.to_string(),
    };

    let label = ui_hints
      .get(&path)
      .and_then(|hint| hint.get("label"))
      .and_then(Value::as_str)
      .map(ToString::to_string);
    let help = ui_hints
      .get(&path)
      .and_then(|hint| hint.get("help"))
      .and_then(Value::as_str)
      .map(ToString::to_string);

    let field_type = match field_schema.get("type") {
      Some(Value::String(value)) => value.to_string(),
      Some(Value::Array(values)) => values
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join("|"),
      _ => "object".to_string(),
    };

    output.push(json!({
      "path": path,
      "type": field_type,
      "required": required.contains(key),
      "label": label,
      "help": help,
      "enum": field_schema.get("enum").cloned().unwrap_or(Value::Null),
      "default": field_schema.get("default").cloned().unwrap_or(Value::Null),
      "sensitive": ui_hints
        .get(&path)
        .and_then(|hint| hint.get("sensitive"))
        .and_then(Value::as_bool)
        .unwrap_or(false),
    }));

    if field_schema.get("type").and_then(Value::as_str) == Some("object")
      || field_schema.get("properties").is_some()
    {
      flatten_config_schema_fields(Some(&path), field_schema, ui_hints, output);
    }
  }
}

pub(crate) fn read_openclaw_provider_manifests() -> Result<Vec<Value>, String> {
  let mut manifests = Vec::new();
  for entry in fs::read_dir(openclaw_extensions_dir())
    .map_err(|error| format!("Failed to read OpenClaw extensions dir: {error}"))?
  {
    let entry = entry.map_err(|error| format!("Failed to read OpenClaw extension entry: {error}"))?;
    let manifest_path = entry.path().join("openclaw.plugin.json");
    if !manifest_path.exists() {
      continue;
    }
    let raw = fs::read_to_string(&manifest_path)
      .map_err(|error| format!("Failed to read plugin manifest {}: {error}", manifest_path.display()))?;
    let manifest = serde_json::from_str::<Value>(&raw)
      .map_err(|error| format!("Failed to parse plugin manifest {}: {error}", manifest_path.display()))?;
    manifests.push(manifest);
  }
  manifests.sort_by(|left, right| {
    left.get("id")
      .and_then(Value::as_str)
      .cmp(&right.get("id").and_then(Value::as_str))
  });
  Ok(manifests)
}

pub(crate) fn manifest_for_provider(provider_id: &str) -> Result<Value, String> {
  let manifests = read_openclaw_provider_manifests()?;
  manifests
    .into_iter()
    .find(|manifest| {
      manifest
        .get("providers")
        .and_then(Value::as_array)
        .map(|providers| {
          providers
            .iter()
            .any(|provider| provider.as_str() == Some(provider_id))
        })
        .unwrap_or(false)
    })
    .ok_or_else(|| format!("Unsupported OpenClaw provider: {provider_id}"))
}

pub(crate) fn provider_type_name(provider_id: &str, suffix: &str) -> String {
  format!(
    "{}{}",
    provider_id
      .split('-')
      .filter(|part| !part.is_empty())
      .map(|part| {
        let mut chars = part.chars();
        match chars.next() {
          Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
          None => String::new(),
        }
      })
      .collect::<String>(),
    suffix
  )
}

pub(crate) fn infer_auth_method_from_env_var(env_var: &str) -> &'static str {
  if env_var.contains("OAUTH") {
    "oauth"
  } else if env_var.starts_with("AWS_") {
    "aws-sdk"
  } else if env_var.contains("TOKEN") {
    "token"
  } else {
    "api-key"
  }
}

pub(crate) fn preferred_env_var_for_auth_method(
  auth_method: &str,
  auth_env_vars: &[Value],
) -> Option<String> {
  let matcher = match auth_method {
    "oauth" => Some("OAUTH"),
    "token" | "device" => Some("TOKEN"),
    "aws-sdk" => Some("AWS_"),
    _ => Some("API_KEY"),
  };

  matcher
    .and_then(|needle| {
      auth_env_vars.iter().find_map(|value| {
        let env_var = value.as_str()?;
        if env_var.contains(needle) || (needle == "AWS_" && env_var.starts_with("AWS_")) {
          Some(env_var.to_string())
        } else {
          None
        }
      })
    })
    .or_else(|| {
      auth_env_vars
        .iter()
        .find_map(|value| value.as_str().map(ToString::to_string))
    })
}

pub(crate) fn field_input_kind(field_type: &str, has_enum: bool, sensitive: bool) -> &'static str {
  if sensitive {
    "secret"
  } else if has_enum {
    "select"
  } else if field_type.contains("boolean") {
    "toggle"
  } else if field_type.contains("number") || field_type.contains("integer") {
    "number"
  } else if field_type == "object" {
    "group"
  } else {
    "text"
  }
}

pub(crate) fn is_leaf_field(config_fields: &[Value], path: &str) -> bool {
  !config_fields.iter().any(|candidate| {
    candidate
      .get("path")
      .and_then(Value::as_str)
      .map(|other| other != path && other.starts_with(&format!("{path}.")))
      .unwrap_or(false)
  })
}

pub(crate) fn build_provider_auth_fields(auth_choices: &[Value], auth_env_vars: &[Value]) -> Vec<Value> {
  let mut fields = Vec::new();
  let mut used_env_vars = HashSet::new();

  for choice in auth_choices {
    let auth_method = choice
      .get("method")
      .and_then(Value::as_str)
      .unwrap_or("api-key");
    let option_key = choice.get("optionKey").and_then(Value::as_str);
    let env_var = preferred_env_var_for_auth_method(auth_method, auth_env_vars);
    if let Some(env_var_name) = env_var.as_ref() {
      used_env_vars.insert(env_var_name.clone());
    }

    fields.push(json!({
      "key": option_key.unwrap_or(auth_method),
      "label": choice.get("choiceLabel").cloned().unwrap_or_else(|| Value::String(title_case_provider_id(auth_method))),
      "help": choice.get("choiceHint").cloned().unwrap_or(Value::Null),
      "group": "credentials",
      "authMethod": auth_method,
      "valueType": "string",
      "inputKind": if auth_method == "oauth" { "action" } else { "secret" },
      "required": option_key.is_some() && auth_method != "oauth",
      "sensitive": auth_method != "oauth",
      "envVar": env_var,
      "optionKey": option_key,
      "cliFlag": choice.get("cliFlag").cloned().unwrap_or(Value::Null),
    }));
  }

  for env_var in auth_env_vars.iter().filter_map(Value::as_str) {
    if used_env_vars.contains(env_var) {
      continue;
    }
    let auth_method = infer_auth_method_from_env_var(env_var);
    fields.push(json!({
      "key": env_var,
      "label": title_case_provider_id(env_var),
      "help": Value::Null,
      "group": "credentials",
      "authMethod": auth_method,
      "valueType": "string",
      "inputKind": if auth_method == "oauth" { "action" } else { "secret" },
      "required": auth_method != "oauth" && auth_method != "aws-sdk",
      "sensitive": auth_method != "oauth",
      "envVar": env_var,
      "optionKey": Value::Null,
      "cliFlag": Value::Null,
    }));
  }

  fields
}

pub(crate) fn build_provider_config_input_fields(config_fields: &[Value]) -> Vec<Value> {
  config_fields
    .iter()
    .filter(|field| {
      field
        .get("path")
        .and_then(Value::as_str)
        .map(|path| is_leaf_field(config_fields, path))
        .unwrap_or(false)
    })
    .map(|field| {
      let field_type = field.get("type").and_then(Value::as_str).unwrap_or("string");
      let sensitive = field
        .get("sensitive")
        .and_then(Value::as_bool)
        .unwrap_or(false);
      let has_enum = field.get("enum").map(|value| value.is_array()).unwrap_or(false);
      json!({
        "key": field.get("path").cloned().unwrap_or(Value::Null),
        "sourcePath": field.get("path").cloned().unwrap_or(Value::Null),
        "label": field.get("label").cloned().unwrap_or_else(|| field.get("path").cloned().unwrap_or(Value::Null)),
        "help": field.get("help").cloned().unwrap_or(Value::Null),
        "group": "config",
        "valueType": field_type,
        "inputKind": field_input_kind(field_type, has_enum, sensitive),
        "required": field.get("required").cloned().unwrap_or(Value::Bool(false)),
        "sensitive": field.get("sensitive").cloned().unwrap_or(Value::Bool(false)),
        "enum": field.get("enum").cloned().unwrap_or(Value::Null),
        "default": field.get("default").cloned().unwrap_or(Value::Null),
      })
    })
    .collect()
}

pub(crate) fn provider_submit_schema_from_manifest(manifest: &Value, provider_id: &str) -> Value {
  let auth_choices = manifest
    .get("providerAuthChoices")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default()
    .into_iter()
    .filter(|choice| choice.get("provider").and_then(Value::as_str) == Some(provider_id))
    .collect::<Vec<_>>();
  let auth_env_vars = manifest
    .get("providerAuthEnvVars")
    .and_then(|value| value.get(provider_id))
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let auth_methods = auth_choices
    .iter()
    .filter_map(|choice| choice.get("method").cloned())
    .collect::<Vec<_>>();
  let config_schema = manifest.get("configSchema").cloned().unwrap_or_else(|| json!({}));
  let ui_hints = manifest.get("uiHints").cloned().unwrap_or_else(|| json!({}));
  let mut config_fields = Vec::new();
  flatten_config_schema_fields(None, &config_schema, &ui_hints, &mut config_fields);
  let credential_fields = build_provider_auth_fields(&auth_choices, &auth_env_vars);
  let config_input_fields = build_provider_config_input_fields(&config_fields);
  let step_kind = match onboarding_provider_category(provider_id) {
    "local" => "local",
    "advanced" => "advanced",
    _ if auth_methods.iter().any(|method| method.as_str() == Some("oauth")) => "mixed",
    _ => "api-key",
  };

  json!({
    "providerId": provider_id,
    "submitEndpoint": "middleware_onboarding_provider_submit",
    "stepKind": step_kind,
    "typeNames": {
      "payload": provider_type_name(provider_id, "OnboardingSubmitPayload"),
      "authMethod": provider_type_name(provider_id, "AuthMethod"),
      "values": provider_type_name(provider_id, "OnboardingValues"),
    },
    "payloadShape": {
      "providerId": { "type": "literal", "value": provider_id },
      "authMethod": { "type": "enum", "options": auth_methods },
      "setDefault": { "type": "boolean", "default": true },
      "values": {
        "type": "object",
        "fields": {
          "credentials": credential_fields,
          "config": config_input_fields,
        }
      }
    }
  })
}

pub(crate) fn provider_summary_from_manifest(manifest: &Value, provider_id: &str) -> Value {
  let plugin_id = manifest.get("id").and_then(Value::as_str).unwrap_or_default();
  let auth_choices = manifest
    .get("providerAuthChoices")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default()
    .into_iter()
    .filter(|choice| choice.get("provider").and_then(Value::as_str) == Some(provider_id))
    .collect::<Vec<_>>();
  let auth_env_vars = manifest
    .get("providerAuthEnvVars")
    .and_then(|value| value.get(provider_id))
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let option_keys = auth_choices
    .iter()
    .filter_map(|choice| choice.get("optionKey").and_then(Value::as_str))
    .collect::<Vec<_>>();
  let auth_methods = auth_choices
    .iter()
    .filter_map(|choice| choice.get("method").and_then(Value::as_str))
    .collect::<Vec<_>>();
  let config_schema = manifest.get("configSchema").cloned().unwrap_or_else(|| json!({}));
  let ui_hints = manifest.get("uiHints").cloned().unwrap_or_else(|| json!({}));
  let mut config_fields = Vec::new();
  flatten_config_schema_fields(None, &config_schema, &ui_hints, &mut config_fields);

  let display_name = auth_choices
    .iter()
    .find_map(|choice| choice.get("groupLabel").and_then(Value::as_str))
    .map(ToString::to_string)
    .or_else(|| auth_choices.iter().find_map(|choice| choice.get("choiceLabel").and_then(Value::as_str)).map(ToString::to_string))
    .unwrap_or_else(|| title_case_provider_id(provider_id));

  json!({
    "id": provider_id,
    "pluginId": plugin_id,
    "displayName": display_name,
    "category": onboarding_provider_category(provider_id),
    "authEnvVars": auth_env_vars,
    "authMethods": auth_methods,
    "optionKeys": option_keys,
    "authChoices": auth_choices,
    "configFieldCount": config_fields.len(),
    "configFields": config_fields,
    "schema": config_schema,
    "uiHints": ui_hints,
    "submit": provider_submit_schema_from_manifest(manifest, provider_id),
  })
}

pub(crate) fn onboarding_model_options_for_provider(provider_id: &str, auth_method: Option<&str>) -> Vec<Value> {
  let refs = match provider_id {
    "openai" => vec!["openai/gpt-5.4", "openai/gpt-5.4-mini", "openai/o4-mini"],
    "openai-codex" => vec!["openai-codex/gpt-5.4", "openai-codex/gpt-5.4-pro"],
    "anthropic" => {
      if auth_method == Some("cli") {
        vec![
          "claude-cli/claude-sonnet-4-6",
          "claude-cli/claude-opus-4-6",
          "claude-cli/claude-haiku-4-5",
        ]
      } else {
        vec![
          "anthropic/claude-sonnet-4-6",
          "anthropic/claude-opus-4-6",
          "anthropic/claude-haiku-4-5",
        ]
      }
    }
    "google" => vec!["google/gemini-2.5-pro", "google/gemini-2.5-flash"],
    "openrouter" => vec!["openrouter/openai/gpt-4o-mini", "openrouter/anthropic/claude-sonnet-4-5"],
    "deepseek" => vec!["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"],
    "mistral" => vec!["mistral/mistral-medium-2505", "mistral/mistral-small-2503"],
    "xai" => vec!["xai/grok-4", "xai/grok-3-mini"],
    "qwen" => vec!["qwen/qwen3-coder-plus", "qwen/qwen3-235b-a22b"],
    "moonshot" => vec!["moonshot/kimi-k2", "moonshot/kimi-latest"],
    "ollama" => vec!["ollama/qwen3:4b", "ollama/llama3.2:3b"],
    "lmstudio" => vec!["lmstudio/local-model", "lmstudio/qwen2.5-coder"],
    "github-copilot" => vec!["github-copilot/gpt-4.1", "github-copilot/claude-sonnet-4-5"],
    "codex" => vec!["codex/gpt-5.4", "codex/gpt-5.4-mini"],
    _ => Vec::new(),
  };

  refs
    .into_iter()
    .map(|model_ref| {
      let display_name = model_ref
        .split('/')
        .last()
        .unwrap_or(model_ref)
        .to_string();
      json!({
        "id": model_ref,
        "value": model_ref,
        "label": display_name,
      })
    })
    .collect()
}

pub(crate) fn default_onboarding_model_ref(provider_id: &str, auth_method: Option<&str>) -> Option<String> {
  onboarding_model_options_for_provider(provider_id, auth_method)
    .first()
    .and_then(|value| value.get("value").and_then(Value::as_str))
    .map(ToString::to_string)
}

pub(crate) fn selected_onboarding_provider(conn: &Connection) -> Result<Option<(String, Option<String>)>, String> {
  let provider_id = get_app_setting(conn, APP_SETTING_ONBOARDING_PROVIDER_ID)?;
  let auth_method = get_app_setting(conn, APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD)?
    .and_then(|value| if value.trim().is_empty() { None } else { Some(value) });
  Ok(provider_id.map(|provider_id| (provider_id, auth_method)))
}

pub(crate) fn onboarding_model_contract_value(
  conn: &Connection,
  provider_id: String,
  auth_method: Option<String>,
) -> Result<Value, String> {
  let manifest = manifest_for_provider(&provider_id)?;
  let provider = provider_summary_from_manifest(&manifest, &provider_id);
  let selected_model_ref = get_app_setting(conn, APP_SETTING_ONBOARDING_MODEL_REF)?;
  let recommended_model_ref = default_onboarding_model_ref(&provider_id, auth_method.as_deref());
  let recommended_for_field = recommended_model_ref.clone();
  let model_options = onboarding_model_options_for_provider(&provider_id, auth_method.as_deref());

  Ok(json!({
    "providerId": provider_id,
    "authMethod": auth_method,
    "selectedModelRef": selected_model_ref,
    "recommendedModelRef": recommended_model_ref,
    "submitEndpoint": "middleware_onboarding_model_submit",
    "nextStep": "complete",
    "provider": provider,
    "types": {
      "providerId": provider.get("id").cloned().unwrap_or(Value::Null),
      "submitEndpoint": "middleware_onboarding_model_submit",
      "typeNames": {
        "payload": provider_type_name(
          provider.get("id").and_then(Value::as_str).unwrap_or("model"),
          "OnboardingModelSubmitPayload",
        ),
        "selection": provider_type_name(
          provider.get("id").and_then(Value::as_str).unwrap_or("model"),
          "OnboardingModelSelection",
        ),
      },
      "payloadShape": {
        "providerId": { "type": "literal", "value": provider.get("id").cloned().unwrap_or(Value::Null) },
        "modelRef": {
          "type": "string",
          "required": true,
          "inputKind": if model_options.is_empty() { "text" } else { "combobox" },
          "allowCustom": true,
          "recommended": recommended_for_field,
          "options": model_options,
        },
        "setDefault": { "type": "boolean", "default": true }
      }
    }
  }))
}

pub(crate) fn onboarding_step_state(core_status: &Value, bot_name: Option<String>, provider_done: bool, model_done: bool) -> Value {
  let core_done = core_status.get("recommendation").and_then(Value::as_str) == Some("ready");
  let bot_done = bot_name.as_deref().map(|value| !value.trim().is_empty()).unwrap_or(false);
  let next_step = if !core_done {
    "core"
  } else if !bot_done {
    "bot"
  } else if !provider_done {
    "provider"
  } else if !model_done {
    "model"
  } else {
    "complete"
  };

  json!({
    "steps": [
      { "id": "core", "title": "Install and start OpenClaw", "complete": core_done },
      { "id": "bot", "title": "Set bot name", "complete": bot_done },
      { "id": "provider", "title": "Choose provider", "complete": provider_done },
      { "id": "model", "title": "Choose default model", "complete": model_done }
    ],
    "nextStep": next_step,
    "completed": next_step == "complete"
  })
}

#[tauri::command]
pub fn middleware_onboarding_providers() -> Result<Value, String> {
  let manifests = read_openclaw_provider_manifests()?;
  let mut providers = Vec::new();
  for manifest in manifests {
    for provider_id in manifest
      .get("providers")
      .and_then(Value::as_array)
      .into_iter()
      .flatten()
      .filter_map(Value::as_str)
    {
      providers.push(provider_summary_from_manifest(&manifest, provider_id));
    }
  }
  providers.sort_by(|left, right| {
    left.get("id")
      .and_then(Value::as_str)
      .cmp(&right.get("id").and_then(Value::as_str))
  });
  Ok(json!({ "providers": providers, "count": providers.len() }))
}

#[tauri::command]
pub fn middleware_onboarding_provider_types() -> Result<Value, String> {
  let manifests = read_openclaw_provider_manifests()?;
  let mut providers = Vec::new();
  for manifest in manifests {
    for provider_id in manifest
      .get("providers")
      .and_then(Value::as_array)
      .into_iter()
      .flatten()
      .filter_map(Value::as_str)
    {
      providers.push(json!({
        "providerId": provider_id,
        "displayName": provider_summary_from_manifest(&manifest, provider_id)
          .get("displayName")
          .cloned()
          .unwrap_or(Value::Null),
        "types": provider_submit_schema_from_manifest(&manifest, provider_id),
      }));
    }
  }
  providers.sort_by(|left, right| {
    left
      .get("providerId")
      .and_then(Value::as_str)
      .cmp(&right.get("providerId").and_then(Value::as_str))
  });
  Ok(json!({
    "version": "2026-04-18",
    "submitEndpoint": "middleware_onboarding_provider_submit",
    "providers": providers,
  }))
}

#[tauri::command]
pub fn middleware_onboarding_provider_details(input: OnboardingProviderInput) -> Result<Value, String> {
  let manifest = manifest_for_provider(&input.provider_id)?;
  Ok(json!({ "provider": provider_summary_from_manifest(&manifest, &input.provider_id) }))
}

#[tauri::command]
pub fn middleware_onboarding_provider_submit(
  input: OnboardingProviderSubmitInput,
) -> Result<Value, String> {
  let manifest = manifest_for_provider(&input.provider_id)?;
  let provider = provider_summary_from_manifest(&manifest, &input.provider_id);
  let submit_schema = provider_submit_schema_from_manifest(&manifest, &input.provider_id);
  let auth_methods = provider
    .get("authMethods")
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default()
    .into_iter()
    .filter_map(|value| value.as_str().map(ToString::to_string))
    .collect::<Vec<_>>();
  let auth_method = input.auth_method.or_else(|| {
    if auth_methods.len() == 1 {
      auth_methods.first().cloned()
    } else {
      None
    }
  });

  if auth_methods.len() > 1 && auth_method.is_none() {
    return Err(format!(
      "Provider {} requires authMethod. Supported values: {}",
      input.provider_id,
      auth_methods.join(", ")
    ));
  }

  if let Some(selected_auth_method) = auth_method.as_deref() {
    if !auth_methods.is_empty() && !auth_methods.iter().any(|method| method == selected_auth_method) {
      return Err(format!(
        "Unsupported authMethod '{}' for provider {}",
        selected_auth_method, input.provider_id
      ));
    }
  }

  let values = input.values.unwrap_or_else(|| json!({}));
  let values_object = values
    .as_object()
    .ok_or_else(|| "values must be a JSON object".to_string())?;

  let credential_fields = submit_schema
    .get("payloadShape")
    .and_then(|value| value.get("values"))
    .and_then(|value| value.get("fields"))
    .and_then(|value| value.get("credentials"))
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
  let config_fields = submit_schema
    .get("payloadShape")
    .and_then(|value| value.get("values"))
    .and_then(|value| value.get("fields"))
    .and_then(|value| value.get("config"))
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();

  for field in &credential_fields {
    let field_auth_method = field.get("authMethod").and_then(Value::as_str);
    if auth_method.as_deref().is_some()
      && field_auth_method.is_some()
      && field_auth_method != auth_method.as_deref()
    {
      continue;
    }
    let key = field.get("key").and_then(Value::as_str).unwrap_or_default();
    let required = field.get("required").and_then(Value::as_bool).unwrap_or(false);
    let is_present = values_object
      .get(key)
      .and_then(Value::as_str)
      .map(|value| !value.trim().is_empty())
      .unwrap_or(false);
    if required && !is_present {
      return Err(format!("Missing required credential field: {key}"));
    }
  }

  for field in &config_fields {
    let key = field.get("key").and_then(Value::as_str).unwrap_or_default();
    let required = field.get("required").and_then(Value::as_bool).unwrap_or(false);
    if required && !values_object.contains_key(key) {
      return Err(format!("Missing required config field: {key}"));
    }
  }

  let mut config = read_openclaw_config_value()?;
  let mut saved_env_vars = Vec::new();
  let mut saved_config_paths = Vec::new();

  for field in &credential_fields {
    let field_auth_method = field.get("authMethod").and_then(Value::as_str);
    if auth_method.as_deref().is_some()
      && field_auth_method.is_some()
      && field_auth_method != auth_method.as_deref()
    {
      continue;
    }
    let key = field.get("key").and_then(Value::as_str).unwrap_or_default();
    if let Some(value) = values_object.get(key).and_then(Value::as_str) {
      if value.trim().is_empty() {
        continue;
      }
      if let Some(env_var) = field.get("envVar").and_then(Value::as_str) {
        set_json_path(&mut config, &format!("env.vars.{env_var}"), Value::String(value.to_string()));
        saved_env_vars.push(env_var.to_string());
      }
    }
  }

  let plugin_id = provider
    .get("pluginId")
    .and_then(Value::as_str)
    .unwrap_or_default();
  let mut plugin_config = value_at_json_path(&config, plugin_id)
    .cloned()
    .unwrap_or_else(|| json!({}));

  for field in &config_fields {
    let key = field.get("key").and_then(Value::as_str).unwrap_or_default();
    let source_path = field
      .get("sourcePath")
      .and_then(Value::as_str)
      .unwrap_or(key);
    if let Some(value) = values_object.get(key).cloned() {
      set_json_path(&mut plugin_config, source_path, value);
      saved_config_paths.push(format!("{plugin_id}.{source_path}"));
    }
  }

  if !saved_config_paths.is_empty() {
    set_json_path(&mut config, plugin_id, plugin_config);
  }

  write_openclaw_config_value(&config)?;

  let conn = open_db()?;
  set_app_setting(&conn, APP_SETTING_ONBOARDING_PROVIDER_ID, &input.provider_id)?;
  set_app_setting(
    &conn,
    APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD,
    auth_method.as_deref().unwrap_or(""),
  )?;

  let persisted_values = values_object
    .iter()
    .filter_map(|(key, value)| {
      let is_sensitive = credential_fields.iter().chain(config_fields.iter()).any(|field| {
        field.get("key").and_then(Value::as_str) == Some(key.as_str())
          && field.get("sensitive").and_then(Value::as_bool).unwrap_or(false)
      });
      if is_sensitive {
        None
      } else {
        Some((key.clone(), value.clone()))
      }
    })
    .collect::<serde_json::Map<String, Value>>();
  set_app_setting(
    &conn,
    &format!("{APP_SETTING_ONBOARDING_PROVIDER_VALUES_PREFIX}{}", input.provider_id),
    &Value::Object(persisted_values).to_string(),
  )?;

  Ok(json!({
    "ok": true,
    "providerId": input.provider_id,
    "authMethod": auth_method,
    "saved": {
      "envVars": saved_env_vars,
      "configPaths": saved_config_paths,
      "setDefault": input.set_default.unwrap_or(true),
    },
    "nextStep": "model-selection",
    "openClawFlow": ["onboarding", "model-selection"],
    "provider": provider,
    "types": submit_schema,
  }))
}

#[tauri::command]
pub fn middleware_onboarding_model_contract(
  input: Option<OnboardingModelContractInput>,
) -> Result<Value, String> {
  let conn = open_db()?;
  let selected = if let Some(provider_id) = input.and_then(|value| value.provider_id) {
    let auth_method = get_app_setting(&conn, APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD)?
      .and_then(|value| if value.trim().is_empty() { None } else { Some(value) });
    Some((provider_id, auth_method))
  } else {
    selected_onboarding_provider(&conn)?
  }
  .ok_or_else(|| "No onboarding provider selected yet".to_string())?;

  let (provider_id, auth_method) = selected;
  let contract = onboarding_model_contract_value(&conn, provider_id, auth_method)?;
  Ok(json!({ "contract": contract }))
}

#[tauri::command]
pub fn middleware_onboarding_model_submit(input: OnboardingModelSubmitInput) -> Result<Value, String> {
  let conn = open_db()?;
  let (provider_id, auth_method) = match input.provider_id {
    Some(provider_id) => {
      let auth_method = get_app_setting(&conn, APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD)?
        .and_then(|value| if value.trim().is_empty() { None } else { Some(value) });
      (provider_id, auth_method)
    }
    None => selected_onboarding_provider(&conn)?
      .ok_or_else(|| "No onboarding provider selected yet".to_string())?,
  };

  let model_ref = input.model_ref.trim();
  if model_ref.is_empty() {
    return Err("modelRef is required".to_string());
  }
  if !model_ref.contains('/') {
    return Err("modelRef must use provider/model format".to_string());
  }
  if !model_ref.starts_with(&format!("{provider_id}/")) {
    return Err(format!(
      "modelRef '{}' does not belong to selected provider {}",
      model_ref, provider_id
    ));
  }

  let mut config = read_openclaw_config_value()?;
  set_json_path(
    &mut config,
    "agents.defaults.model.primary",
    Value::String(model_ref.to_string()),
  );
  write_openclaw_config_value(&config)?;

  set_app_setting(&conn, APP_SETTING_ONBOARDING_MODEL_REF, model_ref)?;
  set_app_setting(&conn, APP_SETTING_ONBOARDING_MODEL_PROVIDER_ID, &provider_id)?;

  let contract = onboarding_model_contract_value(&conn, provider_id.clone(), auth_method)?;
  Ok(json!({
    "ok": true,
    "providerId": provider_id,
    "modelRef": model_ref,
    "saved": {
      "setDefault": input.set_default.unwrap_or(true),
      "configPaths": ["agents.defaults.model.primary"],
    },
    "nextStep": "complete",
    "openClawFlow": ["onboarding", "complete"],
    "contract": contract,
  }))
}

#[tauri::command]
pub async fn middleware_onboarding_flow(input: Option<OnboardingCoreInput>) -> Result<Value, String> {
  let gateway_url = input
    .and_then(|value| value.gateway_url)
    .unwrap_or_else(|| format!("ws://127.0.0.1:{}", DEFAULT_GATEWAY_PORT));
  let core_status = onboarding_snapshot(gateway_url).await;
  let conn = open_db()?;
  let bot_name = get_app_setting(&conn, APP_SETTING_OPENCLAW_BOT_NAME)?;
  let selected_provider = selected_onboarding_provider(&conn)?;
  let config = read_openclaw_config_value().unwrap_or_else(|_| json!({}));
  let selected_model_ref = get_app_setting(&conn, APP_SETTING_ONBOARDING_MODEL_REF)?
    .or_else(|| value_at_json_path(&config, "agents.defaults.model.primary").and_then(Value::as_str).map(ToString::to_string));

  let provider_details = if let Some((provider_id, auth_method)) = selected_provider.clone() {
    Some(json!({
      "providerId": provider_id,
      "authMethod": auth_method,
    }))
  } else {
    None
  };
  let model_contract = if let Some((provider_id, auth_method)) = selected_provider.clone() {
    Some(onboarding_model_contract_value(&conn, provider_id, auth_method)?)
  } else {
    None
  };
  let flow = onboarding_step_state(&core_status, bot_name.clone(), selected_provider.is_some(), selected_model_ref.is_some());

  Ok(json!({
    "flow": flow,
    "state": {
      "core": {
        "status": core_status,
        "checkEndpoint": "middleware_onboarding_core",
      },
      "bot": {
        "botName": bot_name,
        "getEndpoint": "middleware_openclaw_bot_name_get",
        "setEndpoint": "middleware_openclaw_bot_name_set",
      },
      "provider": {
        "selection": provider_details,
        "listEndpoint": "middleware_onboarding_providers",
        "typesEndpoint": "middleware_onboarding_provider_types",
        "detailsEndpoint": "middleware_onboarding_provider_details",
        "submitEndpoint": "middleware_onboarding_provider_submit",
      },
      "model": {
        "selectedModelRef": selected_model_ref,
        "contractEndpoint": "middleware_onboarding_model_contract",
        "submitEndpoint": "middleware_onboarding_model_submit",
        "contract": model_contract,
      }
    }
  }))
}

#[tauri::command]
pub async fn middleware_onboarding_core(input: OnboardingCoreInput) -> Result<Value, String> {
  let gateway_url = input.gateway_url.unwrap_or_else(|| format!("ws://127.0.0.1:{}", DEFAULT_GATEWAY_PORT));
  let action = input.action.unwrap_or_else(|| "check".to_string());
  let mut actions_run: Vec<String> = Vec::new();

  if action == "apply" {
    let before = onboarding_snapshot(gateway_url.clone()).await;
    let node_installed = before.get("node").and_then(|v| v.get("installed")).and_then(Value::as_bool).unwrap_or(false);
    let npm_installed = before.get("npm").and_then(|v| v.get("installed")).and_then(Value::as_bool).unwrap_or(false);
    let openclaw_installed = before.get("openclaw").and_then(|v| v.get("installed")).and_then(Value::as_bool).unwrap_or(false);
    let gateway_is_running = before.get("gateway").and_then(|v| v.get("running")).and_then(Value::as_bool).unwrap_or(false);

    if !node_installed {
      return Ok(json!({
        "action": action,
        "applied": false,
        "canAutoFix": false,
        "message": "Node.js is not installed. Install Node.js first, then rerun onboarding.",
        "manualAction": "install_node",
        "docsUrl": "https://nodejs.org/en/download",
        "status": before,
        "actionsRun": actions_run,
      }));
    }

    if !npm_installed {
      return Ok(json!({
        "action": action,
        "applied": false,
        "canAutoFix": false,
        "message": "npm is not installed. Install npm first, then rerun onboarding.",
        "manualAction": "install_npm",
        "docsUrl": "https://docs.npmjs.com/downloading-and-installing-node-js-and-npm",
        "status": before,
        "actionsRun": actions_run,
      }));
    }

    if !openclaw_installed {
      let output = tokio::process::Command::new("npm")
        .args(&["i", "-g", "openclaw"])
        .output()
        .await
        .map_err(|e| format!("Failed to run npm install: {}", e))?;

      if !output.status.success() {
        return Err(format!(
          "OpenClaw npm install failed: {}",
          String::from_utf8_lossy(&output.stderr)
        ));
      }

      actions_run.push("npm i -g openclaw".to_string());
    }

    if !gateway_is_running {
      let output = tokio::process::Command::new("openclaw")
        .args(&["gateway", "start"])
        .output()
        .await
        .map_err(|e| format!("Failed to start OpenClaw Gateway: {}", e))?;

      if !output.status.success() {
        return Err(format!(
          "OpenClaw gateway start failed: {}",
          String::from_utf8_lossy(&output.stderr)
        ));
      }

      actions_run.push("openclaw gateway start".to_string());
    }
  }

  let status = onboarding_snapshot(gateway_url).await;
  let recommendation = status.get("recommendation").and_then(Value::as_str).unwrap_or("install_node");

  Ok(json!({
    "action": action,
    "applied": action == "apply" && !actions_run.is_empty(),
    "canAutoFix": matches!(recommendation, "install_openclaw" | "start_gateway" | "ready"),
    "status": status,
    "actionsRun": actions_run,
  }))
}

#[tauri::command]
pub async fn middleware_openclaw_check(input: OpenClawCheckInput) -> Result<Value, String> {
  let status = onboarding_snapshot(
    input.gateway_url.unwrap_or_else(|| format!("ws://127.0.0.1:{}", DEFAULT_GATEWAY_PORT))
  ).await;

  Ok(json!({
    "installed": status.get("openclaw").and_then(|v| v.get("installed")).and_then(Value::as_bool).unwrap_or(false),
    "running": status.get("gateway").and_then(|v| v.get("running")).and_then(Value::as_bool).unwrap_or(false),
    "version": status.get("openclaw").and_then(|v| v.get("version")).cloned().unwrap_or(Value::Null),
    "gateway": status.get("gateway").cloned().unwrap_or(Value::Null),
    "recommendation": match status.get("recommendation").and_then(Value::as_str).unwrap_or("install_openclaw") {
      "ready" => "ready",
      "start_gateway" => "start",
      _ => "install",
    },
    "core": status,
  }))
}

#[tauri::command]
pub async fn middleware_openclaw_install(_input: OpenClawInstallInput) -> Result<Value, String> {
  let result = middleware_onboarding_core(OnboardingCoreInput {
    action: Some("apply".to_string()),
    gateway_url: None,
  }).await?;

  Ok(json!({
    "installed": result.get("status").and_then(|v| v.get("openclaw")).and_then(|v| v.get("installed")).and_then(Value::as_bool).unwrap_or(false),
    "running": result.get("status").and_then(|v| v.get("gateway")).and_then(|v| v.get("running")).and_then(Value::as_bool).unwrap_or(false),
    "actionsRun": result.get("actionsRun").cloned().unwrap_or_else(|| json!([])),
    "status": result.get("status").cloned().unwrap_or(Value::Null),
  }))
}


