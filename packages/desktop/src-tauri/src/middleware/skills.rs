use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDiscoverInput {
  pub(crate) query: Option<String>,
  pub(crate) limit: Option<usize>,
  pub(crate) include_local: Option<bool>,
  pub(crate) include_claw_hub: Option<bool>,
  pub(crate) include_github_probe: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallInput {
  pub(crate) source: String,
  pub(crate) slug: Option<String>,
  pub(crate) version: Option<String>,
  pub(crate) repo_url: Option<String>,
  #[serde(rename = "ref")]
  pub(crate) git_ref: Option<String>,
  pub(crate) local_path: Option<String>,
  pub(crate) scope: Option<String>,
  pub(crate) force: Option<bool>,
}

pub(crate) fn openclaw_user_root() -> Result<PathBuf, String> {
  Ok(home_dir()?.join(".openclaw"))
}

pub(crate) fn openclaw_skill_root_for_scope(scope: &str) -> Result<PathBuf, String> {
  let root = match scope {
    "workspace" => openclaw_user_root()?.join("workspace").join("skills"),
    _ => openclaw_user_root()?.join("skills"),
  };
  fs::create_dir_all(&root).map_err(|error| format!("Failed to create skill install root {}: {error}", root.display()))?;
  Ok(root)
}

pub(crate) fn parse_skill_frontmatter(raw: &str) -> (Option<String>, Option<String>) {
  let trimmed = raw.trim();
  if let Some(frontmatter) = trimmed.strip_prefix("---") {
    if let Some((body, _)) = frontmatter.split_once("\n---") {
      let mut name = None;
      let mut description = None;
      for line in body.lines() {
        if let Some(value) = line.strip_prefix("name:") {
          name = Some(value.trim().trim_matches('"').to_string());
        }
        if let Some(value) = line.strip_prefix("description:") {
          description = Some(value.trim().trim_matches('"').to_string());
        }
      }
      return (name, description);
    }
  }

  let description = trimmed
    .lines()
    .map(str::trim)
    .find(|line| !line.is_empty() && !line.starts_with('#'))
    .map(ToString::to_string);
  (None, description)
}

pub(crate) fn skill_json(
  id: String,
  slug: String,
  name: String,
  summary: Option<String>,
  description: Option<String>,
  source: &str,
  version: Option<String>,
  installed: bool,
  install_source: &str,
  repo_url: Option<String>,
  homepage_url: Option<String>,
  local_path: Option<String>,
  tags: Vec<String>,
) -> Value {
  json!({
    "id": id,
    "slug": slug,
    "name": name,
    "summary": summary,
    "description": description,
    "source": source,
    "version": version,
    "installed": installed,
    "installSource": install_source,
    "repoUrl": repo_url,
    "homepageUrl": homepage_url,
    "localPath": local_path,
    "tags": tags,
  })
}

pub(crate) fn scan_local_skills_in_root(root: &Path, source_label: &str, query: &str) -> Vec<Value> {
  let mut results = vec![];
  let entries = match fs::read_dir(root) {
    Ok(entries) => entries,
    Err(_) => return results,
  };

  for entry in entries.flatten() {
    let path = entry.path();
    if !path.is_dir() {
      continue;
    }
    let skill_md = path.join("SKILL.md");
    if !skill_md.exists() {
      continue;
    }
    let slug = entry.file_name().to_string_lossy().to_string();
    let raw = fs::read_to_string(&skill_md).unwrap_or_default();
    let (frontmatter_name, frontmatter_description) = parse_skill_frontmatter(&raw);
    let name = frontmatter_name.unwrap_or_else(|| slug.clone());
    let description = frontmatter_description;
    let haystack = format!("{}\n{}\n{}", slug, name, description.clone().unwrap_or_default()).to_lowercase();
    if !query.is_empty() && !haystack.contains(query) {
      continue;
    }
    results.push(skill_json(
      format!("{source_label}:{slug}"),
      slug,
      name,
      description.clone(),
      description,
      "local",
      None,
      true,
      "local",
      None,
      None,
      Some(path.to_string_lossy().to_string()),
      vec![],
    ));
  }

  results
}

pub(crate) fn parse_clawhub_search_line(line: &str) -> Option<(String, String)> {
  let trimmed = line.trim();
  if trimmed.is_empty() || trimmed.starts_with('-') {
    return None;
  }
  let without_score = trimmed.split("  (").next()?.trim();
  let (slug, display_name) = without_score.split_once("  ")?;
  Some((slug.trim().to_string(), display_name.trim().to_string()))
}

pub(crate) fn parse_github_repo_reference(input: &str) -> Option<(String, String, String)> {
  let trimmed = input.trim().trim_end_matches('/');
  if trimmed.is_empty() {
    return None;
  }
  if let Some(rest) = trimmed.strip_prefix("https://github.com/") {
    let mut parts = rest.split('/');
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim();
    if owner.is_empty() || repo.is_empty() {
      return None;
    }
    return Some((owner.to_string(), repo.to_string(), format!("https://github.com/{owner}/{repo}")));
  }
  let parts = trimmed.split('/').collect::<Vec<_>>();
  if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
    return Some((parts[0].to_string(), parts[1].to_string(), format!("https://github.com/{}/{}", parts[0], parts[1])));
  }
  None
}

