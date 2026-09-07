/**
 * Dataset definitions for Zamani SMS Firewall pages 2-5.
 *
 * Page 1 (Traffic Overview) and the pipeline/daily feeds live in zamani-firewall.service.ts; the
 * rest are here so neither file becomes unreadable. All of them read only `zamani.v_*`, so the
 * correctness rules in sql/views.sql apply to every panel without being restated.
 *
 * Timestamps MUST be emitted as strings — StageService.sanitizeRowKeys() truncates every JS Date to
 * 'YYYY-MM-DD', and a 'T'-separated midnight string is stripped the same way. 'YYYY-MM-DD
 * HH24:MI:SS+00' survives both. See the header comment in the service for the full explanation.
 */

const TS = (col: string) => `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS+00')`;

export type ColumnDef = { key: string; label: string; type: string; description: string };

export type DatasetDef = {
  stage: string;
  name: string;
  description: string;
  sql: string;
  columns: ColumnDef[];
  cron: string;
  /** Rolling-overlap datasets re-pull this many trailing minutes each cycle. */
  overlapMinutes: number;
  retentionDays: number;
};

const OVERLAP = 360;
const RETENTION = 7;

// Shared window predicate. Filtering on business_date as well as bucket_hour is what lets the
// planner prune the monthly partitions instead of scanning the whole table.
const WINDOW = `
WHERE business_date >= (TIMESTAMPTZ '{{SINCE}}' AT TIME ZONE 'UTC')::date
  AND bucket_hour   >= (TIMESTAMPTZ '{{SINCE}}' AT TIME ZONE 'UTC')`;

// =================================================================================================
// Page 2 · Firewall Effectiveness
// =================================================================================================

// Two grains in one table so the source is scanned once rather than twice: `grain = 'tag'` carries
// the per-tag totals and `grain = 'sender'` the top senders behind each tag. They must never be
// summed together — every read filters on grain.
const TAGS_SQL = `
SELECT
    ${TS('bucket_hour')}    AS bucket_hour,
    business_date           AS date,
    'tag'                   AS grain,
    stream,
    tag,
    NULL::text              AS sender_id,
    messages,
    senders,
    subscribers,
    intervened,
    NULL::bigint            AS via_smscs
FROM zamani.v_firewall_tags_hourly
${WINDOW}

UNION ALL

SELECT
    ${TS('bucket_hour')}    AS bucket_hour,
    business_date           AS date,
    'sender'                AS grain,
    stream,
    tag,
    sender_id,
    messages,
    NULL::bigint            AS senders,
    NULL::bigint            AS subscribers,
    intervened,
    via_smscs
FROM zamani.v_firewall_tag_senders_hourly
${WINDOW}
`;

const TAGS_COLUMNS: ColumnDef[] = [
  { key: 'bucket_hour', label: 'Hour (UTC)',   type: 'timestamp', description: 'Start of the UTC hour.' },
  { key: 'date',        label: 'Date (UTC)',   type: 'date',      description: 'UTC calendar date; drives the retention prune.' },
  { key: 'grain',       label: 'Grain',        type: 'text',      description: "'tag' = per-tag totals, 'sender' = top senders per tag. Never mix the two in one sum." },
  { key: 'stream',      label: 'Stream',       type: 'text',      description: 'ss7 or smpp.' },
  { key: 'tag',         label: 'Tag',          type: 'text',      description: 'Firewall rule tag that fired on the message.' },
  { key: 'sender_id',   label: 'Sender ID',    type: 'text',      description: "Sender, only for grain='sender'; NULL for tag totals." },
  { key: 'messages',    label: 'Messages',     type: 'numeric',   description: 'Corrected messages carrying the tag (SS7 multipart reassembled, tags read from the first segment).' },
  { key: 'senders',     label: 'Senders',      type: 'numeric',   description: "Distinct senders in the hour, only for grain='tag'. Per-hour distinct — not additive." },
  { key: 'subscribers', label: 'Subscribers',  type: 'numeric',   description: "Distinct subscribers in the hour, only for grain='tag'. Per-hour distinct — not additive." },
  { key: 'intervened',  label: 'Intervened',   type: 'numeric',   description: 'Of those messages, how many the firewall did not plainly send.' },
  { key: 'via_smscs',   label: 'Via SMSCs',    type: 'numeric',   description: "Distinct SMSC global titles the sender arrived through (grain='sender'); >1 on int_a2p is the grey-route signal." },
];

