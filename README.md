<p align="center">
  <img src="./docs/assets/openclaw-desktop-hero.jpg" alt="OpenClaw Desktop" width="100%" />
</p>

<h1 align="center">OpenClaw Desktop</h1>

<p align="center">
  A native desktop client for working with OpenClaw</a>.
</p>

<p align="center">
  <a href="#features">✨ Features</a> ·
  <a href="#get-started">🚀 Get started</a> ·
  <a href="#connect-to-openclaw">🔌 Connect</a> ·
  <a href="#production-use">🏗️ Production</a> ·
  <a href="./CONTRIBUTING.md">🤝 Contributing</a> ·
  <a href="./SECURITY.md">🔒 Security</a>
</p>

---

## Features

OpenClaw Desktop gives an OpenClaw runtime a dedicated desktop workspace. It keeps the desktop interface separate from the runtime connection, so OpenClaw can run on the same computer or on a reachable server.

| | What you get |
|---|---|
| 💬 | **Chat and sessions** — streaming chat, session navigation, attachments, and message inspection in one desktop interface. |
| 🔌 | **Local or remote connection** — detect a local middleware service or pair with one running on a VPS. |
| 🗂️ | **Workspace tools** — project, topic, file, Git, and terminal surfaces are available through the connected runtime. |
| ⚙️ | **Desktop controls** — connection status, settings, notifications, logs, skills, and onboarding are built into the app. |

### Why use the desktop app?

- **Keep your runtime where it belongs.** Run OpenClaw locally for a single-machine setup, or on a VPS while using the same desktop interface from your computer.
- **Use a native desktop shell.** The app is packaged with Tauri and includes its middleware resources for desktop use.
- **Keep connection state local to the runtime host.** Middleware stores its SQLite state on the machine where it runs; it is not a separate database service to install.

---

## How it works

```text
Tauri desktop shell
        ↓
Next.js user interface
        ↓
Local or remote Fastify middleware + SQLite projection
        ↓
OpenClaw Gateway (WebSocket)
```

The middleware owns the Gateway connection and projects chat state to the UI. Desktop connects to the middleware; it does not connect directly to the Gateway.

---

## Get started

### What you need

| Setup | Requirements |
|---|---|
| **Use the app** | An OpenClaw Gateway running locally or on a server, plus a middleware URL that the desktop app can reach. |
| **Local connection** | OpenClaw Gateway and middleware on the same computer. The default middleware address is `http://127.0.0.1:8787`. |
| **Remote / VPS connection** | OpenClaw Gateway and middleware running on the server, plus a reachable middleware URL and pairing code. Tailscale is optional but a good private-network option. |
| **Build from source** | Node.js 22+, pnpm 9+, Rust, and the platform dependencies required by Tauri. |

**SQLite:** no separate SQLite server or setup is required. By default, middleware creates its local state database at `~/.openclaw/middleware/state.sqlite` on the machine where middleware runs.

### Run from source

```bash
pnpm install
pnpm dev
```

---

## Connect to OpenClaw

### Local computer

1. Make sure the local Gateway is running:

   ```bash
   openclaw gateway status
   openclaw gateway start   # only if it is not already running
   ```

2. Start OpenClaw Desktop and choose **OpenClaw is on this computer**.
3. Use **Start / detect local backend**. The app looks for local middleware at `http://127.0.0.1:8787`.

### Remote VPS or server

1. Run OpenClaw Gateway and middleware on the VPS. Middleware normally reaches the Gateway locally at `ws://127.0.0.1:18789`.
2. Run middleware as an auto-restarting service, with a stable middleware token and pairing code.
3. Give Desktop a URL it can reach. Prefer an HTTPS reverse-proxy domain or a Tailscale address; use a private/LAN address when appropriate. Avoid exposing the middleware on a public IP unless the firewall and access controls are configured for it.
4. In Desktop, choose **OpenClaw is on a VPS**, paste the middleware URL and pairing code, then select **Pair and continue**.

Keep pairing codes, middleware tokens, and private URLs out of screenshots, commits, and public issues.

---

## Production use

For production, run OpenClaw Gateway and middleware on the server where the runtime should live. Keep the Gateway reachable to middleware on that host, and expose only the middleware address that Desktop needs.

- Run middleware under a service manager so it restarts after crashes and reboots.
- Use a stable `MIDDLEWARE_TOKEN` and `MIDDLEWARE_PAIRING_CODE`; Desktop uses the pairing flow to establish access.
- Prefer HTTPS or a private Tailscale network for the Desktop-to-middleware connection.
- Before sharing a server URL or pairing code, run `docs/installation/desktop-middleware-smoke-test.sh` against that middleware instance.

---

## Platform support

OpenClaw Desktop targets **Windows** and **macOS** through Tauri.

- **Windows:** the repository includes a GitHub Actions workflow that builds Windows installer artifacts.
- **macOS:** the Tauri configuration includes macOS bundle settings. A production `.dmg` should be built, signed, and notarized on macOS before it is published to users.

---

## Repository layout

```text
apps/middleware/       Fastify middleware, SQLite projection, Gateway bridge
packages/ui/           Next.js 16 / React 19 interface
packages/desktop/      Tauri shell and Rust source
packages/middleware/   legacy Gateway client library
packages/server/       Node server package
packages/shared/       shared TypeScript types and schemas
docs/                  contributor workflows, constraints, and lessons
```

---

## Documentation

- [Contributing](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)
- [Project guidance](./AGENTS.md)

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. Keep changes focused, verify the affected packages, and document durable behavior rules when they are introduced.

## Security

Please report vulnerabilities according to [SECURITY.md](./SECURITY.md). Do not post exploit details, credentials, pairing codes, private URLs, or tokens in public issues.
