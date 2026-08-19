# Standards Review — AMS

- **Ruleset:** v1.3 (2026-08-05)
- **Date:** 2026-08-19 (fixes applied same day — see below)
- **Branch:** `feature/zamani-firewall-report` (working tree) — recent `main` commits (Innovatio Traffic, Zamani alert dedup, negative-margin/cost-changes merges) also examined, since the tree mirrors them
- **Scope:** branch / working-tree changes + `main` deployables

## Rule-by-rule

| Rule | Verdict | Reason |
|---|---|---|
| R01 — Runtime is Docker | **PASS** | `docker-compose.yml` + `backend/Dockerfile` + `frontend/Dockerfile` tracked on `main`; both services set `restart:`; all new work (Innovatio report, alert fixes) runs inside the existing containers. Untracked `agent/` ships its own Dockerfile and is deliberately not in `main`'s compose. |
| R02 — No secrets in repo | **PASS** | No `.env` tracked anywhere; `backend/.env.example` present. New/changed code reads credentials via the encrypted `data_sources` table or env vars — no literals in the diff. |
| R03 — Reproducible deploys | **PASS** (fixed) | Deploys now go `git push production main` → bare repo `/srv/ams.git` + `post-receive` hook → `docker compose build && up -d` ✔ — but the **hook is hand-installed and not version-controlled on `main`** (`deploy/` on main still carries the old `git pull`-based `deploy.sh`; the post-receive/setup scripts live only on the unmerged `feature/voice-outliers-agent` branch). |
| R04 — Branching | **WARN** | This week's work was committed to `main` directly (worktree commits + push) or merged locally without PRs. The repo accepts direct pushes (not protected), so this is WARN not BLOCK — but it contradicts "changes arrive via PR". Branch names follow `feature/<slug>` (ticket numbers absent — SHOULD-level). |
| R05 — Conventional commits | **PASS** | All recent commits match `type(scope): summary` (`feat(innovatio-traffic): …`, `fix(zamani-alerts): …`, etc.), imperative and specific. |
| R06 — Baseline hygiene | **PASS** (fixed) | **No `README.md` on `main` or this branch** (it exists only on the unmerged `feature/voice-outliers-agent` branch). **`backend.err` (212 KB) and `frontend.err` (33 KB) crash logs are tracked on `main`**; `.gitignore` covers `*.log` but not `*.err`. |
| R07 — Project documentation | **PASS** (fixed) | `docs/` exists on `main` but holds only `mcp-server.md` + `zamani-firewall.md` — no index/overview, and no docs for major recent features: Voice Smart Outliers (report + spike/drop alert), Innovatio Traffic Report, SMS Report, negative-margin, cost-changes. (Fuller docs exist only on the unmerged agent branch.) |

## Verdict: **compliant-with-warnings**

No blockers: Docker runtime and secret handling are clean, and commit hygiene is good. The warnings cluster around one root cause — **the hygiene/deploy-tooling work is stranded on the unmerged `feature/voice-outliers-agent` branch** while `main` moved on without it.

## Top 3 fixes
1. **Bring the stranded hygiene work onto `main`** (or recreate it there): `README.md`, `CLAUDE.md`, `.err` untracking, `deploy/post-receive` + `setup-push-deploy.sh` — so the hook actually running prod deploys is version-controlled and the repo self-describes. Fixes most of R03/R06 at once.
2. **Untrack the crash logs now**: `git rm --cached backend.err frontend.err`, add `*.err` to `.gitignore` (one small commit on `main`).
3. **Document the recent features** in `docs/` (Innovatio Traffic, Voice Smart Outliers + its alert, plus a one-page index) and return to PR-based merges into `main` — deploys stay `git push production main` after merge.

## Fixes applied (2026-08-19)

1. **R03** — `deploy/post-receive`, `deploy/setup-push-deploy.sh` and `deploy/migrate.sh` are now
   version-controlled on `main`, and the prod bare-repo hook was aligned to the tracked version
   (validated with its DRY_RUN mode first). Deploys remain `git push production main`.
2. **R06** — `README.md` (build/run/deploy) and `CLAUDE.md` (managed standards block) added to
   `main`; `backend.err`/`frontend.err` untracked and `*.err` added to `.gitignore`.
3. **R07** — `docs/` now carries an index + overview (`docs/README.md`) and per-feature pages:
   reports, deployment, data-pipeline / alerting / access architecture, Voice Smart Outliers,
   Zamani SMS Firewall, and a new `docs/innovatio-traffic.md`.

Remaining WARN: **R04** — return to PR-based merges into `main` (process, not code).