// =================================================================================================
// Page 3 · Delivery Quality (SMPP)
// =================================================================================================

const DLR_SQL = `
SELECT
    ${TS('bucket_hour')}    AS bucket_hour,
    business_date           AS date,
    'outcome'               AS grain,
    dlr_stat,
    dlr_err,
    network_error_code,
    NULL::text              AS sender_id,
    receipts,
    NULL::bigint            AS destinations,
    orphan_receipts
FROM zamani.v_smpp_dlr_hourly
${WINDOW}

UNION ALL

SELECT
    ${TS('bucket_hour')}    AS bucket_hour,
    business_date           AS date,
    'sender'                AS grain,
    dlr_stat,
    NULL::text              AS dlr_err,
    NULL::text              AS network_error_code,
    sender_id,
    receipts,
    destinations,
    0                       AS orphan_receipts
FROM zamani.v_smpp_dlr_senders_hourly
${WINDOW}
`;

const DLR_COLUMNS: ColumnDef[] = [
  { key: 'bucket_hour',        label: 'Hour (UTC)',    type: 'timestamp', description: 'Start of the UTC hour the receipt arrived in.' },
  { key: 'date',               label: 'Date (UTC)',    type: 'date',      description: 'UTC calendar date; drives the retention prune.' },
  { key: 'grain',              label: 'Grain',         type: 'text',      description: "'outcome' = per status/error, 'sender' = per originating sender. Never mix the two in one sum." },
  { key: 'dlr_stat',           label: 'DLR Status',    type: 'text',      description: 'DELIVRD, EXPIRED, UNDELIV or REJECTD.' },
  { key: 'dlr_err',            label: 'DLR Error',     type: 'text',      description: "Operator error code accompanying the status (grain='outcome')." },
  { key: 'network_error_code', label: 'Network Error', type: 'text',      description: "SMPP network error code (grain='outcome')." },
  { key: 'sender_id',          label: 'Sender ID',     type: 'text',      description: "Sender of the ORIGINAL submit (grain='sender'); '(unmatched)' when the submit is outside the window." },
  { key: 'receipts',           label: 'Receipts',      type: 'numeric',   description: 'Delivery receipts counted.' },
  { key: 'destinations',       label: 'Destinations',  type: 'numeric',   description: "Distinct destination addresses for the sender in the hour (grain='sender'). Per-hour distinct — not additive." },
  { key: 'orphan_receipts',    label: 'Orphans',       type: 'numeric',   description: 'Receipts whose originating submit falls outside the loaded window — kept, since they are still real outcomes.' },
];

const LATENCY_SQL = `
SELECT
    ${TS('bucket_hour')} AS bucket_hour,
    business_date        AS date,
    pdu_kind,
    pairs,
    p50_ms,
    p95_ms,
    p99_ms,
    max_ms
FROM zamani.v_smpp_latency_hourly
${WINDOW}
`;

const LATENCY_COLUMNS: ColumnDef[] = [
  { key: 'bucket_hour', label: 'Hour (UTC)', type: 'timestamp', description: 'Start of the UTC hour.' },
  { key: 'date',        label: 'Date (UTC)', type: 'date',      description: 'UTC calendar date; drives the retention prune.' },
  { key: 'pdu_kind',    label: 'PDU',        type: 'text',      description: "'submit' (submit-sm) or 'deliver' (deliver-sm) round trip." },
  { key: 'pairs',       label: 'Pairs',      type: 'numeric',   description: 'Request/response pairs matched within a bind — the sample size behind the percentiles.' },
  { key: 'p50_ms',      label: 'p50 (ms)',   type: 'numeric',   description: 'Median round-trip. No mean is stored: a mean is what made the mispaired version look plausible.' },
  { key: 'p95_ms',      label: 'p95 (ms)',   type: 'numeric',   description: '95th percentile round-trip.' },
  { key: 'p99_ms',      label: 'p99 (ms)',   type: 'numeric',   description: '99th percentile round-trip.' },
  { key: 'max_ms',      label: 'max (ms)',   type: 'numeric',   description: 'Slowest matched pair. A jump here is the first sign pairing has drifted.' },
];

// =================================================================================================
// Page 4 · Network & SRI Integrity
// =================================================================================================