pub(crate) async fn clawhub_search_skills(query: &str, limit: usize) -> Result<Vec<Value>, String> {
  let output = tokio::process::Command::new("clawhub")
    .args(["search", query, "--limit", &limit.to_string()])
    .output()
    .await
    .map_err(|error| format!("Failed to run clawhub search: {error}"))?;
  if !output.status.success() {
    return Err(format!("clawhub search failed: {}", String::from_utf8_lossy(&output.stderr)));
  }

  let mut results = vec![];
  for line in String::from_utf8_lossy(&output.stdout).lines() {
    let Some((slug, name)) = parse_clawhub_search_line(line) else {
      continue;
    };
    let inspect_output = tokio::process::Command::new("clawhub")
      .args(["inspect", &slug, "--json"])
      .output()
      .await
      .ok();

    let mut summary = None;
    let mut version = None;
    let mut tags = vec![];
    if let Some(inspect_output) = inspect_output {
      if inspect_output.status.success() {
        let stdout = String::from_utf8_lossy(&inspect_output.stdout);
        if let Some(json_start) = stdout.find('{') {
          if let Ok(payload) = serde_json::from_str::<Value>(&stdout[json_start..]) {
            summary = string_from_value(payload.get("skill").and_then(|skill| skill.get("summary")));
            version = string_from_value(payload.get("latestVersion").and_then(|latest| latest.get("version")));
            tags = payload
              .get("skill")
              .and_then(|skill| skill.get("tags"))
              .and_then(Value::as_object)
              .map(|obj| obj.keys().cloned().collect::<Vec<_>>())
              .unwrap_or_default();
          }
        }
      }
    }

    results.push(skill_json(
      format!("clawhub:{slug}"),
      slug,
      name,
      summary.clone(),
      summary,
      "clawhub",
      version,
      false,
      "clawhub",
      None,
      Some("https://clawhub.com".to_string()),
      None,
      tags,
    ));
  }

  Ok(results)
}

pub(crate) async fn probe_github_skill(query: &str) -> Result<Option<Value>, String> {
  let Some((owner, repo, repo_url)) = parse_github_repo_reference(query) else {
    return Ok(None);
  };

  let output = tokio::process::Command::new("git")
    .args(["ls-remote", "--symref", &repo_url, "HEAD"])
    .output()
    .await
    .map_err(|error| format!("Failed to inspect GitHub repo: {error}"))?;
  if !output.status.success() {
    return Ok(None);
  }

  let stdout = String::from_utf8_lossy(&output.stdout);
  let branch = stdout
    .lines()
    .find_map(|line| line.strip_prefix("ref: refs/heads/").and_then(|rest| rest.split_whitespace().next()))
    .unwrap_or("main");
  let raw_url = format!("https://raw.githubusercontent.com/{owner}/{repo}/{branch}/SKILL.md");
  let curl_output = tokio::process::Command::new("curl")
    .args(["-fsSL", &raw_url])
    .output()
    .await;

  let Ok(curl_output) = curl_output else {
    return Ok(None);
  };
  if !curl_output.status.success() {
    return Ok(None);
  }

  let raw_skill = String::from_utf8_lossy(&curl_output.stdout).to_string();
  let (frontmatter_name, frontmatter_description) = parse_skill_frontmatter(&raw_skill);
  let slug = repo.clone();
  Ok(Some(skill_json(
    format!("github:{owner}/{repo}"),
    slug.clone(),
    frontmatter_name.unwrap_or(slug),
    frontmatter_description.clone(),
    frontmatter_description,
    "github",
    None,
    false,
    "github",
    Some(repo_url.clone()),
    Some(repo_url),
    None,
    vec!["github".to_string(), "skill-md".to_string()],
  )))
}

