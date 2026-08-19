# Alerting

How a stage table turns into an email or a Teams card. Modules: `conditions`, `scheduler`,
`notifications`.

```
stage table ──▶ condition (SQL or Python) ──▶ matched rows ──▶ notification
                      ▲                                            │
            trigger_cron, set in the UI                   email (SMTP relay) + Teams
                                                                   │
                                                            notification_log
```

## Conditions

A condition is one alert. Two types:

- **dataset** — a SQL predicate evaluated against a stage table by `ConditionEvaluatorService`.
- **python** — a script run by `PythonExecutorService` in the image's venv
  (`/opt/ams-venv/bin/python3`), for logic SQL cannot express: comparing a reading against the
  previous one, recomputing a period, formatting a bespoke email body.

Every condition carries a `section` (`sms` / `voice`), which is what scopes alert visibility — a
voice editor does not see SMS alerts.

**Python conditions have a 5-minute executor timeout.** Any alert that recomputes a whole month in
one pass (Supreme, Weekly Volume) starts failing late in the month with `exited with code null` as
the recompute grows past the limit. The fix is a set-based per-day query with concurrency rather
than a bigger timeout.

## Scheduling

Alert schedules are **user-managed**. Each condition has a `trigger_cron` edited in the Alerts UI
and executed by `ConditionSchedulerService`. Alert services no longer carry `@Cron` decorators — an
earlier arrangement where both existed caused double-triggering. Changing when an alert runs is a UI
change, not a deploy.

Report services may seed a `defaultCron` when they create a fresh condition, but never override an
existing one — an operator's schedule change survives every deploy. The same applies to recipients
in most reports: they are re-applied on boot by adding, not by replacing, so addresses added through
the UI are not lost (Google MO is explicit about this).

## Notifications

Two transports, both via `notifications`:

- **Email** — nodemailer to the SMTP relay at `10.10.14.11:25` (plain, no auth, from
  `donotreply@hayo.net`). Because this is a relay rather than Graph sendMail, the old "only one
  inline cid image" constraint no longer applies. A Graph token is still acquired, but only for
  SharePoint reads; `graph_token: not_acquired` in `/system/health` is therefore normal on a VM that
  does not need SharePoint.
- **Teams** — an incoming webhook (`TEAMS_DEFAULT_WEBHOOK_URL`, overridable per condition). Multiple
  matched rows produce **one consolidated card**, not a card per row.

Every send is recorded in `notification_log` (`NotificationLog`), which is what the alert history UI reads. Duplicate suppression compares the payload,
so a python alert that fires twice with identical data sends once. Test sends are not written as a
real `conditionId`.

`ALERTS_ENABLED` is the master switch for all outbound notifications. Set it to exactly `false` on
a local or dev backend — a local instance shares the AMS database's conditions and recipients and
would otherwise send real alerts to real people. Only the literal string `false` disables; the
default is enabled.
