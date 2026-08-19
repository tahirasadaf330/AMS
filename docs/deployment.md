# Deployment

Two paths exist. **Push-to-deploy is the intended one**; the manual script remains as a fallback and
for first-time setup.

Both end in the same place: the work tree at `/var/www/AMS` matches a commit, host-Postgres
migrations have run, and `docker compose up -d --build` has rebuilt and restarted the containers.
Postgres itself is a **host** service and is never containerised — its data and backups predate the
containers, and the tiers reach it on `127.0.0.1` via `network_mode: host`.

## Push-to-deploy (preferred)

One-time, as root on the VM:

```bash
bash /var/www/AMS/deploy/setup-push-deploy.sh
```

That creates the bare repo `/srv/ams.git`, installs [`deploy/post-receive`](../deploy/post-receive)
as its hook, writes the per-VM paths to `hooks/post-receive.env`, and seeds the bare repo from the
work tree's history. It is idempotent — re-run it to refresh the hook after the repo's copy changes.

Then, once per workstation:

```bash
git remote add production root@<vm>:/srv/ams.git
git push production main          # this is the deploy
```

The hook:

1. ignores every ref except the deploy branch (`main` by default), so feature branches can be
   pushed to this remote without deploying;
2. `git checkout -f` into `/var/www/AMS` — untracked files like `backend/.env` and
   `frontend/.env.local` are left alone, while tracked local edits are discarded on purpose so the
   work tree matches the pushed commit exactly;
3. runs [`deploy/migrate.sh`](../deploy/migrate.sh);
4. `docker compose up -d --build`, then prunes dangling images;
5. polls `/system/health` and fails the push if the backend does not come up.

`DRY_RUN=1` validates the wiring — checkout target, migrations script, compose services — without
deploying anything. The setup script prints the exact invocation.

**Why this is better than the script.** The hook executes from the bare repo, so updating the work
tree cannot swap the running script out from under bash. `deploy/deploy.sh` has exactly that
failure mode: it `git pull`s the file it is itself being read from, so a change to `deploy.sh` (a new
migration, say) does **not** take effect on the deploy that ships it — it applies from the next one.

## Manual deploy (fallback)

```bash
bash /var/www/AMS/deploy/deploy.sh
```

Pulls `main`, runs `deploy/migrate.sh`, builds, restarts, prunes. Same outcome, subject to the
self-update caveat above. First-time PM2 → Docker migration:
[`deploy/DOCKER-MIGRATION.md`](../deploy/DOCKER-MIGRATION.md).

## Migrations

`deploy/migrate.sh` is the single source of truth, shared by both paths — **add new migrations to
the `MIGRATIONS` array there**. They run against the host database and are deliberately not baked
into the images, because the database outlives the containers. The scripts are re-runnable: a repeat
run only emits `already exists, skipping` notices.

Migration `010` (the read-only `ams_readonly` role for the MCP server) is **not** in
the list — it is superuser-only and one-time. See [mcp-server.md](mcp-server.md).

Credentials come from `backend/.env` or the ambient environment, read literally with no eval, so a
password containing `$`, `#` or `!` is safe. Missing credentials abort rather than guess.

## Configuration

Two per-VM files, neither committed:

| File | Consumed by | When |
|---|---|---|
| `backend/.env` | mounted read-only into `ams-backend` | container start |
| `frontend/.env.local` | `NEXT_PUBLIC_*` inlined into the client bundle | **image build** |

Because `NEXT_PUBLIC_*` are build-time, changing `frontend/.env.local` needs a rebuild, not just a
restart.sh` relies on this.

## Rotating the database password

```bash
bash /var/www/AMS/deploy/rotate-db-password.sh
bash /var/www/AMS/deploy/rotate-db-password.sh --rollback /root/ams-env-backup-<ts>.env
```

Verifies the current credential, backs up `backend/.env` root-only, generates a 32-character
alphanumeric password **on the server** (no punctuation, so nothing downstream has to quote it),
applies it via the superuser or by self-change, verifies it *before* writing to disk, recreates only
the compose services this VM actually defines, and health-checks. The new value is written to a
root-only file; record it in the team password store and in the gitignored
`deploy/SERVER_SETUP.md`, then delete it.

## nginx and the front door

Users reach `https://ams.voipsystem.org`; nginx terminates TLS
(`/etc/nginx/sites-enabled/ams.conf`) and proxies `location /` → `127.0.0.1:3000` and
`location /api/` → `127.0.0.1:3001`. For the UI's "Live" indicator to work, `/api/` must pass the
WebSocket `Upgrade`/`Connection` headers, and the client must connect with origin + path rather than
an `/api` namespace.