const SRI_SQL = `
SELECT
    ${TS('bucket_hour')}    AS bucket_hour,
    business_date           AS date,
    'hour'                  AS grain,
    NULL::text              AS smsc,
    NULL::text              AS calling_party,
    requests,
    msisdns,
    requests_per_msisdn,
    smscs,
    callers,
    requests_per_sec
FROM zamani.v_sri_hourly
${WINDOW}

UNION ALL

SELECT
    ${TS('bucket_hour')}    AS bucket_hour,
    business_date           AS date,
    'smsc'                  AS grain,
    smsc,
    calling_party,
    requests,
    msisdns,
    requests_per_msisdn,
    NULL::bigint            AS smscs,
    NULL::bigint            AS callers,
    NULL::numeric           AS requests_per_sec
FROM zamani.v_sri_smsc_hourly
${WINDOW}
`;

const SRI_COLUMNS: ColumnDef[] = [
  { key: 'bucket_hour',         label: 'Hour (UTC)',      type: 'timestamp', description: 'Start of the UTC hour.' },
  { key: 'date',                label: 'Date (UTC)',      type: 'date',      description: 'UTC calendar date; drives the retention prune.' },
  { key: 'grain',               label: 'Grain',           type: 'text',      description: "'hour' = whole-hour totals, 'smsc' = per querying node. Never mix the two in one sum." },
  { key: 'smsc',                label: 'SMSC',            type: 'text',      description: "Querying SMSC (grain='smsc')." },
  { key: 'calling_party',       label: 'Calling Party',   type: 'text',      description: "Global title that issued the lookup (grain='smsc')." },
  { key: 'requests',            label: 'Requests',        type: 'numeric',   description: 'SRI-for-SM lookups. One row is one lookup, so no dedupe applies here.' },
  { key: 'msisdns',             label: 'MSISDNs',         type: 'numeric',   description: 'Distinct numbers queried in the hour. Per-hour distinct — not additive.' },
  { key: 'requests_per_msisdn', label: 'Req / MSISDN',    type: 'numeric',   description: 'The enumeration detector: ~1.0 is healthy; a sustained rise means the same numbers are being probed repeatedly.' },
  { key: 'smscs',               label: 'SMSCs',           type: 'numeric',   description: "Distinct querying SMSCs in the hour (grain='hour')." },
  { key: 'callers',             label: 'Callers',         type: 'numeric',   description: "Distinct calling global titles in the hour (grain='hour')." },
  { key: 'requests_per_sec',    label: 'Req / sec',       type: 'numeric',   description: "Averaged over the whole hour (grain='hour'), so short bursts are understated." },
];

const ROUTING_SQL = `
SELECT
    ${TS('bucket_hour')}    AS bucket_hour,
    business_date           AS date,
    traffic_source_name,
    opc,
    dpc,
    calling_party,
    messages,
    raw_rows,
    subscribers,
    intervened
FROM zamani.v_ss7_routing_hourly
${WINDOW}
`;

const ROUTING_COLUMNS: ColumnDef[] = [
  { key: 'bucket_hour',         label: 'Hour (UTC)',     type: 'timestamp', description: 'Start of the UTC hour.' },
  { key: 'date',                label: 'Date (UTC)',     type: 'date',      description: 'UTC calendar date; drives the retention prune.' },
  { key: 'traffic_source_name', label: 'Traffic Source', type: 'text',      description: 'Named ingress link on the firewall, e.g. MP2-MSC1-INCOMING-2.' },
  { key: 'opc',                 label: 'OPC',            type: 'numeric',   description: 'Originating SS7 point code.' },
  { key: 'dpc',                 label: 'DPC',            type: 'numeric',   description: 'Destination SS7 point code.' },
  { key: 'calling_party',       label: 'Calling GT',     type: 'text',      description: 'SMSC global title — the interconnect identity, never the message sender.' },
  { key: 'messages',            label: 'Messages',       type: 'numeric',   description: 'Corrected messages on this route, so routing reconciles with the traffic page.' },
  { key: 'raw_rows',            label: 'Raw Rows',       type: 'numeric',   description: 'Uncorrected segment count on this route.' },
  { key: 'subscribers',         label: 'Subscribers',    type: 'numeric',   description: 'Distinct subscribers reached in the hour. Per-hour distinct — not additive.' },
  { key: 'intervened',          label: 'Intervened',     type: 'numeric',   description: 'Messages the firewall did not plainly send on this route.' },
];

// =================================================================================================
// Page 5 · Pipeline Health — content-encoding defects
// =================================================================================================

