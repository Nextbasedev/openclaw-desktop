use super::*;
use std::collections::HashMap;

fn approx_eq(a: &Value, expected: f64) {
  let actual = a.as_f64().unwrap();
  assert!(
    (actual - expected).abs() < 1e-10,
    "expected {expected}, got {actual}"
  );
}

fn make_gateway_session(key: &str, input: f64, output: f64, total_cost: f64) -> Value {
  json!({
    "key": key,
    "label": format!("Session {key}"),
    "model": "claude-sonnet-4-20250514",
    "usage": {
      "input": input,
      "output": output,
      "cacheRead": 0.0,
      "cacheWrite": 0.0,
      "totalTokens": input + output,
      "totalCost": total_cost,
      "inputCost": total_cost * 0.4,
      "outputCost": total_cost * 0.6,
      "cacheReadCost": 0.0,
      "cacheWriteCost": 0.0,
      "messageCounts": { "total": 10, "user": 3, "assistant": 3, "toolCalls": 2, "toolResults": 2, "errors": 0 },
      "firstActivity": 1700000000,
      "lastActivity": 1700003600,
    }
  })
}

// ============================================================================
// empty_cost_totals
// ============================================================================

#[test]
fn empty_cost_totals_returns_zeroed_floats() {
  let t = empty_cost_totals();
  assert_eq!(t["input"], 0.0);
  assert_eq!(t["output"], 0.0);
  assert_eq!(t["totalTokens"], 0.0);
  assert_eq!(t["totalCost"], 0.0);
  assert_eq!(t["inputCost"], 0.0);
  assert_eq!(t["outputCost"], 0.0);
  assert_eq!(t["cacheRead"], 0.0);
  assert_eq!(t["cacheWrite"], 0.0);
  assert_eq!(t["cacheReadCost"], 0.0);
  assert_eq!(t["cacheWriteCost"], 0.0);
  for key in ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "totalCost", "inputCost", "outputCost", "cacheReadCost", "cacheWriteCost"] {
    assert!(t[key].is_f64(), "{key} should be f64");
  }
}

// ============================================================================
// usage_to_totals
// ============================================================================

#[test]
fn usage_to_totals_extracts_fields_from_usage_object() {
  let usage = json!({
    "input": 1000.0,
    "output": 500.0,
    "cacheRead": 200.0,
    "cacheWrite": 100.0,
    "totalTokens": 1800.0,
    "totalCost": 0.05,
    "inputCost": 0.02,
    "outputCost": 0.03,
    "cacheReadCost": 0.005,
    "cacheWriteCost": 0.003,
  });
  let totals = usage_to_totals(&usage);
  assert_eq!(totals["input"], 1000.0);
  assert_eq!(totals["output"], 500.0);
  assert_eq!(totals["totalTokens"], 1800.0);
  assert_eq!(totals["totalCost"], 0.05);
}

#[test]
fn usage_to_totals_returns_zeros_for_null() {
  let totals = usage_to_totals(&Value::Null);
  assert_eq!(totals["totalTokens"], 0.0);
  assert_eq!(totals["totalCost"], 0.0);
}

#[test]
fn usage_to_totals_handles_missing_fields() {
  let usage = json!({ "input": 100.0 });
  let totals = usage_to_totals(&usage);
  assert_eq!(totals["input"], 100.0);
  assert_eq!(totals["output"], 0.0);
  assert_eq!(totals["totalCost"], 0.0);
}

// ============================================================================
// add_totals
// ============================================================================

#[test]
fn add_totals_sums_all_fields() {
  let a = json!({
    "input": 100.0, "output": 50.0, "cacheRead": 10.0, "cacheWrite": 5.0,
    "totalTokens": 165.0, "totalCost": 0.01,
    "inputCost": 0.004, "outputCost": 0.006, "cacheReadCost": 0.001, "cacheWriteCost": 0.0005,
  });
  let b = json!({
    "input": 200.0, "output": 100.0, "cacheRead": 20.0, "cacheWrite": 10.0,
    "totalTokens": 330.0, "totalCost": 0.02,
    "inputCost": 0.008, "outputCost": 0.012, "cacheReadCost": 0.002, "cacheWriteCost": 0.001,
  });
  let sum = add_totals(&a, &b);
  assert_eq!(sum["input"], 300.0);
  assert_eq!(sum["output"], 150.0);
  assert_eq!(sum["totalTokens"], 495.0);
  assert_eq!(sum["totalCost"], 0.03);
}

