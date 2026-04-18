use super::test_support::{with_locked_env, with_test_db};
use super::*;
use tempfile::tempdir;

#[test]
fn onboarding_providers_lists_real_openclaw_providers() {
  let result = middleware_onboarding_providers().expect("list providers");
  let providers = result
    .get("providers")
    .and_then(Value::as_array)
    .expect("providers array");

  assert!(!providers.is_empty());
  assert!(providers.iter().any(|provider| {
    provider.get("id").and_then(Value::as_str) == Some("openai")
      && provider.get("pluginId").and_then(Value::as_str) == Some("openai")
  }));
  assert!(providers.iter().any(|provider| {
    provider.get("id").and_then(Value::as_str) == Some("anthropic")
      && provider
        .get("authEnvVars")
        .and_then(Value::as_array)
        .map(|envs| envs.iter().any(|value| value.as_str() == Some("ANTHROPIC_API_KEY")))
        .unwrap_or(false)
  }));
}

#[test]
fn onboarding_provider_types_exposes_frontend_submit_schema() {
  let result = middleware_onboarding_provider_types().expect("provider types");
  let providers = result
    .get("providers")
    .and_then(Value::as_array)
    .expect("providers array");

  let openai = providers
    .iter()
    .find(|provider| provider.get("providerId").and_then(Value::as_str) == Some("openai"))
    .expect("openai provider types");

  assert_eq!(
    openai
      .get("types")
      .and_then(|value| value.get("submitEndpoint"))
      .and_then(Value::as_str),
    Some("middleware_onboarding_provider_submit")
  );
  assert!(openai
    .get("types")
    .and_then(|value| value.get("payloadShape"))
    .and_then(|value| value.get("values"))
    .and_then(|value| value.get("fields"))
    .and_then(|value| value.get("credentials"))
    .and_then(Value::as_array)
    .map(|fields| {
      fields.iter().any(|field| {
        field.get("key").and_then(Value::as_str) == Some("openaiApiKey")
          && field.get("inputKind").and_then(Value::as_str) == Some("secret")
      })
    })
    .unwrap_or(false));
}

#[test]
fn onboarding_provider_details_returns_auth_and_schema_fields() {
  let openai = middleware_onboarding_provider_details(OnboardingProviderInput {
    provider_id: "openai".to_string(),
  })
  .expect("openai details");
  let openai_provider = openai.get("provider").expect("provider");
  assert_eq!(openai_provider.get("id").and_then(Value::as_str), Some("openai"));
  assert!(openai_provider
    .get("authEnvVars")
    .and_then(Value::as_array)
    .map(|envs| envs.iter().any(|value| value.as_str() == Some("OPENAI_API_KEY")))
    .unwrap_or(false));
  assert!(openai_provider
    .get("configFields")
    .and_then(Value::as_array)
    .map(|fields| fields.iter().any(|field| field.get("path").and_then(Value::as_str) == Some("personality")))
    .unwrap_or(false));
  assert!(openai_provider.get("submit").is_some());

  let xai = middleware_onboarding_provider_details(OnboardingProviderInput {
    provider_id: "xai".to_string(),
  })
  .expect("xai details");
  let xai_provider = xai.get("provider").expect("provider");
  assert!(xai_provider
    .get("configFields")
    .and_then(Value::as_array)
    .map(|fields| {
      fields.iter().any(|field| field.get("path").and_then(Value::as_str) == Some("codeExecution.enabled"))
        && fields.iter().any(|field| field.get("path").and_then(Value::as_str) == Some("xSearch.timeoutSeconds"))
    })
    .unwrap_or(false));
}

#[test]
fn onboarding_provider_submit_persists_selection_and_openclaw_config() {
  with_test_db(|| {
    with_locked_env(|| {
      let temp_home = tempdir().expect("temp home");
      let previous_home = std::env::var_os("HOME");
      std::env::set_var("HOME", temp_home.path());

      let result = middleware_onboarding_provider_submit(OnboardingProviderSubmitInput {
        provider_id: "openai".to_string(),
        auth_method: Some("api-key".to_string()),
        values: Some(json!({
          "openaiApiKey": "sk-test-openai",
          "personality": "friendly"
        })),
        set_default: Some(true),
      })
      .expect("submit provider");

      assert_eq!(result.get("nextStep").and_then(Value::as_str), Some("model-selection"));
      assert!(result
        .get("saved")
        .and_then(|value| value.get("envVars"))
        .and_then(Value::as_array)
        .map(|envs| envs.iter().any(|value| value.as_str() == Some("OPENAI_API_KEY")))
        .unwrap_or(false));

      let config_path = temp_home.path().join(".openclaw").join("openclaw.json");
      let written = std::fs::read_to_string(config_path).expect("written config");
      let parsed: Value = serde_json::from_str(&written).expect("valid config json");
      assert_eq!(
        value_at_json_path(&parsed, "env.vars.OPENAI_API_KEY").and_then(Value::as_str),
        Some("sk-test-openai")
      );
      assert_eq!(
        value_at_json_path(&parsed, "openai.personality").and_then(Value::as_str),
        Some("friendly")
      );

      let conn = open_db().expect("open db");
      assert_eq!(
        get_app_setting(&conn, APP_SETTING_ONBOARDING_PROVIDER_ID).expect("provider id setting"),
        Some("openai".to_string())
      );
      assert_eq!(
        get_app_setting(&conn, APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD)
          .expect("provider auth setting"),
        Some("api-key".to_string())
      );

      match previous_home {
        Some(home) => std::env::set_var("HOME", home),
        None => std::env::remove_var("HOME"),
      }
    })
  });
}

