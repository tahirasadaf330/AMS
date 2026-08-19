# Sign-in and access control

Who can sign in, and what they can see. Modules: `auth`, `common/access`, `admin`, `audit`.

## Sign-in — SSO only

Sign-in is Microsoft Entra SSO. Password login is **disabled**: `PASSWORD_LOGIN_ENABLED` exists
only as a break-glass flag (with a toggle script at `deploy/toggle-password-login.sh`), and there
are no temporary passwords — a welcome email links straight to the Microsoft sign-in.

`SSO_ENABLED` plus the `ENTRA_*` trio (`TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`,
`ENTRA_REDIRECT_URI`) configure the flow. It **fails closed**: with the client id/secret empty, SSO
stays disabled rather than half-working. The redirect URI must match what IT registered exactly —
prod uses `https://ams.voipsystem.org/api/auth/sso/callback`, dev
`http://localhost:3001/auth/sso/callback` — and `APP_URL` is the frontend origin the flow lands on.

The Entra app registration for sign-in is **separate** from the app-only `GRAPH_*` registration used
for SharePoint. One gotcha worth knowing: if the app is configured as assignment-required in Entra, a
user who is not assigned gets rejected at Microsoft rather than by AMS.

Sessions are a JWT plus a refresh token (`JWT_SECRET` / `REFRESH_TOKEN_SECRET`, with `JWT_EXPIRES_IN`
and `REFRESH_TOKEN_EXPIRES_IN`).

## The access model

Three orthogonal pieces, resolved centrally by `common/access/AccessResolver`:

- **Permission** — Viewer, Editor, or Admin.
- **Section** — `sms`, `voice`, or both. A role can span both; the picker is multi-select.
- **Role** — a named pairing of permission and section(s), assigned to users via `user_roles`.

Every dataset and every condition carries a section, so section membership is what filters what a
user sees. Editors are further constrained: an editor's options are strictly scoped to their own
section, they can create Viewer users, and they can delete viewer users they themselves created.

## Registering a report for access control

Put `@ReportAccess(<key>, <label>, <section>)` on the report's controller, alongside
`@UseGuards(JwtAuthGuard, ReportAccessGuard)`:

```ts
@Controller('reports/voice-outliers')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('voice-outliers', 'Voice Outliers', 'voice')
```

The admin access list is **auto-discovered** from these decorators, so a new report needs no
registry edit. Only two things remain manual: the nav sidebar entry and the frontend route.

Admin-only operations add `RolesGuard` and `@Roles('admin')` — Voice Outliers' `POST /rebuild` is an
example, since it can load the production billing DB.

## Administration and audit

`admin` covers users, groups, roles, datasets, data sources, reports and the audit log; `audit`
records privileged actions. Read-only database access for Hayo's AI platform is a separate path with
its own role and keys — see [mcp-server.md](mcp-server.md).
