# AMS MCP Server (read-only DB access)

Exposes the AMS Postgres database **read-only** to selected users through the Model Context
Protocol, so Atlas agents and users' AI clients (Claude Code/Desktop) can query AMS data.

- **Endpoint:** `POST https://ams.voipsystem.org/mcp` (Streamable HTTP, stateless JSON).
- **Auth:** per-user API key, `Authorization: Bearer ams_mcp_…`, generated in **Admin → Users**.
- **Security boundary is Postgres, not app code:** the server connects as the `ams_readonly`
  role (SELECT only; password hashes, session tokens, and stored credentials are revoked and
  unreadable even via crafted SQL). Sensitive tables are re-exposed as `*_safe` views.
- Lives inside `ams-backend` (port 3001); no separate process. Mounted at `/mcp` *before* Nest
  middleware so JSON-RPC payloads aren't mangled.

## Tools
- `list_tables` — readable tables/views (sensitive tables are simply absent).
- `describe_table(table)` — columns of a table/view.
- `query(sql, row_limit?)` — one read-only `SELECT`/`WITH` statement. DDL/DML/multi-statement
  rejected; results capped (default 500, max 2000) and time-limited (8s).
- `list_datasets` — dataset registry (name → stage table).

## One-time server setup (prod)

Run in this order (the migration needs the role to already exist; nginx gives TLS):

**1. Create the read-only role** (as a Postgres superuser — `ams_user` lacks CREATEROLE):
```sql
CREATE ROLE ams_readonly LOGIN PASSWORD '<generate a strong password>' CONNECTION LIMIT 10;
```

**2. Run migration 010** as `ams_user` (grants/revokes/safe views; idempotent):
```bash
PGPASSWORD='<ams_user pw>' psql -U ams_user -d AMS -h localhost \
  -f /var/www/AMS/backend/src/database/migrations/010_mcp_readonly_grants.sql
```
> Future deploys run 010 automatically via `deploy.sh`, but **the deploy that first ships it
> must run it manually** — `deploy.sh` git-pulls (replacing itself) before the migration step,
> so it executes its old copy that doesn't yet know about 010.

**3. Add env** to `/var/www/AMS/backend/.env` (reuses `AMS_PG_HOST/PORT/DB`):
```
AMS_PG_RO_USER=ams_readonly
AMS_PG_RO_PASSWORD=<the role password from step 1>
```
If unset, `/mcp` returns 503 and the rest of the backend is unaffected.

**4. nginx** — add a location so the endpoint gets TLS via the existing cert (keys must never
travel plaintext), then `nginx -t && systemctl reload nginx`:
```nginx
location /mcp {
    proxy_pass http://127.0.0.1:3001/mcp;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 60s;
    proxy_buffering off;
    client_max_body_size 1m;
}
```

**5. Deploy** the code: `bash /var/www/AMS/deploy/deploy.sh`.

## Granting a user access
Admin → Users → the **key icon** (violet) on a user's row → **Generate key**. The plaintext key
is shown **once** — copy it and give it to the user. Regenerate invalidates the old key; Revoke
kills it immediately. Deactivating the user also kills their key instantly.

## Client configuration
- **Claude Code:** `claude mcp add --transport http ams https://ams.voipsystem.org/mcp --header "Authorization: Bearer ams_mcp_…"`
- **Atlas / Anthropic API `mcp_servers`:** `{ "type": "url", "url": "https://ams.voipsystem.org/mcp", "name": "ams", "authorization_token": "ams_mcp_…" }`
- **claude.ai web connectors** expect OAuth, not static bearer headers — use a header-capable
  client (Claude Code/Desktop, or the Atlas API) instead.

## Security notes / maintenance
- **Adding a new sensitive table?** `ALTER DEFAULT PRIVILEGES` auto-grants SELECT on every new
  table created by the app's DB role — so a new secret-bearing table would be MCP-readable.
  Add a `REVOKE` (and a `*_safe` view if partial exposure is wanted) to a follow-up migration.
- Redaction lives in migration 010: revoked tables (`users`, `password_history`, `sessions`,
  `data_sources`, `settings`, `notification_log`, `audit_log`, `user_mcp_keys`) + the
  `users_safe` / `data_sources_safe` / `notification_log_safe` views. Keep view column lists in
  sync with the entities when columns change.
- Every tool call is audited (`mcp:*` in Admin → Audit Log) with the user, SQL, row count, and IP.
- Keys are stored as SHA-256 hashes; the plaintext exists only at generation time.