#[test]
fn add_totals_handles_empty_operand() {
  let a = json!({
    "input": 100.0, "output": 50.0, "cacheRead": 0.0, "cacheWrite": 0.0,
    "totalTokens": 150.0, "totalCost": 0.01,
    "inputCost": 0.004, "outputCost": 0.006, "cacheReadCost": 0.0, "cacheWriteCost": 0.0,
  });
  let zero = empty_cost_totals();
  let sum = add_totals(&a, &zero);
  assert_eq!(sum["input"], 100.0);
  assert_eq!(sum["totalCost"], 0.01);
}

// ============================================================================
// extract_session_usage_entry
// ============================================================================

#[test]
fn extract_session_usage_entry_maps_gateway_format() {
  let session = make_gateway_session("sess_1", 1000.0, 500.0, 0.05);
  let entry = extract_session_usage_entry(&session);
  assert_eq!(entry["key"], "sess_1");
  assert_eq!(entry["label"], "Session sess_1");
  assert_eq!(entry["model"], "claude-sonnet-4-20250514");
  assert_eq!(entry["totals"]["input"], 1000.0);
  assert_eq!(entry["totals"]["output"], 500.0);
  assert_eq!(entry["totals"]["totalCost"], 0.05);
  assert_eq!(entry["firstActivity"], 1700000000.0);
  assert_eq!(entry["lastActivity"], 1700003600.0);
}

#[test]
fn extract_session_usage_entry_handles_missing_usage() {
  let session = json!({ "key": "sess_empty" });
  let entry = extract_session_usage_entry(&session);
  assert_eq!(entry["key"], "sess_empty");
  assert_eq!(entry["totals"]["totalTokens"], 0.0);
  assert_eq!(entry["totals"]["totalCost"], 0.0);
}

// ============================================================================
// aggregate_usage_by_group
// ============================================================================

#[test]
fn aggregate_groups_sessions_correctly() {
  let sessions = vec![
    make_gateway_session("s1", 1000.0, 500.0, 0.05),
    make_gateway_session("s2", 2000.0, 1000.0, 0.10),
    make_gateway_session("s3", 500.0, 250.0, 0.025),
  ];
  let group_map: HashMap<String, String> = [
    ("s1".into(), "proj_a".into()),
    ("s2".into(), "proj_a".into()),
    ("s3".into(), "proj_b".into()),
  ].into();
  let group_names: HashMap<String, String> = [
    ("proj_a".into(), "Project A".into()),
    ("proj_b".into(), "Project B".into()),
  ].into();

  let mut result = aggregate_usage_by_group(&sessions, &group_map, &group_names);
  result.sort_by(|a, b| {
    a["groupId"].as_str().unwrap().cmp(&b["groupId"].as_str().unwrap())
  });

  assert_eq!(result.len(), 2);

  assert_eq!(result[0]["groupId"], "proj_a");
  assert_eq!(result[0]["groupName"], "Project A");
  assert_eq!(result[0]["sessionCount"], 2);
  approx_eq(&result[0]["totals"]["input"], 3000.0);
  approx_eq(&result[0]["totals"]["output"], 1500.0);
  approx_eq(&result[0]["totals"]["totalCost"], 0.15);

  assert_eq!(result[1]["groupId"], "proj_b");
  assert_eq!(result[1]["groupName"], "Project B");
  assert_eq!(result[1]["sessionCount"], 1);
  approx_eq(&result[1]["totals"]["input"], 500.0);
}

#[test]
fn aggregate_skips_unmapped_sessions() {
  let sessions = vec![
    make_gateway_session("mapped", 1000.0, 500.0, 0.05),
    make_gateway_session("unmapped", 2000.0, 1000.0, 0.10),
  ];
  let group_map: HashMap<String, String> = [("mapped".into(), "g1".into())].into();
  let group_names: HashMap<String, String> = [("g1".into(), "Group 1".into())].into();

  let result = aggregate_usage_by_group(&sessions, &group_map, &group_names);
  assert_eq!(result.len(), 1);
  assert_eq!(result[0]["sessionCount"], 1);
  assert_eq!(result[0]["totals"]["input"], 1000.0);
}

#[test]
fn aggregate_empty_sessions_returns_empty() {
  let group_map: HashMap<String, String> = HashMap::new();
  let group_names: HashMap<String, String> = HashMap::new();
  let result = aggregate_usage_by_group(&[], &group_map, &group_names);
  assert!(result.is_empty());
}

