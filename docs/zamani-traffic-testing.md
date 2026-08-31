# Zamani Traffic include Testing

Clone of the **Zamani Traffic** report that includes **all approved suppliers** for the
Zamani destination (operator `Niger Orange (zamani)`, MccMnc 614004): the direct
`Zamani_Niger` route **plus the `Innovatio` testing route**. The original report is
Zamani_Niger-only and stays untouched.

Requested by the Zamani ops/sales side (Aug 2026) so Sales can see the full picture,
filter by supplier, and answer "what traffic has been added?" month over month.

## Data flow

- Dataset **"Zamani Traffic include Testing"** → stage table **`zamani_traffic_testing`**.
- Same EDR aggregation SQL as the original dataset, with the vendor filter widened to
  `mvc.Name IN ('Zamani_Niger', 'Innovatio')`. The approved-supplier list is imported
  from `ZAMANI_APPROVED_VENDORS` in `zamani-senderid.service.ts` (single source of truth).
- Nightly refresh at **01:30** — deliberately staggered 30 min after the original
  Zamani Traffic refresh (01:00) so the two full EDR scans never hit the SMSC server
  concurrently.
- Backend: `backend/src/reports/zamani-testing/` (`reports/zamani-testing/*` endpoints,
  access slug `zamani-testing`, section `sms`).
- Frontend: `/reports/zamani-traffic-testing`.

## Tabs

Same six tabs as the original, plus **New Senders**:

| Tab | Notes |
| --- | --- |
| Yesterday Data | as original, respects the supplier filter |
| Comparison | day / month / range modes, respects the supplier filter |
| **New Senders** | month vs month: senders present in the new month with no traffic in the old month (**Added**, answers "what traffic has been added?"), and the inverse (**Lost**). Per sender × customer × supplier with first/last-seen dates, messages, DLR %, revenue, margin |
| Month to Date | as original, respects the supplier filter |
| Projections | identical to the original (incl. €137k target gauge and gap), respects the supplier filter |
| Cost Vs Revenue | as original, respects the supplier filter |
| Investment Recovery | **delegated to the original `ZamaniReportService`** — always Zamani_Niger-route-only figures against the €546k investment, no duplicate cron or tracking table. The global supplier filter does not apply here |

## Global supplier filter

A page-level **Supplier** dropdown (All / Zamani_Niger / Innovatio) in the header applies
to every tab except Investment Recovery. Backend-side it maps to
`vendorconnection = $supplier` on the stage queries (`supplier` query param on every
endpoint).

## Shared state with the original report

- **`zamani_targets`** (monthly targets) is shared — one set of Zamani targets, editable
  from either report's targets endpoint.
- **Investment recovery** data comes from the original module (see above).
- Everything else (dataset, stage table, endpoints) is fully separate.

## Deploy notes

- First deploy seeds the dataset row + empty stage table on boot; the first refresh
  backfills from 2026-01-01 (same weight as the original's nightly full re-pull).
  Trigger a manual refresh from Admin → Datasets, or wait for the 01:30 cron.
- Remember the scheduler stale-metadata gotcha: after deploying dataset SQL changes,
  restart the backend a second time and verify against actually-refreshed data.
- Grant report access (slug `zamani-testing`) to the Sales users in Admin → Access.

## Possible phase 2

A scheduled "new senders this month" alert to Sales can reuse
`GET /reports/zamani-testing/new-senders` directly (defaults: previous vs current month).
