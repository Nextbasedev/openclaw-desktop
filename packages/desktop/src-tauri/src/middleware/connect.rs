use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConnectInput {
  pub(crate) url: String,
  pub(crate) token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConnectSaveInput {
  pub(crate) url: String,
  pub(crate) token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConnectStatusInput {}

fn parse_gateway_ws_url(url: &str) -> Result<String, String> {
  let trimmed = url.trim().trim_end_matches('/');
  if trimmed.starts_with("ws://") || trimmed.starts_with("wss://") {
    return Ok(trimmed.to_string());
  }
  if trimmed.starts_with("http://") {
    return Ok(trimmed.replacen("http://", "ws://", 1));
  }
  if trimmed.starts_with("https://") {
    return Ok(trimmed.replacen("https://", "wss://", 1));
  }
  // Bare host:port — assume ws://
  if trimmed.contains(':') || trimmed.contains('.') || trimmed == "localhost" {
    return Ok(format!("ws://{}", trimmed));
  }
  Err(format!("Invalid gateway URL: {}", url))
}

#[tauri::command]
pub async fn middleware_gateway_connect(input: GatewayConnectInput) -> Result<Value, String> {
  let ws_url = parse_gateway_ws_url(&input.url)?;
  let identity = read_device_identity().await?;

  let mut request = ws_url
    .clone()
    .into_client_request()
    .map_err(|e| format!("Invalid WebSocket URL: {e}"))?;
  request.headers_mut().insert(
    http::header::ORIGIN,
    http::HeaderValue::from_static(DEFAULT_GATEWAY_ORIGIN),
  );

  let (mut socket, _) = timeout(
    Duration::from_secs(10),
    connect_async(request),
  )
  .await
  .map_err(|_| format!("Connection timed out: {}", ws_url))?
  .map_err(|e| format!("Failed to connect to {}: {e}", ws_url))?;

  // Wait for challenge
  let challenge = timeout(Duration::from_secs(10), async {
    loop {
      let msg = next_json_message(&mut socket).await?;
      if msg.get("type").and_then(Value::as_str) == Some("event")
        && msg.get("event").and_then(Value::as_str) == Some("connect.challenge")
      {
        return Ok::<Value, String>(msg);
      }
    }
  })
  .await
  .map_err(|_| "Timed out waiting for gateway challenge".to_string())??;

  let nonce = challenge
    .get("payload")
    .and_then(|p| p.get("nonce"))
    .and_then(Value::as_str)
    .ok_or_else(|| "Gateway challenge missing nonce".to_string())?;

  let signed_at = Utc::now().timestamp_millis();
  let signing_key = SigningKey::from_pkcs8_pem(&identity.private_key_pem)
    .map_err(|e| format!("Failed to decode device key: {e}"))?;
  let auth_payload = build_device_auth_payload_v3(
    &identity.device_id,
    "openclaw-control-ui",
    "webchat",
    "operator",
    &["operator.read"],
    signed_at,
    &input.token,
    nonce,
    "desktop",
    "",
  );
  let signature = signing_key.sign(auth_payload.as_bytes());
  let public_key = signing_key.verifying_key();

  let connect_response = gateway_request(
    &mut socket,
    "connect",
    json!({
      "minProtocol": PROTOCOL_VERSION,
      "maxProtocol": PROTOCOL_VERSION,
      "client": {
        "id": "openclaw-control-ui",
        "displayName": "Jarvis Desktop",
        "version": "0.0.1",
        "platform": "desktop",
        "mode": "webchat"
      },
      "auth": { "token": input.token },
      "caps": ["chat", "sessions"],
      "scopes": ["operator.read"],
      "device": {
        "id": identity.device_id,
        "publicKey": URL_SAFE_NO_PAD.encode(public_key.as_bytes()),
        "signature": URL_SAFE_NO_PAD.encode(signature.to_bytes()),
        "signedAt": signed_at,
        "nonce": nonce
      }
    }),
    15_000,
  )
  .await?;

  let _ = socket.close(None).await;

  let payload = extract_ok_payload(connect_response, "connect")?;

  let server_version = payload
    .get("server")
    .and_then(|s| s.get("version"))
    .and_then(Value::as_str)
    .unwrap_or("unknown");

  let agent_name = payload
    .get("agent")
    .and_then(|a| a.get("displayName"))
    .and_then(Value::as_str)
    .or_else(|| {
      payload
        .get("agent")
        .and_then(|a| a.get("name"))
        .and_then(Value::as_str)
    })
    .unwrap_or("unknown");

  Ok(json!({
    "ok": true,
    "url": ws_url,
    "serverVersion": server_version,
    "agentName": agent_name,
    "connectedAt": now_iso(),
  }))
}

#[tauri::command]
pub async fn middleware_gateway_connect_save(input: GatewayConnectSaveInput) -> Result<Value, String> {
  let ws_url = parse_gateway_ws_url(&input.url)?;

  // Extract port from URL or default to 18789
  let port: u16 = ws_url
    .split("://")
    .nth(1)
    .and_then(|host_port| host_port.split(':').nth(1))
    .and_then(|p| p.trim_end_matches('/').parse().ok())
    .unwrap_or(DEFAULT_GATEWAY_PORT);

  let mut config = read_openclaw_config_value()?;
  set_json_path(&mut config, "gateway.port", json!(port));
  set_json_path(&mut config, "gateway.auth.token", json!(input.token));
  write_openclaw_config_value(&config)?;

  Ok(json!({
    "ok": true,
    "url": ws_url,
    "port": port,
    "savedAt": now_iso(),
  }))
}

#[tauri::command]
pub async fn middleware_gateway_connect_status(_input: GatewayConnectStatusInput) -> Result<Value, String> {
  let config = match read_openclaw_config_value() {
    Ok(c) => c,
    Err(_) => return Ok(json!({ "configured": false })),
  };

  let port = value_at_json_path(&config, "gateway.port")
    .and_then(Value::as_u64)
    .map(|p| p as u16)
    .unwrap_or(DEFAULT_GATEWAY_PORT);

  let has_token = value_at_json_path(&config, "gateway.auth.token")
    .and_then(Value::as_str)
    .map(|t| !t.is_empty())
    .unwrap_or(false);

  let url = format!("ws://127.0.0.1:{}", port);

  if !has_token {
    return Ok(json!({
      "configured": false,
      "url": url,
      "port": port,
    }));
  }

  // Try a quick ping to check if gateway is reachable
  let reachable = match timeout(
    Duration::from_secs(3),
    tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)),
  ).await {
    Ok(Ok(_)) => true,
    _ => false,
  };

  Ok(json!({
    "configured": true,
    "url": url,
    "port": port,
    "reachable": reachable,
  }))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parse_gateway_ws_url_handles_formats() {
    assert_eq!(parse_gateway_ws_url("ws://127.0.0.1:18789").unwrap(), "ws://127.0.0.1:18789");
    assert_eq!(parse_gateway_ws_url("wss://gateway.example.com").unwrap(), "wss://gateway.example.com");
    assert_eq!(parse_gateway_ws_url("http://localhost:18789").unwrap(), "ws://localhost:18789");
    assert_eq!(parse_gateway_ws_url("https://gateway.example.com").unwrap(), "wss://gateway.example.com");
    assert_eq!(parse_gateway_ws_url("127.0.0.1:18789").unwrap(), "ws://127.0.0.1:18789");
    assert_eq!(parse_gateway_ws_url("localhost").unwrap(), "ws://localhost");
    assert_eq!(parse_gateway_ws_url("  ws://host:1234/  ").unwrap(), "ws://host:1234");
  }

  #[tokio::test]
  async fn gateway_connect_status_returns_json() {
    let input = GatewayConnectStatusInput {};
    let result = middleware_gateway_connect_status(input).await;
    assert!(result.is_ok(), "status failed: {:?}", result.err());
    let val = result.unwrap();
    assert!(val.get("configured").is_some());
    assert!(val.get("url").is_some());
    assert!(val.get("port").is_some());
  }

  #[tokio::test]
  async fn gateway_connect_with_real_config() {
    let config = match read_openclaw_config_value() {
      Ok(c) => c,
      Err(_) => return,
    };
    let token = match value_at_json_path(&config, "gateway.auth.token").and_then(Value::as_str) {
      Some(t) if !t.is_empty() => t.to_string(),
      _ => return,
    };
    let port = value_at_json_path(&config, "gateway.port")
      .and_then(Value::as_u64)
      .unwrap_or(DEFAULT_GATEWAY_PORT as u64);

    let input = GatewayConnectInput {
      url: format!("ws://127.0.0.1:{}", port),
      token,
    };
    let result = middleware_gateway_connect(input).await;
    assert!(result.is_ok(), "connect failed: {:?}", result.err());
    let val = result.unwrap();
    assert_eq!(val.get("ok").and_then(Value::as_bool), Some(true));
    assert!(val.get("serverVersion").and_then(Value::as_str).is_some());
    assert!(val.get("agentName").and_then(Value::as_str).is_some());
  }
}