#[test]
fn aggregate_unknown_group_name_defaults_to_unknown() {
  let sessions = vec![make_gateway_session("s1", 100.0, 50.0, 0.01)];
  let group_map: HashMap<String, String> = [("s1".into(), "mystery".into())].into();
  let group_names: HashMap<String, String> = HashMap::new();

  let result = aggregate_usage_by_group(&sessions, &group_map, &group_names);
  assert_eq!(result.len(), 1);
  assert_eq!(result[0]["groupName"], "Unknown");
}

#[test]
fn aggregate_sums_all_cost_fields() {
  let sessions = vec![
    make_gateway_session("s1", 1000.0, 500.0, 0.05),
    make_gateway_session("s2", 1000.0, 500.0, 0.05),
  ];
  let group_map: HashMap<String, String> = [
    ("s1".into(), "g".into()),
    ("s2".into(), "g".into()),
  ].into();
  let group_names: HashMap<String, String> = [("g".into(), "G".into())].into();

  let result = aggregate_usage_by_group(&sessions, &group_map, &group_names);
  assert_eq!(result.len(), 1);
  let totals = &result[0]["totals"];
  approx_eq(&totals["input"], 2000.0);
  approx_eq(&totals["output"], 1000.0);
  approx_eq(&totals["totalTokens"], 3000.0);
  approx_eq(&totals["totalCost"], 0.10);
  approx_eq(&totals["inputCost"], 0.04);
  approx_eq(&totals["outputCost"], 0.06);
}

#[test]
fn aggregate_sessions_array_contains_correct_entries() {
  let sessions = vec![
    make_gateway_session("s1", 100.0, 50.0, 0.01),
    make_gateway_session("s2", 200.0, 100.0, 0.02),
  ];
  let group_map: HashMap<String, String> = [
    ("s1".into(), "g".into()),
    ("s2".into(), "g".into()),
  ].into();
  let group_names: HashMap<String, String> = [("g".into(), "Group".into())].into();

  let result = aggregate_usage_by_group(&sessions, &group_map, &group_names);
  let group_sessions = result[0]["sessions"].as_array().unwrap();
  assert_eq!(group_sessions.len(), 2);
  let keys: Vec<&str> = group_sessions.iter().map(|s| s["key"].as_str().unwrap()).collect();
  assert!(keys.contains(&"s1"));
  assert!(keys.contains(&"s2"));
}

// ============================================================================
// Edge cases: null usage, int/float mixing
// ============================================================================

#[test]
fn extract_session_usage_entry_handles_null_usage() {
  let session = json!({ "key": "sess_null", "usage": null });
  let entry = extract_session_usage_entry(&session);
  assert_eq!(entry["key"], "sess_null");
  assert_eq!(entry["totals"]["totalTokens"], 0.0);
  assert_eq!(entry["totals"]["totalCost"], 0.0);
  assert!(entry["messageCounts"].is_null());
  assert!(entry["firstActivity"].is_null());
  assert!(entry["lastActivity"].is_null());
}

#[test]
fn add_totals_works_with_empty_totals_plus_real_values() {
  let empty = empty_cost_totals();
  let real = json!({
    "input": 500.0, "output": 250.0, "cacheRead": 10.0, "cacheWrite": 5.0,
    "totalTokens": 765.0, "totalCost": 0.05,
    "inputCost": 0.02, "outputCost": 0.03, "cacheReadCost": 0.001, "cacheWriteCost": 0.0005,
  });
  let sum = add_totals(&empty, &real);
  approx_eq(&sum["input"], 500.0);
  approx_eq(&sum["totalCost"], 0.05);
  assert!(sum["input"].is_f64());
}

#[test]
fn extract_session_entry_preserves_message_counts() {
  let session = json!({
    "key": "sess_mc",
    "usage": {
      "input": 100.0, "output": 50.0, "cacheRead": 0.0, "cacheWrite": 0.0,
      "totalTokens": 150.0, "totalCost": 0.01,
      "inputCost": 0.004, "outputCost": 0.006, "cacheReadCost": 0.0, "cacheWriteCost": 0.0,
      "messageCounts": { "total": 20, "user": 7, "assistant": 7, "toolCalls": 3, "toolResults": 3, "errors": 0 },
      "firstActivity": 1700000000,
      "lastActivity": 1700003600,
    }
  });
  let entry = extract_session_usage_entry(&session);
  assert_eq!(entry["messageCounts"]["total"], 20);
  assert_eq!(entry["messageCounts"]["user"], 7);
  assert_eq!(entry["messageCounts"]["toolCalls"], 3);
}