pub(crate) fn builtin_skills(query: &str) -> Vec<Value> {
  let catalog = vec![
    ("openclaw-cli", "OpenClaw CLI", "Operate and troubleshoot the OpenClaw gateway and local runtime.", vec!["system"]),
    ("memory-manager", "Memory Manager", "Store, search, and organize long-term memory across conversations.", vec!["system"]),
    ("web-search", "Web Search", "Search the web and summarize results inline.", vec!["recommended"]),
    ("code-reviewer", "Code Reviewer", "Review pull requests and suggest improvements automatically.", vec!["recommended"]),
    ("doc-writer", "Doc Writer", "Generate and update documentation from source code.", vec!["recommended"]),
    ("pdf-reader", "PDF Reader", "Extract and summarize content from PDF documents.", vec!["recommended"]),
    ("image-gen", "Image Generator", "Generate images from text prompts using AI models.", vec!["recommended"]),
    ("shell-exec", "Shell Executor", "Run shell commands safely with approval workflows.", vec!["system"]),
    ("task-planner", "Task Planner", "Break complex goals into actionable step-by-step plans.", vec!["recommended"]),
    ("data-analyzer", "Data Analyzer", "Analyze CSV, JSON, and tabular data with summaries and charts.", vec!["recommended"]),
  ];

  let q = query.to_lowercase();
  catalog
    .into_iter()
    .filter(|(slug, name, summary, _)| {
      q.is_empty()
        || slug.contains(&q)
        || name.to_lowercase().contains(&q)
        || summary.to_lowercase().contains(&q)
    })
    .map(|(slug, name, summary, tags)| {
      skill_json(
        format!("builtin:{slug}"),
        slug.to_string(),
        name.to_string(),
        Some(summary.to_string()),
        Some(summary.to_string()),
        "clawhub",
        Some("1.0.0".to_string()),
        false,
        "clawhub",
        None,
        None,
        None,
        tags.into_iter().map(String::from).collect(),
      )
    })
    .collect()
}

pub(crate) fn merge_skill_results(results: Vec<Value>, limit: usize) -> Vec<Value> {
  let mut seen = HashSet::<String>::new();
  let mut merged = vec![];
  for result in results {
    let slug = result.get("slug").and_then(Value::as_str).unwrap_or_default().to_string();
    if slug.is_empty() || !seen.insert(slug) {
      continue;
    }
    merged.push(result);
    if merged.len() >= limit {
      break;
    }
  }
  merged
}

pub(crate) fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
  fs::create_dir_all(to).map_err(|error| format!("Failed to create directory {}: {error}", to.display()))?;
  for entry in fs::read_dir(from).map_err(|error| format!("Failed to read directory {}: {error}", from.display()))? {
    let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
    let source_path = entry.path();
    let target_path = to.join(entry.file_name());
    if source_path.is_dir() {
      copy_dir_recursive(&source_path, &target_path)?;
    } else {
      fs::copy(&source_path, &target_path).map_err(|error| {
        format!("Failed to copy {} to {}: {error}", source_path.display(), target_path.display())
      })?;
    }
  }
  Ok(())
}

pub(crate) fn installed_status_for_path(path: &Path) -> &'static str {
  if path.exists() { "already-installed" } else { "installed" }
}

