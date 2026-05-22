# Migrate existing Middleware v1 data

Use this when a user already ran an older OpenClaw Desktop Middleware and has local data they want to keep.

This guide is based on the current Middleware store code:

- `apps/middleware/src/config.ts`
- `apps/middleware/src/services/store.ts`

Current Middleware persists state in SQLite. If `MIDDLEWARE_DB` points to a SQLite path, the store uses that SQLite file. If a matching legacy JSON file exists and the SQLite state is empty, Middleware imports that JSON once on startup.

## What is migrated

Middleware local state can include:

- projects
- recent repos
- spaces
- topics
- chats
- sessions
- command state such as cron jobs, pins, migration metadata, and local UI state

OpenClaw Gateway transcripts/history are not stored in this Middleware DB. They remain wherever OpenClaw Gateway stores them.

## 1. Stop old Middleware before copying data

Do not copy a live SQLite DB while Middleware is writing to it.

Examples:

```bash
systemctl --user stop openclaw-middleware 2>/dev/null || true
sudo systemctl stop openclaw-middleware 2>/dev/null || true
pkill -f 'apps/middleware.*dist/index.js' 2>/dev/null || true
```

Use the actual service name if it is different.

## 2. Find the old database path

Check how the old process/service was started:

```bash
systemctl --user cat openclaw-middleware 2>/dev/null || true
sudo systemctl cat openclaw-middleware 2>/dev/null || true
ps aux | grep -E 'openclaw.*middleware|apps/middleware|dist/index.js' | grep -v grep || true
```

Look for `MIDDLEWARE_DB=`.

Common paths:

```text
~/.openclaw/middleware/middleware.db
~/.openclaw/middleware/middleware.sqlite
~/.openclaw/middleware/middleware.json
/var/lib/openclaw-middleware/state.sqlite
/var/lib/openclaw-middleware/state.json
```

If unsure, search:

```bash
find ~/.openclaw /var/lib/openclaw-middleware -maxdepth 4 \
  \( -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.db' -o -name '*.json' \) \
  -print 2>/dev/null
```

## 3. Back up old data

```bash
mkdir -p ~/openclaw-middleware-backup-$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=$(ls -td ~/openclaw-middleware-backup-* | head -1)
```

For SQLite, copy the DB and WAL files:

```bash
cp -av /path/to/old/state.sqlite "$BACKUP_DIR"/ 2>/dev/null || true
cp -av /path/to/old/state.sqlite-wal "$BACKUP_DIR"/ 2>/dev/null || true
cp -av /path/to/old/state.sqlite-shm "$BACKUP_DIR"/ 2>/dev/null || true
```

For JSON:

```bash
cp -av /path/to/old/state.json "$BACKUP_DIR"/
```

## 4A. If old data is already SQLite

Best option: run the new Middleware with the same DB path.

```bash
MIDDLEWARE_DB=/path/to/old/state.sqlite
```

Or copy it to the new standard path while Middleware is stopped:

```bash
sudo mkdir -p /var/lib/openclaw-middleware
sudo cp -av /path/to/old/state.sqlite /var/lib/openclaw-middleware/state.sqlite
sudo cp -av /path/to/old/state.sqlite-wal /var/lib/openclaw-middleware/state.sqlite-wal 2>/dev/null || true
sudo cp -av /path/to/old/state.sqlite-shm /var/lib/openclaw-middleware/state.sqlite-shm 2>/dev/null || true
```

Then start new Middleware with:

```bash
MIDDLEWARE_DB=/var/lib/openclaw-middleware/state.sqlite
```

Optional integrity check:

```bash
sqlite3 /var/lib/openclaw-middleware/state.sqlite 'PRAGMA integrity_check;'
```

Expected result:

```text
ok
```

## 4B. If old data is legacy JSON

Current Middleware auto-imports legacy JSON only when the matching SQLite store is empty.

The matching JSON path is derived from `MIDDLEWARE_DB`:

- `MIDDLEWARE_DB=/var/lib/openclaw-middleware/state.sqlite`
- matching legacy JSON: `/var/lib/openclaw-middleware/state.json`

Migration steps:

```bash
sudo mkdir -p /var/lib/openclaw-middleware
sudo cp -av /path/to/old/state.json /var/lib/openclaw-middleware/state.json
```

If an empty or wrong SQLite file already exists, move it away before first start:

```bash
sudo mv /var/lib/openclaw-middleware/state.sqlite /var/lib/openclaw-middleware/state.sqlite.before-json-import 2>/dev/null || true
sudo mv /var/lib/openclaw-middleware/state.sqlite-wal /var/lib/openclaw-middleware/state.sqlite-wal.before-json-import 2>/dev/null || true
sudo mv /var/lib/openclaw-middleware/state.sqlite-shm /var/lib/openclaw-middleware/state.sqlite-shm.before-json-import 2>/dev/null || true
```

Start new Middleware with:

```bash
MIDDLEWARE_DB=/var/lib/openclaw-middleware/state.sqlite
```

On first startup, Middleware creates `state.sqlite` and imports `/var/lib/openclaw-middleware/state.json` if the SQLite state is empty.

## 5. Verify migrated data

After starting new Middleware, verify the local state through authenticated APIs:

```bash
BASE_URL="<middleware-url>"
TOKEN="<middleware-token>"

curl -fsS "$BASE_URL/api/bootstrap" -H "Authorization: Bearer $TOKEN"
curl -fsS "$BASE_URL/api/projects" -H "Authorization: Bearer $TOKEN"
curl -fsS "$BASE_URL/api/chats" -H "Authorization: Bearer $TOKEN"
curl -fsS "$BASE_URL/api/sessions" -H "Authorization: Bearer $TOKEN"
curl -fsS -X POST "$BASE_URL/api/commands/middleware_cron_list_jobs" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"input":{}}'
```

Then run the standard Desktop smoke test from repo root:

```bash
MIDDLEWARE_TEST_URL="<middleware-url>" \
MIDDLEWARE_TOKEN="<middleware-token>" \
docs/installation/desktop-middleware-smoke-test.sh
```

Success must include:

```text
DESKTOP_MIDDLEWARE_SMOKE_TEST_OK
```

## Rollback

Stop new Middleware, restore the backed-up DB or JSON, and start with the previous `MIDDLEWARE_DB` path.

For SQLite, restore the main DB and matching `-wal` / `-shm` files from the same backup set.
