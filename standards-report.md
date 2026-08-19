# Standards Review — AMS

- **Ruleset:** v1.3 (2026-08-05)
- **Date:** 2026-08-19 (re-run after fixes; previous run same day found R03/R06/R07 WARN)
- **Branch:** `feature/zamani-firewall-report` (working tree) · `main` @ `d2e8463`
- **Scope:** branch / working-tree changes + `main` deployables

## Rule-by-rule

| Rule | Verdict | Reason |
|---|---|---|
| R01 — Runtime is Docker | **PASS** | `docker-compose.yml` + backend/frontend Dockerfiles tracked on `main`; both services set `restart:`; all recent work runs in the existing containers. Untracked `agent/` is deliberately outside `main`'s compose. |
| R02 — No secrets in repo | **PASS** | No `.env` tracked; `backend/.env.example` present; new code reads credentials from the encrypted `data_sources` table or env vars. |
| R03 — Reproducible deploys | **PASS** | Deploys are `git push production main` → tracked `deploy/post-receive` hook (checkout → `deploy/migrate.sh` → `docker compose up -d --build` → health check). The prod bare-repo hook is the version-controlled one — DRY_RUN-validated, then proven live (`[deploy] healthy — deploy complete`). Manual fallback documented in `docs/deployment.md`. |
| R04 — Branching | **WARN** | Work continues to reach `main` by direct push / local merges rather than PRs (repo is not push-protected, so WARN not BLOCK). Branch names follow `feature/<slug>`; ticket numbers absent (SHOULD-level). |
| R05 — Conventional commits | **PASS** | All recent commits match `type(scope): summary`, imperative and specific. |
| R06 — Baseline hygiene | **PASS** | `README.md` on `main` (build/run/deploy, adapted to push-to-deploy). `backend.err`/`frontend.err` untracked as of `d2e8463` (the first attempt in `eac70b2` staged the deletions but a commit pathspec dropped them — caught by this re-run) and `*.err` is gitignored. |
| R07 — Project documentation | **PASS** | `docs/` has an index + overview and per-feature pages: reports catalogue, deployment, data-pipeline / alerting / access architecture, Voice Smart Outliers, Zamani SMS Firewall, Innovatio Traffic, MCP server, plus the architecture PDF and support runbook. |

## Verdict: **compliant-with-warnings**

Six of seven rules pass structurally. The single remaining warning is procedural:

## Top fixes
1. **R04 — return to PR-based merges into `main`.** Enable branch protection on Bitbucket (require PRs) so the standard is enforced rather than voluntary; deploys stay `git push production main` after merge.
2. Optionally add ticket numbers to branch names (`feature/<ticket>-<slug>`), per the SHOULD in R04.
3. Nothing else outstanding — keep `docs/` current as new reports land (add a page per feature, one line in the index).
