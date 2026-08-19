<!-- BEGIN standards-review (managed) -->
## Our engineering standards — follow for NEW or changed code only
When writing or changing code in this project, follow these team standards:
- Run in Docker (a `Dockerfile` + `docker-compose.yml`); nothing installed on the host.
- Deploy via `git push` to the bare repo + `post-receive` hook running `docker compose up -d --build`.
- Keep `main` always deployable; work on short-lived `feature/<ticket>` branches, merge via PR.
- Conventional commit messages: `type(scope): summary`.
- No secrets in the repo — use environment variables; never commit `.env` (keep an `.env.example`).
- Keep a `README.md` (build/run/deploy) and project docs (a `docs/` folder or `DOCUMENTATION.md`) covering an overview + a flow per major feature.

Do NOT refactor existing / legacy code to match these unless explicitly asked. They apply going forward.
<!-- Standards home: engineering-standards repo · ruleset v1.3 -->
<!-- END standards-review (managed) -->