#[tauri::command]
pub async fn middleware_skills_discover(input: Option<SkillDiscoverInput>) -> Result<Value, String> {
  let input = input.unwrap_or(SkillDiscoverInput {
    query: None,
    limit: None,
    include_local: None,
    include_claw_hub: None,
    include_github_probe: None,
  });
  let query = input.query.unwrap_or_default().trim().to_string();
  let query_lower = query.to_lowercase();
  let limit = input.limit.unwrap_or(10).clamp(1, 20);
  let include_local = input.include_local.unwrap_or(true);
  let include_clawhub = input.include_claw_hub.unwrap_or(true);
  let include_github_probe = input.include_github_probe.unwrap_or(true);

  let mut warnings: Vec<String> = vec![];
  let mut sources = vec![];
  let mut results = vec![];

  if include_local {
    sources.push("local");
    if let Ok(user_root) = openclaw_skill_root_for_scope("user") {
      results.extend(scan_local_skills_in_root(&user_root, "local-user", &query_lower));
    }
    if let Ok(workspace_root) = openclaw_skill_root_for_scope("workspace") {
      results.extend(scan_local_skills_in_root(&workspace_root, "local-workspace", &query_lower));
    }
  }

  if include_clawhub {
    sources.push("clawhub");
    match clawhub_search_skills(&query, limit).await {
      Ok(items) if !items.is_empty() => results.extend(items),
      Ok(_) | Err(_) => {
        results.extend(builtin_skills(&query_lower));
      }
    }
  }

  if include_github_probe {
    if let Some(probed) = probe_github_skill(&query).await? {
      if !sources.contains(&"github") {
        sources.push("github");
      }
      results.push(probed);
    }
  }

  Ok(json!({
    "query": query,
    "results": merge_skill_results(results, limit),
    "warnings": warnings,
    "sources": sources,
  }))
}