const CONTENT_SQL = `
SELECT
    ${TS('bucket_hour')} AS bucket_hour,
    business_date        AS date,
    data_coding,
    messages,
    null_content,
    mojibake,
    mojibake_pct
FROM zamani.v_smpp_content_defects_hourly
${WINDOW}
`;

const CONTENT_COLUMNS: ColumnDef[] = [
  { key: 'bucket_hour',  label: 'Hour (UTC)',   type: 'timestamp', description: 'Start of the UTC hour.' },
  { key: 'date',         label: 'Date (UTC)',   type: 'date',      description: 'UTC calendar date; drives the retention prune.' },
  { key: 'data_coding',  label: 'Data Coding',  type: 'numeric',   description: 'SMPP data_coding: 0 = GSM 7-bit, 3 = Latin-1, 8 = UCS2. Damage is confined to 3.' },
  { key: 'messages',     label: 'Messages',     type: 'numeric',   description: 'SMPP requests with this data_coding in the hour.' },
  { key: 'null_content', label: 'Null Content', type: 'numeric',   description: 'Messages whose content did not survive ingest at all.' },
  { key: 'mojibake',     label: 'Mojibake',     type: 'numeric',   description: 'Messages double-encoded at source: UTF-8 bytes declared as Latin-1, so the text reads back as mojibake.' },
  { key: 'mojibake_pct', label: 'Mojibake %',   type: 'numeric',   description: 'Defect rate within this data_coding — the honest denominator, since an overall rate moves with the encoding mix.' },
];

// =================================================================================================
// Messages tabs · SS7 / SMPP hourly breakdowns on the exact dimensions the tabs display
// =================================================================================================

// Both read the message-grain views, so SS7 multipart dedupe and the SMPP requests-only rule come
// for free and the tab totals reconcile with the Traffic Overview page. traffic_source_name is
// stored RAW (e.g. Hayosms1) — the Hayo display label is applied in the service, never persisted.

// Senders per hour kept on the SS7 grain, capped. Measured on the busiest hour of 2026-09-06
// (517,416 messages): the grain without sender is 14 rows, WITH sender it is 49,590 — a 3,542x
// explosion, ~8M stage rows over the 7-day retention, and the tab only ever renders its top 2000.
// The tail is what makes it explode, not the volume: ~50 senders carry 78.3% of an hour and the
// remaining ~49,470 are P2P handsets sending one or two messages each (top 100 = 78.5%,
// top 500 = 79.6% — the curve is flat past 50).
//
// So the top SS7_SENDER_CAP rows per hour are kept by name and everything below is folded into a
// single '(other senders)' row per (calling party, action, direction). Messages therefore still
// SUM to the true hourly total — the Total row and the Traffic Overview tab keep reconciling —
// while rows stay bounded at ~cap + a handful per hour.
const SS7_SENDER_CAP = 200;

const SS7_ACTIONS_SQL = `
WITH g AS (
    SELECT
        bucket_hour,
        business_date,
        COALESCE(calling_party, '(unknown)') AS calling_party,
        COALESCE(final_action, 'unknown')    AS final_action,
        COALESCE(direction, 'unknown')       AS direction,
        COALESCE(sender_id, '(none)')        AS sender_id,
        COUNT(*)                             AS messages
    FROM zamani.v_ss7_messages
    ${WINDOW}
    GROUP BY 1, 2, 3, 4, 5, 6
), ranked AS (
    -- sender_id as a tiebreaker keeps the cut deterministic across refreshes of the same hour,
    -- so a re-pulled hour does not silently swap which senders are named.
    SELECT g.*, ROW_NUMBER() OVER (PARTITION BY bucket_hour ORDER BY messages DESC, sender_id) AS rn
    FROM g
)
SELECT ${TS('bucket_hour')} AS bucket_hour, business_date AS date,
       calling_party, final_action, direction, sender_id, messages
  FROM ranked
 WHERE rn <= ${SS7_SENDER_CAP}
UNION ALL
SELECT ${TS('bucket_hour')} AS bucket_hour, business_date AS date,
       calling_party, final_action, direction, '(other senders)' AS sender_id,
       SUM(messages) AS messages
  FROM ranked
 WHERE rn > ${SS7_SENDER_CAP}
 GROUP BY bucket_hour, business_date, calling_party, final_action, direction
`;

