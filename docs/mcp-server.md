# AMS MCP Server (read-only DB access)

Exposes the AMS Postgres database **read-only** through the Model Context Protocol, so **Atlas**
(Hayo's AI platform) can answer users' questions about AMS data on their behalf.

- **Endpoint:** `POST https://ams.voipsystem.org/mcp` (Streamable HTTP, stateless JSON).
- **Auth:** Atlas signs a short-lived **RS256 JWT** per call (carrying the user's Entra `oid`/`email`)
  and sends it as `Authorization: Bearer <jwt>`. AMS verifies it against **Atlas's JWKS** — there are
  no per-user API keys (the old `ams_mcp_…` keys were retired 2026-08-03).
- **Security boundary is Postgres, not app code:** the server connects as the `ams_readonly`
  role (SELECT only; password hashes, session tokens, and stored credentials are revoked and
  unreadable even via crafted SQL). Sensitive tables are re-exposed as `*_safe` views.
- Lives inside `ams-backend` (port 3001); no separate process. Mounted at `/mcp` as a raw Express
  router *before* Nest middleware, so JSON-RPC payloads aren't mangled **and no Nest guard / SSO
  redirect can ever touch it** (see "SSO must not front /mcp" below).

## How a call is authenticated
A `tools/call` is authenticated at the **HTTP layer** (`mcp-http.service.ts`), before the MCP
transport runs, so a failure is a real **HTTP 401** (bad/expired/replayed token) or **403** (valid
token, no usable AMS account) with a JSON-RPC error body — **never a redirect or HTML** (Atlas is
server-to-server and cannot follow a Microsoft login). The audit block rides in `error.data.audit`.
`initialize` and `tools/list` are unauthenticated discovery. Per `tools/call` (`atlas-auth.service.ts`):

1. **Verify the JWT** against Atlas's JWKS: RS256 pinned (rejects `alg:none` / HS256 confusion),
   exact `iss` + `aud`, `exp`/`nbf` within `ATLAS_TOKEN_LEEWAY_S`, key selected by `kid`
   (JWKS refetched once on an unknown kid). Bad signature / wrong iss/aud / expired / not-yet-valid
   are all refused.
2. **Require an identity** (`oid` + `email`) — checked *before* the replay cache, so a malformed
   token can never poison a `jti`.
3. **Single-use `jti`** — an in-memory cache refuses a replayed token within its lifetime.
4. **Match to an AMS user**, reusing the SSO rule: by `users.oid`, else by `email`, then backfill
   the `oid` write-once (never overwriting a different one). **Any active AMS account is allowed** —
   the read-only PG role, not app logic, bounds what it can read. No account / inactive → denied.

A successful `tools/call` returns `structuredContent.{ data, audit }` where `audit` is the Atlas
audit block (schema v1: `outcome` ok|error, `subject.{oid,email,matched_by}`, `correlation_id`,
`operation`, `relations_touched`, `row_count`, `duration_ms`, …). A denial returns HTTP 401/403 with
`error.data.{ deny_reason, audit }` (`audit.outcome:"denied"`). A DB `audit_log` row (`mcp:*` /
`mcp:denied`) is also written AMS-side either way.

## Tools
- `list_tables` — readable tables/views (sensitive tables are simply absent).
- `describe_table(table)` — columns of a table/view.
- `query(sql, row_limit?)` — one read-only `SELECT`/`WITH` statement. DDL/DML/multi-statement
  rejected; results capped (default 500, max 2000) and time-limited (8s).
- `list_datasets` — dataset registry (name → stage table).

## Atlas token config
Three values come from Atlas; `/mcp` is disabled (503) until all are set (and the read-only DB role
too). `ATLAS_TOKEN_LEEWAY_S` is the exp/nbf clock-skew allowance (default 60).

| Env | dev kit | staging (LIVE) | prod |
|---|---|---|---|
| `ATLAS_JWKS_URL` | local `dev-jwks.json` | `https://atlas.hayo.net/staging/mcp/jwks` | `https://atlas.hayo.net/api/mcp/jwks` *(not yet published)* |
| `ATLAS_ISS` | `https://atlas.hayo.net` | `https://atlas.hayo.net` | `https://atlas.hayo.net` |
| `MCP_AUD` | `ams-mcp-dev` | `ams-mcp-staging` | `ams-mcp-prod` |

Moving between environments is **config only** — no code change. Always fetch the JWKS over HTTPS
(over plain http an interceptor could substitute their own key and forge tokens you'd accept).

**Conformance:** verified 2026-08-03 against Atlas's real dev kit (`atlas-mcp-devkit.tgz`) — 12/12:
`valid_1`/`valid_2` → ok; `expired`/`not_yet_valid` → token_expired; `wrong_audience`/`wrong_issuer`/
`bad_signature`/`alg_none`/`alg_hs256_confusion`/`tampered_payload`/`missing_oid` → bad_token;
`replayed_jti` → token_replayed. Live staging JWKS confirmed reachable + parseable over HTTPS.

## SSO must NOT front /mcp
The MCP route is server-to-server: Atlas is not a browser and cannot follow a Microsoft login. If
the interactive Entra SSO / redirect layer ever intercepts `/mcp`, Atlas receives a 302 → HTML login
page → JSON parse failure, and every call fails. AMS avoids this structurally: `/mcp` is a raw
Express router mounted first in `main.ts` (no `setGlobalPrefix`, no `APP_GUARD`, no SSO middleware),
and nginx reverse-proxies it with no `auth_request`. On failure it returns 401/403 (auth) / 503 / 405
— **never a 302 or HTML.** When changing the front door, keep `/mcp` exempt from any interactive-auth
layer; the Atlas JWT is the (stronger, per-request) authentication for this route.

## One-time server setup (prod) — DB boundary (unchanged)

Run in this order (the migration needs the role to already exist; nginx gives TLS):

**1. Create the read-only role** (as a Postgres superuser — `ams_user` lacks CREATEROLE):
```sql
CREATE ROLE ams_readonly LOGIN PASSWORD '<generate a strong password>' CONNECTION LIMIT 10;
```

**2. Run migration 010 as a SUPERUSER** (grants/revokes/safe views; idempotent). It needs a
superuser because it sets role defaults (`ALTER ROLE`) and default privileges for the app's
table-owning role — so it is deliberately **NOT** run by `deploy.sh` (which runs as the
non-superuser app role). It only needs to run **once** — grants persist and default privileges
cover future stage tables.
```bash
sudo -u postgres psql -d AMS -f /var/www/AMS/backend/src/database/migrations/010_mcp_readonly_grants.sql
```

**3. Add env** to `/var/www/AMS/backend/.env` (reuses `AMS_PG_HOST/PORT/DB`), plus the Atlas token
config from the table above:
```
AMS_PG_RO_USER=ams_readonly
AMS_PG_RO_PASSWORD=<the role password from step 1>
ATLAS_JWKS_URL=https://atlas.hayo.net/staging/mcp/jwks   # or the prod URL when published
ATLAS_ISS=https://atlas.hayo.net
MCP_AUD=ams-mcp-staging                                  # or ams-mcp-prod
ATLAS_TOKEN_LEEWAY_S=60
```
If the DB role or any `ATLAS_*` value is unset, `/mcp` returns 503 and the rest of the backend is
unaffected.

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
    # Optional defence-in-depth (NOT the security boundary — the JWT is): allow Atlas only.
    # allow 10.10.9.45; deny all;
}
```

**5. Deploy** the code: `bash /var/www/AMS/deploy/deploy.sh`.

**6. Register with Atlas:** give them the endpoint URL, the `aud` for that environment, and the tool
names/descriptions so they can register AMS as an MCP.

## Access
There is nothing to grant per user: any **active** AMS account is reachable, matched by the Entra
`oid`/`email` in Atlas's token (the same identity SSO populates). Deactivating a user denies them at
the next call. The read-only PG role is what bounds what any of them can read.

## Client configuration
Atlas is the sole consumer and calls the endpoint server-to-server with its signed JWT — nothing to
configure per user. (Header-key clients like `claude mcp add --header "Authorization: Bearer …"` no
longer apply, since AMS only accepts Atlas-signed JWTs, not static keys.)

## Security notes / maintenance
- **Adding a new sensitive table?** `ALTER DEFAULT PRIVILEGES` auto-grants SELECT on every new
  table created by the app's DB role — so a new secret-bearing table would be MCP-readable.
  Add a `REVOKE` (and a `*_safe` view if partial exposure is wanted) to a follow-up migration.
- Redaction lives in migration 010: revoked tables (`users`, `password_history`, `sessions`,
  `data_sources`, `settings`, `notification_log`, `audit_log`, `user_mcp_keys`) + the
  `users_safe` / `data_sources_safe` / `notification_log_safe` views. Keep view column lists in
  sync with the entities when columns change.
- Every tool call is audited (`mcp:*` in Admin → Audit Log) with the user, SQL, row count, and IP,
  in addition to the audit block returned to Atlas.
- The `user_mcp_keys` table is **orphaned** (the per-user key path was removed); a later migration
  can drop it.
