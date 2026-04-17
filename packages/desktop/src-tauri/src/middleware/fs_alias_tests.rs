use super::*;
use super::test_support::{path_string, with_test_db};
use tempfile::tempdir;

#[test]
fn files_aliases_behave_like_project_file_commands() {
  with_test_db(|| {
    let temp = tempdir().expect("create temp dir");
    let workspace_root = temp.path();
    let dir = workspace_root.join("beta");
    let file = dir.join("alias.txt");
    let renamed = dir.join("alias-renamed.txt");

    let project = middleware_projects_create(ProjectCreateInput {
      name: "Alias Project".to_string(),
      profile_id: "prof_alias".to_string(),
      workspace_root: path_string(workspace_root),
      repo_root: Some(path_string(workspace_root)),
    }).expect("create alias project");
    let project_id = project.get("project").and_then(|p| p.get("id")).and_then(Value::as_str).expect("project id").to_string();

    middleware_files_mkdir(FilePathInput { project_id: project_id.clone(), path: "/beta".to_string() }).expect("alias mkdir");
    middleware_files_write(FileWriteInput { project_id: project_id.clone(), path: "/beta/alias.txt".to_string(), content: "alias data".to_string() }).expect("alias write");
    let read = middleware_files_read(FilePathInput { project_id: project_id.clone(), path: "/beta/alias.txt".to_string() }).expect("alias read");
    assert_eq!(read.get("file").and_then(|v| v.get("content")).and_then(Value::as_str), Some("alias data"));

    let tree = middleware_files_tree(FilePathInput { project_id: project_id.clone(), path: "/beta".to_string() }).expect("alias tree");
    assert_eq!(tree.get("nodes").and_then(Value::as_array).map(|v| v.len()), Some(1));

    let search = middleware_files_search(FileSearchInput { project_id: project_id.clone(), query: "alias".to_string() }).expect("alias search");
    assert_eq!(search.get("results").and_then(Value::as_array).map(|v| v.len()), Some(1));

    middleware_files_rename(FileRenameInput { project_id: project_id.clone(), from: "/beta/alias.txt".to_string(), to: "/beta/alias-renamed.txt".to_string() }).expect("alias rename");
    assert!(renamed.exists());
    assert!(!file.exists());

    middleware_files_delete(FilePathInput { project_id: project_id, path: "/beta/alias-renamed.txt".to_string() }).expect("alias delete");
    assert!(!renamed.exists());
  });
}