const SS7_ACTIONS_COLUMNS: ColumnDef[] = [
  { key: 'bucket_hour',   label: 'Hour (UTC)',    type: 'timestamp', description: 'Start of the UTC hour.' },
  { key: 'date',          label: 'Date (UTC)',    type: 'date',      description: 'UTC calendar date; drives the retention prune.' },
  { key: 'calling_party', label: 'Calling Party', type: 'text',      description: 'SMSC global title the message arrived from — the interconnect identity, never the message sender.' },
  { key: 'final_action',  label: 'Final Action',  type: 'text',      description: 'What the firewall ultimately did: send, lookup, modify, drop, negative_ack…' },
  { key: 'direction',     label: 'Direction',     type: 'text',      description: 'Traffic direction as logged (e.g. incoming / outgoing).' },
  { key: 'sender_id',     label: 'Sender ID',     type: 'text',      description: 'Originator shown on the message — the real sender, unlike calling_party. Top 200 senders per hour are named; the long P2P tail is folded into a single (other senders) row so the hourly total stays exact.' },
  { key: 'messages',      label: 'Messages',      type: 'numeric',   description: 'Corrected SS7 messages (multipart reassembled) for this combination in the hour.' },
];

// SMPP traffic_source_name on the wire is a per-TCP-connection bind name —
// 'hayosms1_mp1_smsc1_172_26_15_196_44930' (source_mpN_smscN_ip_port) — and every reconnect mints
// a new port. Grouping on the raw value would split one logical source across dozens of rows, so
// the connection suffix is stripped here and the stage stores the logical source ('hayosms1',
// 'wirepick', …). Names without the suffix pass through unchanged.
const SMPP_SOURCE = `regexp_replace(COALESCE(traffic_source_name, '(unknown)'), '_mp[0-9]+_smsc[0-9]+_.*$', '')`;

const SMPP_MESSAGES_SQL = `
SELECT
    ${TS('bucket_hour')}    AS bucket_hour,
    business_date           AS date,
    message_type,
    COALESCE(direction, 'unknown')             AS direction,
    COALESCE(sender_id, '(none)')              AS sender_id,
    COALESCE(final_action, 'unknown')          AS final_action,
    ${SMPP_SOURCE}                             AS traffic_source_name,
    COUNT(*)                AS messages
FROM zamani.v_smpp_messages
${WINDOW}
GROUP BY bucket_hour, business_date, 3, 4, 5, 6, 7
`;

const SMPP_MESSAGES_COLUMNS: ColumnDef[] = [
  { key: 'bucket_hour',         label: 'Hour (UTC)',     type: 'timestamp', description: 'Start of the UTC hour.' },
  { key: 'date',                label: 'Date (UTC)',     type: 'date',      description: 'UTC calendar date; drives the retention prune.' },
  { key: 'message_type',        label: 'Message Type',   type: 'text',      description: 'submit-sm or deliver-sm — requests only, acknowledgements are excluded by the view.' },
  { key: 'direction',           label: 'Direction',      type: 'text',      description: 'Traffic direction as logged.' },
  { key: 'sender_id',           label: 'Sender ID',      type: 'text',      description: 'Originating address of the message.' },
  { key: 'final_action',        label: 'Final Action',   type: 'text',      description: 'What the firewall ultimately did with the message.' },
  { key: 'traffic_source_name', label: 'Traffic Source', type: 'text',      description: 'Logical SMPP source — the bind name with its per-connection _mpN_smscN_ip_port suffix stripped (e.g. hayosms1, wirepick). Display shows any hayo* source as Hayo.' },
  { key: 'messages',            label: 'Messages',       type: 'numeric',   description: 'SMPP request PDUs for this combination in the hour.' },
];

// =================================================================================================

/**
 * Crons are staggered on purpose. The SS7 datasets each scan millions of rows, and firing them on
 * the same minute would queue several heavy scans against the source at once for no extra
 * freshness — files land hourly, so twice an hour is already ahead of the data.
 */
