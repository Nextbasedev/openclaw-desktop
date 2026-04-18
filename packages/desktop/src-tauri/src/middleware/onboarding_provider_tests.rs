use super::*;

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
fn onboarding_provider_details_errors_for_unknown_provider() {
  let error = middleware_onboarding_provider_details(OnboardingProviderInput {
    provider_id: "definitely-not-real".to_string(),
  })
  .expect_err("unknown provider should fail");

  assert!(error.contains("Unsupported OpenClaw provider"));
}