#[test]
fn onboarding_provider_details_errors_for_unknown_provider() {
  let error = middleware_onboarding_provider_details(OnboardingProviderInput {
    provider_id: "definitely-not-real".to_string(),
  })
  .expect_err("unknown provider should fail");

  assert!(error.contains("Unsupported OpenClaw provider"));
}

#[test]
fn onboarding_model_contract_and_submit_persist_default_model() {
  with_test_db(|| {
    with_locked_env(|| {
      let temp_home = tempdir().expect("temp home");
      let previous_home = std::env::var_os("HOME");
      std::env::set_var("HOME", temp_home.path());

      middleware_onboarding_provider_submit(OnboardingProviderSubmitInput {
        provider_id: "openai".to_string(),
        auth_method: Some("api-key".to_string()),
        values: Some(json!({
          "openaiApiKey": "sk-test-openai",
          "personality": "friendly"
        })),
        set_default: Some(true),
      })
      .expect("submit provider");

      let contract = middleware_onboarding_model_contract(None).expect("model contract");
      assert_eq!(
        contract
          .get("contract")
          .and_then(|value| value.get("providerId"))
          .and_then(Value::as_str),
        Some("openai")
      );
      assert_eq!(
        contract
          .get("contract")
          .and_then(|value| value.get("recommendedModelRef"))
          .and_then(Value::as_str),
        Some("openai/gpt-5.4")
      );

      let submitted = middleware_onboarding_model_submit(OnboardingModelSubmitInput {
        provider_id: None,
        model_ref: "openai/gpt-5.4".to_string(),
        set_default: Some(true),
      })
      .expect("submit model");

      assert_eq!(submitted.get("nextStep").and_then(Value::as_str), Some("complete"));

      let config_path = temp_home.path().join(".openclaw").join("openclaw.json");
      let written = std::fs::read_to_string(config_path).expect("written config");
      let parsed: Value = serde_json::from_str(&written).expect("valid config json");
      assert_eq!(
        value_at_json_path(&parsed, "agents.defaults.model.primary").and_then(Value::as_str),
        Some("openai/gpt-5.4")
      );

      let conn = open_db().expect("open db");
      assert_eq!(
        get_app_setting(&conn, APP_SETTING_ONBOARDING_MODEL_REF).expect("model ref setting"),
        Some("openai/gpt-5.4".to_string())
      );

      match previous_home {
        Some(home) => std::env::set_var("HOME", home),
        None => std::env::remove_var("HOME"),
      }
    })
  });
}

#[test]
fn onboarding_flow_reports_next_step_and_completion() {
  with_test_db(|| {
    with_locked_env(|| {
      let conn = open_db().expect("open db");
      set_app_setting(&conn, APP_SETTING_OPENCLAW_BOT_NAME, "Jarvis").expect("bot name");
      set_app_setting(&conn, APP_SETTING_ONBOARDING_PROVIDER_ID, "openai").expect("provider id");
      set_app_setting(&conn, APP_SETTING_ONBOARDING_PROVIDER_AUTH_METHOD, "api-key").expect("auth method");
      set_app_setting(&conn, APP_SETTING_ONBOARDING_MODEL_REF, "openai/gpt-5.4").expect("model ref");

      let rt = tokio::runtime::Runtime::new().expect("runtime");
      let flow = rt.block_on(middleware_onboarding_flow(Some(OnboardingCoreInput {
        action: Some("check".to_string()),
        gateway_url: Some("ws://127.0.0.1:65534".to_string()),
      })))
      .expect("onboarding flow");

      let core_recommendation = flow
        .get("state")
        .and_then(|value| value.get("core"))
        .and_then(|value| value.get("status"))
        .and_then(|value| value.get("recommendation"))
        .and_then(Value::as_str);
      let expected_next_step = if core_recommendation == Some("ready") {
        "complete"
      } else {
        "core"
      };

      assert_eq!(
        flow.get("flow").and_then(|value| value.get("nextStep")).and_then(Value::as_str),
        Some(expected_next_step)
      );
      assert_eq!(
        flow.get("state").and_then(|value| value.get("model")).and_then(|value| value.get("selectedModelRef")).and_then(Value::as_str),
        Some("openai/gpt-5.4")
      );
    })
  });
}