export const EXTRA_DATASETS: DatasetDef[] = [
  {
    stage: 'stage_zfw_tags',
    name: 'Zamani Firewall Tags Hourly',
    description:
      'Zamani SMS Firewall — firewall rule (tag) frequency per hour and stream, plus the top senders behind each '
      + 'blocked/A2P tag. Counted in corrected messages with tags read from a multipart message\'s first segment, so a '
      + 'long SMS is not counted once per segment. Two grains in one table (grain = tag | sender) — never sum across them. '
      + 'Tag counts overlap and exceed the message total by design.',
    sql: TAGS_SQL, columns: TAGS_COLUMNS, cron: '10,40 * * * *',
    overlapMinutes: OVERLAP, retentionDays: RETENTION,
  },
  {
    stage: 'stage_zfw_dlr',
    name: 'Zamani Firewall Delivery Receipts',
    description:
      'Zamani SMS Firewall — SMPP delivery outcomes per hour: by status/error code and by originating sender. Receipts '
      + 'are joined to their submit on receipted_message_id (never on sequence_number, which is reused within the hour). '
      + 'Two grains in one table (grain = outcome | sender) — never sum across them.',
    sql: DLR_SQL, columns: DLR_COLUMNS, cron: '5,35 * * * *',
    overlapMinutes: OVERLAP, retentionDays: RETENTION,
  },
  {
    stage: 'stage_zfw_latency',
    name: 'Zamani Firewall SMPP Latency',
    description:
      'Zamani SMS Firewall — SMPP request/response round-trip percentiles per hour, paired within a bind '
      + '(src_ip, src_port) on the nearest following response. Percentiles only; no mean, because pairing on '
      + 'sequence_number alone yields a 24-minute mean that looks plausible until you check the maximum.',
    sql: LATENCY_SQL, columns: LATENCY_COLUMNS, cron: '5,35 * * * *',
    overlapMinutes: OVERLAP, retentionDays: RETENTION,
  },
  {
    stage: 'stage_zfw_sri',
    name: 'Zamani Firewall SRI Integrity',
    description:
      'Zamani SMS Firewall — SRI-for-SM volume per hour and per querying SMSC, with requests-per-MSISDN as the '
      + 'enumeration detector (~1.0 healthy; a sustained rise means repeated probing). Two grains in one table '
      + '(grain = hour | smsc) — never sum across them.',
    sql: SRI_SQL, columns: SRI_COLUMNS, cron: '15,45 * * * *',
    overlapMinutes: OVERLAP, retentionDays: RETENTION,
  },
  {
    stage: 'stage_zfw_routing',
    name: 'Zamani Firewall SS7 Routing',
    description:
      'Zamani SMS Firewall — SS7 interconnect volumes per hour by traffic source, OPC/DPC and SMSC global title, on '
      + 'deduped messages so routing figures reconcile with the traffic page.',
    sql: ROUTING_SQL, columns: ROUTING_COLUMNS, cron: '20,50 * * * *',
    overlapMinutes: OVERLAP, retentionDays: RETENTION,
  },
  {
    stage: 'stage_zfw_content',
    name: 'Zamani Firewall Content Defects',
    description:
      'Zamani SMS Firewall — content-encoding defect rate per hour and data_coding: messages double-encoded at source '
      + '(UTF-8 bytes declared as Latin-1). Broken out per data_coding because an overall rate moves with the encoding '
      + 'mix and would mask whether the source bug itself changed.',
    sql: CONTENT_SQL, columns: CONTENT_COLUMNS, cron: '25,55 * * * *',
    overlapMinutes: OVERLAP, retentionDays: RETENTION,
  },
  {
    stage: 'stage_zfw_ss7_actions',
    name: 'Zamani Firewall SS7 Messages',
    description:
      'Zamani SMS Firewall — SS7 messages per hour by calling party (SMSC GT), final firewall action and direction, '
      + 'backing the SS7 messages tab. Counted in corrected messages (multipart reassembled), so tab totals reconcile '
      + 'with the Traffic Overview page.',
    sql: SS7_ACTIONS_SQL, columns: SS7_ACTIONS_COLUMNS, cron: '12,42 * * * *',
    overlapMinutes: OVERLAP, retentionDays: RETENTION,
  },
  {
    stage: 'stage_zfw_smpp_messages',
    name: 'Zamani Firewall SMPP Messages',
    description:
      'Zamani SMS Firewall — SMPP request PDUs per hour by message type, direction, sender ID, final action and '
      + 'traffic source, backing the SMPP messages tab. Requests only (submit-sm / deliver-sm — acknowledgements '
      + 'excluded). traffic_source_name is stored raw; the Hayosms1 → Hayo label is display-only.',
    sql: SMPP_MESSAGES_SQL, columns: SMPP_MESSAGES_COLUMNS, cron: '7,37 * * * *',
    overlapMinutes: OVERLAP, retentionDays: RETENTION,
  },
];