#[tauri::command]
pub async fn middleware_skills_install(input: SkillInstallInput) -> Result<Value, String> {
  let scope = input.scope.as_deref().unwrap_or("user");
  let force = input.force.unwrap_or(false);
  let root = openclaw_skill_root_for_scope(scope)?;
  let mut actions = vec![];
  let mut warnings = vec![];

  let (skill, location_path, status) = match input.source.as_str() {
    "clawhub" => {
      let slug = input.slug.clone().ok_or_else(|| "slug is required for ClawHub installs".to_string())?;
      let install_path = root.join(&slug);
      let status = installed_status_for_path(&install_path).to_string();
      let workdir = if scope == "workspace" { openclaw_user_root()?.join("workspace") } else { openclaw_user_root()? };
      let mut command = tokio::process::Command::new("clawhub");
      command.arg("install").arg(&slug).arg("--workdir").arg(&workdir).arg("--dir").arg("skills");
      if let Some(version) = input.version.as_deref() {
        command.arg("--version").arg(version);
      }
      if force {
        command.arg("--force");
      }
      let output = command.output().await.map_err(|error| format!("Failed to run clawhub install: {error}"))?;
      if !output.status.success() {
        return Err(format!("clawhub install failed: {}", String::from_utf8_lossy(&output.stderr)));
      }
      actions.push(format!("clawhub install {slug}"));
      let raw_skill = fs::read_to_string(install_path.join("SKILL.md")).unwrap_or_default();
      let (frontmatter_name, frontmatter_description) = parse_skill_frontmatter(&raw_skill);
      (
        skill_json(
          format!("clawhub:{slug}"),
          slug.clone(),
          frontmatter_name.unwrap_or_else(|| slug.clone()),
          frontmatter_description.clone(),
          frontmatter_description,
          "clawhub",
          input.version.clone(),
          true,
          "clawhub",
          None,
          Some("https://clawhub.com".to_string()),
          Some(install_path.to_string_lossy().to_string()),
          vec![],
        ),
        install_path,
        status,
      )
    }
    "github" => {
      let repo_url = input.repo_url.clone().ok_or_else(|| "repoUrl is required for GitHub installs".to_string())?;
      let (_, repo, normalized_repo_url) = parse_github_repo_reference(&repo_url)
        .ok_or_else(|| "repoUrl must be a GitHub repository URL or owner/repo".to_string())?;
      let install_path = root.join(&repo);
      let status = installed_status_for_path(&install_path).to_string();
      if install_path.exists() {
        if !force {
          warnings.push("Skill already exists locally. Returning current install metadata without overwriting.".to_string());
        } else {
          fs::remove_dir_all(&install_path)
            .map_err(|error| format!("Failed to replace existing skill install {}: {error}", install_path.display()))?;
        }
      }
      if !install_path.exists() {
        let mut command = tokio::process::Command::new("git");
        command.arg("clone").arg("--depth").arg("1");
        if let Some(git_ref) = input.git_ref.as_deref() {
          command.arg("--branch").arg(git_ref);
        }
        command.arg(&normalized_repo_url).arg(&install_path);
        let output = command.output().await.map_err(|error| format!("Failed to clone skill repo: {error}"))?;
        if !output.status.success() {
          return Err(format!("Git clone failed: {}", String::from_utf8_lossy(&output.stderr)));
        }
        actions.push(format!("git clone {} {}", normalized_repo_url, install_path.display()));
      }
      let skill_md = install_path.join("SKILL.md");
      if !skill_md.exists() {
        return Err(format!("Installed repository is missing SKILL.md: {}", install_path.display()));
      }
      let raw_skill = fs::read_to_string(&skill_md).map_err(|error| format!("Failed to read {}: {error}", skill_md.display()))?;
      let (frontmatter_name, frontmatter_description) = parse_skill_frontmatter(&raw_skill);
      (
        skill_json(
          format!("github:{repo}"),
          repo.clone(),
          frontmatter_name.unwrap_or_else(|| repo.clone()),
          frontmatter_description.clone(),
          frontmatter_description,
          "github",
          None,
          true,
          "github",
          Some(normalized_repo_url.clone()),
          Some(normalized_repo_url),
          Some(install_path.to_string_lossy().to_string()),
          vec!["github".to_string(), "skill-md".to_string()],
        ),
        install_path,
        status,
      )
    }
    "local" => {
      let local_path = PathBuf::from(input.local_path.clone().ok_or_else(|| "localPath is required for local installs".to_string())?);
      let skill_md = local_path.join("SKILL.md");
      if !skill_md.exists() {
        return Err(format!("Local skill path must contain SKILL.md: {}", local_path.display()));
      }
      let slug = local_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("Could not derive skill slug from {}", local_path.display()))?
        .to_string();
      let install_path = root.join(&slug);
      let status = installed_status_for_path(&install_path).to_string();
      if install_path.exists() {
        if !force {
          warnings.push("Skill already exists locally. Returning current install metadata without overwriting.".to_string());
        } else {
          fs::remove_dir_all(&install_path)
            .map_err(|error| format!("Failed to replace existing skill install {}: {error}", install_path.display()))?;
        }
      }
      if !install_path.exists() {
        copy_dir_recursive(&local_path, &install_path)?;
        actions.push(format!("copy {} {}", local_path.display(), install_path.display()));
      }
      let raw_skill = fs::read_to_string(install_path.join("SKILL.md")).unwrap_or_default();
      let (frontmatter_name, frontmatter_description) = parse_skill_frontmatter(&raw_skill);
      (
        skill_json(
          format!("local:{slug}"),
          slug.clone(),
          frontmatter_name.unwrap_or_else(|| slug.clone()),
          frontmatter_description.clone(),
          frontmatter_description,
          "local",
          None,
          true,
          "local",
          None,
          None,
          Some(install_path.to_string_lossy().to_string()),
          vec![],
        ),
        install_path,
        status,
      )
    }
    other => return Err(format!("Unsupported skill install source: {other}")),
  };

  Ok(json!({
    "status": status,
    "skill": skill,
    "location": {
      "scope": scope,
      "root": root.to_string_lossy().to_string(),
      "path": location_path.to_string_lossy().to_string(),
    },
    "actions": actions,
    "warnings": warnings,
  }))
}


