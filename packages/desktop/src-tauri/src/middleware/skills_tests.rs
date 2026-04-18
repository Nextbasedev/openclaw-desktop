use super::*;
use super::test_support::with_locked_env_async;
use std::fs;
use tempfile::tempdir;

#[test]
fn parse_skill_frontmatter_reads_name_and_description() {
  let raw = r#"---
name: openclaw-cli
description: Operate OpenClaw safely
---

# Skill
"#;

  let (name, description) = parse_skill_frontmatter(raw);
  assert_eq!(name.as_deref(), Some("openclaw-cli"));
  assert_eq!(description.as_deref(), Some("Operate OpenClaw safely"));
}

#[test]
fn parse_clawhub_search_line_handles_cli_output() {
  let parsed = parse_clawhub_search_line("openclaw-cli  OpenClaw CLI  (3.715)").expect("parse result");
  assert_eq!(parsed.0, "openclaw-cli");
  assert_eq!(parsed.1, "OpenClaw CLI");
}

#[test]
fn parse_github_repo_reference_supports_url_and_owner_repo() {
  let from_url = parse_github_repo_reference("https://github.com/example/skill-repo").expect("url");
  assert_eq!(from_url.0, "example");
  assert_eq!(from_url.1, "skill-repo");

  let from_short = parse_github_repo_reference("example/skill-repo").expect("short");
  assert_eq!(from_short.2, "https://github.com/example/skill-repo");
}

#[tokio::test]
async fn skills_discover_returns_local_skill_matches() {
  with_locked_env_async(|| async {
    let temp = tempdir().expect("tempdir");
    let home = temp.path();
    std::env::set_var("HOME", home);

    let local_skill_dir = home.join(".openclaw").join("skills").join("sample-skill");
    fs::create_dir_all(&local_skill_dir).expect("create skill dir");
    fs::write(
      local_skill_dir.join("SKILL.md"),
      "---\nname: Sample Skill\ndescription: Sample local discovery skill\n---\n",
    )
    .expect("write skill");

    let result = middleware_skills_discover(Some(SkillDiscoverInput {
      query: Some("sample".to_string()),
      limit: Some(5),
      include_local: Some(true),
      include_claw_hub: Some(false),
      include_github_probe: Some(false),
    }))
    .await
    .expect("discover skills");

    let results = result.get("results").and_then(Value::as_array).expect("results array");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].get("slug").and_then(Value::as_str), Some("sample-skill"));
    assert_eq!(results[0].get("installed").and_then(Value::as_bool), Some(true));
  }).await;
}

#[tokio::test]
async fn skills_install_copies_local_skill_into_user_scope() {
  with_locked_env_async(|| async {
    let temp = tempdir().expect("tempdir");
    let home = temp.path();
    std::env::set_var("HOME", home);

    let source_skill_dir = home.join("incoming-skill");
    fs::create_dir_all(&source_skill_dir).expect("create source skill dir");
    fs::write(
      source_skill_dir.join("SKILL.md"),
      "---\nname: Incoming Skill\ndescription: Installs from a local path\n---\n",
    )
    .expect("write source skill");
    fs::write(source_skill_dir.join("README.md"), "hello\n").expect("write readme");

    let result = middleware_skills_install(SkillInstallInput {
      source: "local".to_string(),
      slug: None,
      version: None,
      repo_url: None,
      git_ref: None,
      local_path: Some(source_skill_dir.to_string_lossy().to_string()),
      scope: Some("user".to_string()),
      force: Some(false),
    })
    .await
    .expect("install skill");

    assert_eq!(result.get("status").and_then(Value::as_str), Some("installed"));
    let install_path = home.join(".openclaw").join("skills").join("incoming-skill");
    assert!(install_path.join("SKILL.md").exists());
    assert!(install_path.join("README.md").exists());
    assert_eq!(result.get("location").and_then(|v| v.get("scope")).and_then(Value::as_str), Some("user"));
  }).await;
}

#[tokio::test]
async fn ensure_clawhub_cli_succeeds_when_available() {
  let result = ensure_clawhub_cli().await;
  assert!(result.is_ok(), "ensure_clawhub_cli failed: {:?}", result.err());
}
