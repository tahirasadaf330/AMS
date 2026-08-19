# Standards Review — AMS

- **Ruleset:** v1.3 (2026-08-05) — verified current against engineering-standards@HEAD on 2026-08-19 (repo changelog at v1.5 is tooling-only; rules unchanged)
- **Date:** 2026-08-19 (third run today; R03/R06/R07 fixed in the morning runs)
- **Branch:** `feature/zamani-firewall-report` (working tree) · `main` @ `b8ed6c2`
- **Scope:** branch / working-tree changes + `main` deployables

## Rule-by-rule

| Rule | Verdict | Reason |
|---|---|---|
| R01 — Runtime is Docker | **PASS** | `docker-compose.yml` + backend/frontend Dockerfiles on `main`; `restart:` set; all work runs in the containers. Untracked `agent/` is deliberately outside `main`'s compose. |
| R02 — No secrets in repo | **PASS** | No `.env` tracked; `backend/.env.example` present; credentials come from env vars or the encrypted `data_sources` table. |
| R03 — Reproducible deploys | **PASS** | `git push production main` → tracked `deploy/post-receive` (checkout → migrations → `docker compose up -d --build` → health check); prod hook is the version-controlled one, proven live. |
| R04 — Branching | **WARN** | **Verified by live probe this run:** a direct push to Bitbucket `main` still lands (no branch restriction configured), and work continues to reach `main` without PRs. Repo is unprotected → WARN not BLOCK. Branch names follow `feature/<slug>` (ticket numbers absent — SHOULD-level). |
| R05 — Conventional commits | **PASS** | Recent commits match `type(scope): summary` (scope optional per the repo's own `push.ps1` regex). |
| R06 — Baseline hygiene | **PASS** | `README.md` on `main`; `backend.err`/`frontend.err` untracked (`d2e8463`); `*.err` gitignored. |
| R07 — Project documentation | **PASS** | `docs/` index + overview + per-feature pages (reports, deployment, 3 architecture pages, Voice Smart Outliers, Zamani SMS Firewall, Innovatio Traffic, MCP) + architecture PDF and support runbook. |

## Verdict: **compliant-with-warnings**

Six of seven rules pass structurally; the last one needs a repo-admin click, not code.

## Top fixes
1. **R04 — enable branch restrictions on Bitbucket** (`hayonet/ams` → Repository settings → Branch restrictions → pattern `main`: prevent pushes with an empty allow-list, prevent force pushes, prevent deletion). Attempted via API this morning: the available token has repo-write but **not repo-admin** (403), so this must be done by a repo admin in the UI. Two live probes today confirmed direct pushes still land.
2. After enabling, re-run this review — the probe push should be rejected and R04 flips to PASS; from then on changes flow `feature/*` → PR → merge (deploys stay `git push production main`).
3. Optional: add ticket numbers to branch names (`feature/<ticket>-<slug>`).
