-- Zamani SMS Firewall — semantic layer
--
-- Target: the "Zamani Logs" data source (PostgreSQL, schema `zamani`), which holds the three
-- firewall streams `zamani.ss7`, `zamani.smpp`, `zamani.sri_req` plus the ingest `zamani.load_log`.
--
-- Apply with:
--   psql -h <host> -U <user> -d <db> -f sql/views.sql
--
-- Why these exist: the raw tables cannot be counted naively. Five properties of the data produce
-- badly wrong numbers if a panel aggregates the base tables directly. Every rule is encoded here,
-- once, so that AMS datasets — and any other consumer — inherit correct definitions.
--
--   R1  SS7 `called_party` is NOT the recipient. It is the SCCP global title of the receiving node
--       (11 distinct values across 8.7M rows); `calling_party` is the SMSC GT (39 values). The
--       subscriber is `imsi`, the sender is `sender_id`. Counting "recipients" on called_party
--       yields 1 per sender. called_party/calling_party are exposed as routing dimensions only.
--
--   R2  One SS7 row != one message. Multipart SMS is stored one row per segment, so raw row counts
--       overstate volume by ~27%. A logical message is one (imsi, concat_ref) group; single-part
--       rows (concat_ref IS NULL) are already one message each.
--
--   R3  Half of all SMPP rows are responses, not messages (submit-sm-response,
--       deliver-sm-response). Requests are the message; responses are the acknowledgement.
--       Unfiltered counts double-count traffic.
--
--   R4  SMPP `sequence_number` is reused within the hour, so pairing request->response on it alone
--       produces false matches (a plausible 63ms mean hiding a 41-minute maximum). Delivery is
--       therefore joined on `receipted_message_id` -> `message_id`, which is unique per message;
--       any latency measure must pair within a bind (src_ip, src_port) and take the nearest
--       following response.
--
--   R5  Timezone. `event_time` is timestamptz and the source server's session timezone is
--       America/Los_Angeles, NOT UTC — and AMS does not pin UTC on external data-source pools
--       (only on its own and the MCP reader). A bare date_trunc('hour', event_time) therefore
--       buckets 7-8 hours off UTC, with a DST discontinuity. Every truncation below is written
--       `AT TIME ZONE 'UTC'` so the views are correct regardless of who connects.
--       `business_date` in the base tables is already UTC-aligned (verified 58,320/58,320 rows).
--
-- Deliberate approximations, measured rather than assumed (2026-08-13, 8.7M SS7 rows):
--   * Multipart groups are bucketed by hour, which double-counts a message whose segments straddle
--     an hour boundary: 2,250 of 3,719,171 groups = 0.06%. This is what makes each hour
--     independently computable, and so makes the incremental hourly rollup possible at all.
--   * (imsi, concat_ref) collides when a subscriber is sent two multipart messages sharing a
--     16-bit reference: 4,823 of 3,719,171 groups = 0.13% carry more segments than concat_max.
--   Both are far below the ~27% error that counting raw rows would introduce.
--
--   R6  The hour in a log file's NAME cannot be used as its traffic hour — it is a 12-hour clock
--       with no AM/PM and it names the rotation hour, not the hour covered. Ingest coverage is
--       anchored on `file_mtime` instead. Detail at v_pipeline_health below.
--
-- NOTE ON DISTINCT COUNTS: per-hour distinct counts are NOT additive. Summing `subscribers_hr`
-- across hours does not give unique subscribers for the day — the same subscriber recurs in many
-- hours. Use v_ss7_daily for an exact per-day figure, or present the hourly value as per-hour.
--
-- NOTE ON TAG COUNTS: a message carries several firewall tags at once, so tag counts sum to more
-- than the message total. They are a set of overlapping flags, never a partition of traffic.

CREATE SCHEMA IF NOT EXISTS zamani;

-- Dropped in reverse dependency order before being recreated. CREATE OR REPLACE VIEW cannot add,
-- remove or reorder a column, so replacing in place breaks as soon as a definition gains a field —
-- dropping first keeps this script re-runnable after any edit below.
-- page 2-4 views first (they read the base views below)
DROP VIEW IF EXISTS zamani.v_smpp_content_defects_hourly;
DROP VIEW IF EXISTS zamani.v_firewall_tag_senders_hourly;
DROP VIEW IF EXISTS zamani.v_firewall_tags_hourly;
DROP VIEW IF EXISTS zamani.v_ss7_message_tags;
DROP VIEW IF EXISTS zamani.v_smpp_dlr_senders_hourly;
DROP VIEW IF EXISTS zamani.v_smpp_dlr_hourly;
DROP VIEW IF EXISTS zamani.v_smpp_latency_hourly;
DROP VIEW IF EXISTS zamani.v_sri_smsc_hourly;
DROP VIEW IF EXISTS zamani.v_sri_hourly;
DROP VIEW IF EXISTS zamani.v_ss7_routing_hourly;
-- then the page 1/5 views
DROP VIEW IF EXISTS zamani.v_pipeline_hourly;
DROP VIEW IF EXISTS zamani.v_pipeline_health;
DROP VIEW IF EXISTS zamani.v_traffic_hourly;
DROP VIEW IF EXISTS zamani.v_ss7_daily;
-- base views last
DROP VIEW IF EXISTS zamani.v_smpp_delivery;
DROP VIEW IF EXISTS zamani.v_smpp_submits;
DROP VIEW IF EXISTS zamani.v_smpp_messages;
DROP VIEW IF EXISTS zamani.v_ss7_messages;

-- ---------------------------------------------------------------------------------------------
-- v_ss7_messages — one row per logical SS7 message (R1, R2, R5)
-- ---------------------------------------------------------------------------------------------
-- The base for all SS7 volume. Multipart segments are reassembled to a single row; single-part
-- rows pass through. `parts` gives the segment count so long-SMS load is still measurable.
--
-- Grouping keys are (business_date, bucket_hour, imsi, concat_ref) so that a predicate on
-- business_date or bucket_hour pushes down through the aggregate into the monthly partitions —
-- without that, every read would scan the whole table.
--
-- final_action is invariant within a multipart group (verified 0 of 192,043 groups mixed), so
-- min() is a faithful representative rather than an arbitrary pick.
CREATE OR REPLACE VIEW zamani.v_ss7_messages AS
SELECT
    business_date,
    date_trunc('hour', event_time AT TIME ZONE 'UTC') AS bucket_hour,
    imsi,
    sender_id,
    final_action,
    direction,
    calling_party,                      -- routing dimension (SMSC GT) — NOT the sender (R1)
    called_party,                       -- routing dimension (node GT) — NOT the recipient (R1)
    traffic_source_name,
    country,
    network,
    1        AS parts,
    FALSE    AS is_multipart
FROM zamani.ss7
WHERE concat_ref IS NULL

UNION ALL

SELECT
    business_date,
    bucket_hour,
    imsi,
    MIN(sender_id)           AS sender_id,
    MIN(final_action)        AS final_action,
    MIN(direction)           AS direction,
    MIN(calling_party)       AS calling_party,
    MIN(called_party)        AS called_party,
    MIN(traffic_source_name) AS traffic_source_name,
    MIN(country)             AS country,
    MIN(network)             AS network,
    COUNT(*)::int            AS parts,
    TRUE                     AS is_multipart
FROM (
    SELECT
        business_date,
        date_trunc('hour', event_time AT TIME ZONE 'UTC') AS bucket_hour,
        imsi, concat_ref, sender_id, final_action, direction,
        calling_party, called_party, traffic_source_name, country, network
    FROM zamani.ss7
    WHERE concat_ref IS NOT NULL
) seg
GROUP BY business_date, bucket_hour, imsi, concat_ref;

COMMENT ON VIEW zamani.v_ss7_messages IS
'One row per logical SS7 message: multipart segments reassembled on (imsi, concat_ref) within an hour bucket, single-part rows passed through. Subscriber = imsi, sender = sender_id; called_party/calling_party are routing GTs only. Hour buckets are UTC-explicit.';

-- ---------------------------------------------------------------------------------------------
-- v_smpp_messages — SMPP requests only (R3, R5)
-- ---------------------------------------------------------------------------------------------
-- submit-sm (MT, operator-bound A2P) and deliver-sm (MO, plus DLR receipts). Responses are
-- excluded so counts are messages, not messages + acknowledgements.
CREATE OR REPLACE VIEW zamani.v_smpp_messages AS
SELECT
    business_date,
    date_trunc('hour', event_time AT TIME ZONE 'UTC') AS bucket_hour,
    event_time,
    message_type,
    direction,
    sender_id,
    dest_addr,
    source_addr,
    service_type,
    final_action,
    tags,
    dlr_stat,
    dlr_err,
    receipted_message_id,
    message_id,
    command_status,
    network_error_code,
    src_ip,
    src_port,
    traffic_source_name
FROM zamani.smpp
WHERE message_type IN ('submit-sm', 'deliver-sm');

COMMENT ON VIEW zamani.v_smpp_messages IS
'SMPP requests only (submit-sm, deliver-sm) — excludes submit-sm-response/deliver-sm-response, which are acknowledgements and would double-count traffic. Hour buckets are UTC-explicit.';

-- ---------------------------------------------------------------------------------------------
-- v_smpp_submits — each submit-sm with the message_id the SMSC assigned to it
-- ---------------------------------------------------------------------------------------------
-- Needed because a DLR names the message by `message_id`, but that id is only present on the
-- submit-sm-RESPONSE, while the sender and destination are only present on the submit-sm REQUEST.
-- Joining a receipt straight to the response therefore yields a row whose sender_id and dest_addr
-- are NULL for every record — which silently collapses "delivery rate by sender" into one
-- (unmatched) bucket. Verified on the loaded data: submit-sm-response has 0 distinct sender_id.
--
-- The request and its response share (src_ip, src_port, sequence_number), so they are linked the
-- same way latency is (R4): within a bind, taking the nearest FOLLOWING response. sequence_number
-- alone would mispair, since it is reused within the hour.
CREATE OR REPLACE VIEW zamani.v_smpp_submits AS
SELECT
    business_date,
    date_trunc('hour', event_time AT TIME ZONE 'UTC') AS bucket_hour,
    event_time,
    sender_id,
    dest_addr,
    traffic_source_name,
    assigned_message_id AS message_id
FROM (
    SELECT
        business_date, event_time, message_type, sender_id, dest_addr, traffic_source_name,
        (ARRAY_REMOVE(
            ARRAY_AGG(CASE WHEN message_type = 'submit-sm-response' THEN message_id END) OVER (
                PARTITION BY src_ip, src_port, sequence_number
                ORDER BY event_time
                ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
            ), NULL))[1] AS assigned_message_id
    FROM zamani.smpp
    WHERE message_type IN ('submit-sm', 'submit-sm-response')
      AND src_ip IS NOT NULL AND src_port IS NOT NULL
) x
WHERE message_type = 'submit-sm' AND assigned_message_id IS NOT NULL;

COMMENT ON VIEW zamani.v_smpp_submits IS
'Each submit-sm carrying the message_id its response returned, linked within a bind (src_ip, src_port) on the nearest following response. Exists because the sender/destination live on the request while the message_id lives on the response, so a DLR cannot reach the sender in a single join.';

-- ---------------------------------------------------------------------------------------------
-- v_smpp_delivery — DLR receipts joined to their originating submit (R4, R5)
-- ---------------------------------------------------------------------------------------------
-- A deliver-sm carrying a receipt names the submit it reports on via receipted_message_id, which
-- matches the message_id the SMSC assigned. That key is unique per message (no duplicate
-- message_id among responses, so the join cannot fan out), unlike sequence_number, which is reused
-- within the hour.
--
-- The join is LEFT so a receipt whose submit fell outside the loaded window is still counted as a
-- delivery outcome rather than silently dropped; `submit_time IS NULL` identifies those. Measured
-- 2026-08-13: 13,595 of 16,920 receipts (80.3%) match a submit in the loaded window.
CREATE OR REPLACE VIEW zamani.v_smpp_delivery AS
SELECT
    dlr.business_date,
    date_trunc('hour', dlr.event_time AT TIME ZONE 'UTC') AS bucket_hour,
    dlr.event_time                                        AS receipt_time,
    dlr.receipted_message_id,
    dlr.dlr_stat,
    dlr.dlr_err,
    dlr.network_error_code,
    sub.event_time                                        AS submit_time,
    sub.sender_id                                         AS submit_sender_id,
    sub.dest_addr                                         AS submit_dest_addr,
    sub.traffic_source_name                               AS submit_traffic_source,
    CASE WHEN sub.event_time IS NOT NULL
         THEN EXTRACT(EPOCH FROM (dlr.event_time - sub.event_time))
    END                                                   AS delivery_seconds
FROM zamani.smpp dlr
LEFT JOIN zamani.v_smpp_submits sub
       ON sub.message_id = dlr.receipted_message_id
WHERE dlr.message_type = 'deliver-sm'
  AND dlr.dlr_stat IS NOT NULL;

COMMENT ON VIEW zamani.v_smpp_delivery IS
'DLR receipts (deliver-sm with dlr_stat) joined to the originating submit-sm via receipted_message_id = the message_id its response assigned — never on sequence_number, which is reused within the hour. LEFT join keeps receipts whose submit is outside the loaded window (submit_time IS NULL).';

-- ---------------------------------------------------------------------------------------------
-- v_traffic_hourly — unified hourly spine for the time-series panels (R1-R5)
-- ---------------------------------------------------------------------------------------------
-- One row per (bucket_hour, stream, direction, final_action). `messages` is the corrected count in
-- every stream: deduped for SS7, requests-only for SMPP, raw requests for SRI (one row IS one
-- lookup there). `raw_rows` keeps the uncorrected log-row count alongside, so the size of the
-- correction stays visible instead of being quietly absorbed.
--
-- subscribers_hr / senders_hr are DISTINCT COUNTS WITHIN THE HOUR and must never be summed across
-- hours. See the note at the top of this file.
CREATE OR REPLACE VIEW zamani.v_traffic_hourly AS
SELECT
    bucket_hour,
    business_date,
    'ss7'                          AS stream,
    COALESCE(direction, 'unknown') AS direction,
    COALESCE(final_action, 'unknown') AS final_action,
    COUNT(*)                       AS messages,
    SUM(parts)                     AS raw_rows,
    COUNT(DISTINCT imsi)           AS subscribers_hr,
    COUNT(DISTINCT sender_id)      AS senders_hr,
    COUNT(*) FILTER (WHERE is_multipart) AS multipart_messages
FROM zamani.v_ss7_messages
GROUP BY bucket_hour, business_date, 3, 4, 5

UNION ALL

SELECT
    bucket_hour,
    business_date,
    'smpp'                         AS stream,
    COALESCE(direction, 'unknown') AS direction,
    COALESCE(final_action, 'unknown') AS final_action,
    COUNT(*)                       AS messages,
    COUNT(*)                       AS raw_rows,
    COUNT(DISTINCT dest_addr)      AS subscribers_hr,
    COUNT(DISTINCT sender_id)      AS senders_hr,
    0                              AS multipart_messages
FROM zamani.v_smpp_messages
GROUP BY bucket_hour, business_date, 3, 4, 5

UNION ALL

SELECT
    date_trunc('hour', event_time AT TIME ZONE 'UTC') AS bucket_hour,
    business_date,
    'sri'                          AS stream,
    'MT'                           AS direction,
    'lookup'                       AS final_action,
    COUNT(*)                       AS messages,
    COUNT(*)                       AS raw_rows,
    COUNT(DISTINCT dest_address)   AS subscribers_hr,
    COUNT(DISTINCT smsc)           AS senders_hr,
    0                              AS multipart_messages
FROM zamani.sri_req
GROUP BY 1, 2, 3, 4, 5;

COMMENT ON VIEW zamani.v_traffic_hourly IS
'Unified hourly rollup: one row per (bucket_hour, stream, direction, final_action). messages is corrected per stream (SS7 deduped, SMPP requests-only, SRI raw); raw_rows keeps the uncorrected count for comparison. subscribers_hr/senders_hr are per-hour distincts and are NOT summable across hours.';

-- ---------------------------------------------------------------------------------------------
-- v_ss7_daily — exact per-day unique subscribers (the additivity escape hatch)
-- ---------------------------------------------------------------------------------------------
-- Exists because COUNT(DISTINCT) cannot be rolled up from v_traffic_hourly. A full-day distinct
-- over ~11M rows costs ~87s on the source, so this is intended for a once-a-day refresh of closed
-- days, never for an interactive read.
CREATE OR REPLACE VIEW zamani.v_ss7_daily AS
SELECT
    business_date,
    COUNT(*)                  AS messages,
    SUM(parts)                AS raw_rows,
    COUNT(DISTINCT imsi)      AS subscribers,
    COUNT(DISTINCT sender_id) AS senders
FROM zamani.v_ss7_messages
GROUP BY business_date;

COMMENT ON VIEW zamani.v_ss7_daily IS
'Exact per-UTC-day SS7 unique subscribers and senders. Expensive (~87s/day on 11M rows) because COUNT(DISTINCT) is not derivable from the hourly rollup — refresh once per day for closed days.';

-- ---------------------------------------------------------------------------------------------
-- v_pipeline_health — load_log shaped for monitoring
-- ---------------------------------------------------------------------------------------------
-- Every stream is delivered as one gzipped file per node per hour, named
-- `<stream>.log.celzamani-mp<N>.<YYYY-MM-DD-HH>.gz`. Coverage must be keyed on the hour the traffic
-- belongs to, not on when the load ran, because a backfill ingests many hours at once.
--
-- R6  THE HOUR IN THE FILE NAME IS NOT USABLE as that key, for two independent reasons — both
--     measured, not assumed:
--       a) It is a 12-HOUR clock with no AM/PM. Across every file ever loaded, the hour token takes
--          only the values 01-12 — never 00, never 13-23 — so `...-05.gz` is ambiguous between
--          05:00 and 17:00, and midnight appears as 12.
--       b) It is the ROTATION hour, one ahead of the traffic hour: `...2026-08-13-07.gz` carries
--          06:00-06:59 traffic.
--     `file_mtime` has neither problem: it is a timestamptz, it exists for files that FAILED to
--     parse (the loader stats the file before reading it), and it sits a fixed interval after the
--     hour it covers. Verified 2026-08-13 by comparing each loaded file's anchor against the modal
--     hour of the rows it actually produced: 69/69 ss7 files, 76/76 sri_req, 38/39 smpp.
--
--     To re-verify after any change to the delivery pipeline, compare
--     date_trunc('hour', file_mtime) - MTIME_LAG against the modal hour of each file's rows; if the
--     lag has moved, this one interval is the only thing to change.
--
-- Retries mean the same source_file can appear more than once; a file is counted as loaded if it
-- has any successful attempt (load_log carries a unique index on source_file WHERE
-- status = 'success').
CREATE OR REPLACE VIEW zamani.v_pipeline_health AS
SELECT
    id,
    stream,
    source_file,
    status,
    rows_loaded,
    rows_rejected,
    file_size,
    file_mtime,
    started_at,
    finished_at,
    duration_ms,
    error_message,
    -- celzamani-mp3 -> mp3
    substring(source_file FROM 'celzamani-(mp[0-9]+)')                       AS node,
    -- The traffic hour, anchored on file_mtime rather than the file name (see R6). Rendered as a
    -- naive timestamp explicitly in UTC so the value does not shift with the reader's session.
    (date_trunc('hour', file_mtime AT TIME ZONE 'UTC') - INTERVAL '2 hours')  AS file_hour,
    (status = 'success')                                                     AS is_loaded
FROM zamani.load_log;

COMMENT ON VIEW zamani.v_pipeline_health IS
'load_log with node parsed from source_file and the traffic hour anchored on file_mtime - 2h. The hour token in the file name is deliberately NOT used: it is a 12-hour clock with no AM/PM (only 01-12 ever appear) and it names the rotation hour, one ahead of the traffic hour. file_hour is a naive timestamp denominated in UTC.';

-- ---------------------------------------------------------------------------------------------
-- v_pipeline_hourly — per (stream, traffic hour) ingest coverage and gaps
-- ---------------------------------------------------------------------------------------------
-- Collapses retries to one row per file, then rolls up to the hour so the dashboard can show
-- "this hour is complete / partial / missing" without reasoning about attempt history.
CREATE OR REPLACE VIEW zamani.v_pipeline_hourly AS
WITH per_file AS (
    SELECT
        stream,
        file_hour,
        source_file,
        MAX(node)                                       AS node,
        BOOL_OR(is_loaded)                              AS loaded,
        SUM(rows_loaded)  FILTER (WHERE is_loaded)      AS rows_loaded,
        SUM(rows_rejected) FILTER (WHERE is_loaded)     AS rows_rejected,
        COUNT(*)                                        AS attempts,
        MAX(started_at)                                 AS last_attempt_at,
        (ARRAY_REMOVE(ARRAY_AGG(error_message ORDER BY started_at DESC), NULL))[1] AS last_error
    FROM zamani.v_pipeline_health
    WHERE file_hour IS NOT NULL
    GROUP BY stream, file_hour, source_file
)
SELECT
    stream,
    file_hour,
    COUNT(*)                                        AS files_seen,
    COUNT(*) FILTER (WHERE loaded)                  AS files_loaded,
    COUNT(*) FILTER (WHERE NOT loaded)              AS files_failed,
    COUNT(DISTINCT node)                            AS nodes_seen,
    COALESCE(SUM(rows_loaded), 0)                   AS rows_loaded,
    COALESCE(SUM(rows_rejected), 0)                 AS rows_rejected,
    SUM(attempts)                                   AS attempts,
    MAX(last_attempt_at)                            AS last_attempt_at,
    (ARRAY_REMOVE(ARRAY_AGG(last_error), NULL))[1]  AS last_error,
    CASE
        WHEN COUNT(*) FILTER (WHERE NOT loaded) = 0 THEN 'complete'
        WHEN COUNT(*) FILTER (WHERE loaded)     = 0 THEN 'missing'
        ELSE 'partial'
    END                                             AS hour_status
FROM per_file
GROUP BY stream, file_hour;

COMMENT ON VIEW zamani.v_pipeline_hourly IS
'Per (stream, traffic hour) ingest coverage with retries collapsed to one row per file: files seen/loaded/failed, nodes seen, rows loaded, and a complete/partial/missing status per hour.';

-- =============================================================================================
-- Firewall Effectiveness (page 2)
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- v_ss7_message_tags — firewall tags per LOGICAL message, not per segment
-- ---------------------------------------------------------------------------------------------
-- Tags live on every segment of a multipart message, so unnesting the base table would weight a
-- 47-part SMS 47 times and make "which rules fire" partly a function of message length. Tags are
-- taken from the message's first available segment; they are effectively invariant within a group
-- (verified 2026-08-13: 1,395 of 694,267 groups carried more than one distinct tag set = 0.2%, and
-- content_tags never varied), so the representative is faithful rather than arbitrary.
--
-- The CASE around ROW_NUMBER matters: single-part rows have concat_ref IS NULL, and partitioning on
-- a NULL concat_ref would lump every single-part message of one subscriber into a single group and
-- keep only one of them.
CREATE OR REPLACE VIEW zamani.v_ss7_message_tags AS
SELECT business_date, bucket_hour, imsi, sender_id, final_action, calling_party, tags
FROM (
    SELECT
        business_date,
        date_trunc('hour', event_time AT TIME ZONE 'UTC') AS bucket_hour,
        imsi, sender_id, final_action, calling_party, tags,
        CASE WHEN concat_ref IS NULL THEN 1
             ELSE ROW_NUMBER() OVER (
                PARTITION BY business_date,
                             date_trunc('hour', event_time AT TIME ZONE 'UTC'),
                             imsi, concat_ref
                ORDER BY concat_seq)
        END AS pick
    FROM zamani.ss7
) x
WHERE pick = 1;

COMMENT ON VIEW zamani.v_ss7_message_tags IS
'One row per logical SS7 message carrying that message tag set, taken from its first segment, so multipart messages are not counted once per segment in tag frequencies.';

-- ---------------------------------------------------------------------------------------------
-- v_firewall_tags_hourly — which rules fire, per hour and stream
-- ---------------------------------------------------------------------------------------------
-- Counts are MESSAGES carrying the tag, on the same corrected basis as v_traffic_hourly, so a tag
-- count and a volume figure for the same hour are directly comparable. A message carries several
-- tags, so tag counts intentionally sum to MORE than the message total — they are not a partition
-- of traffic and must never be rendered as a share-of-total pie.
CREATE OR REPLACE VIEW zamani.v_firewall_tags_hourly AS
SELECT
    bucket_hour,
    business_date,
    'ss7'                     AS stream,
    tag,
    COUNT(*)                  AS messages,
    COUNT(DISTINCT sender_id) AS senders,
    COUNT(DISTINCT imsi)      AS subscribers,
    COUNT(*) FILTER (WHERE final_action <> 'send') AS intervened
FROM zamani.v_ss7_message_tags, unnest(tags) AS tag
GROUP BY 1, 2, 3, 4

UNION ALL

SELECT
    bucket_hour,
    business_date,
    'smpp'                    AS stream,
    tag,
    COUNT(*)                  AS messages,
    COUNT(DISTINCT sender_id) AS senders,
    COUNT(DISTINCT dest_addr) AS subscribers,
    COUNT(*) FILTER (WHERE final_action <> 'send') AS intervened
FROM zamani.v_smpp_messages, unnest(tags) AS tag
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW zamani.v_firewall_tags_hourly IS
'Firewall tag frequency per (hour, stream, tag) counted in corrected MESSAGES. A message carries multiple tags, so these counts deliberately exceed the message total and are not a partition of traffic.';

-- ---------------------------------------------------------------------------------------------
-- v_firewall_tag_senders_hourly — the same, broken down by sender
-- ---------------------------------------------------------------------------------------------
-- For "blocked traffic by reason and sender" and the grey-route watch, both of which have to name
-- the sender behind a rule hit. Restricted to the tag families those panels use and capped per
-- (hour, stream, tag), because the full tag x sender space is unbounded (~319k senders).
-- via_smscs is the grey-route signal: international A2P arriving through more than one local SMSC
-- global title is the shape of a grey route.
CREATE OR REPLACE VIEW zamani.v_firewall_tag_senders_hourly AS
WITH tagged AS (
    SELECT bucket_hour, business_date, 'ss7' AS stream, tag, sender_id, calling_party, final_action
    FROM zamani.v_ss7_message_tags, unnest(tags) AS tag
    WHERE sender_id IS NOT NULL
    UNION ALL
    SELECT bucket_hour, business_date, 'smpp', tag, sender_id, NULL, final_action
    FROM zamani.v_smpp_messages, unnest(tags) AS tag
    WHERE sender_id IS NOT NULL
), agg AS (
    SELECT bucket_hour, business_date, stream, tag, sender_id,
           COUNT(*) AS messages,
           COUNT(*) FILTER (WHERE final_action <> 'send') AS intervened,
           COUNT(DISTINCT calling_party) AS via_smscs,
           ROW_NUMBER() OVER (PARTITION BY bucket_hour, stream, tag ORDER BY COUNT(*) DESC) AS rn
    FROM tagged
    WHERE tag LIKE 'dropped_%' OR tag IN ('int_a2p', 'local_a2p', 'p2p_traffic', 'whitelist_sender')
    GROUP BY 1, 2, 3, 4, 5
)
SELECT bucket_hour, business_date, stream, tag, sender_id, messages, intervened, via_smscs
FROM agg WHERE rn <= 25;

COMMENT ON VIEW zamani.v_firewall_tag_senders_hourly IS
'Top 25 senders per (hour, stream, tag) for the blocked (dropped_*) and A2P-classification tag families only. Feeds blocked-by-sender and the grey-route watch; via_smscs counts distinct SMSC global titles a sender arrived through.';

-- =============================================================================================
-- Delivery Quality (page 3, SMPP only — SS7 stores no status report)
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- v_smpp_dlr_hourly — delivery outcomes and error codes per hour
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW zamani.v_smpp_dlr_hourly AS
SELECT
    bucket_hour,
    business_date,
    dlr_stat,
    COALESCE(dlr_err, '-')            AS dlr_err,
    COALESCE(network_error_code, '-') AS network_error_code,
    COUNT(*)                          AS receipts,
    COUNT(*) FILTER (WHERE submit_time IS NULL) AS orphan_receipts
FROM zamani.v_smpp_delivery
GROUP BY 1, 2, 3, 4, 5;

COMMENT ON VIEW zamani.v_smpp_dlr_hourly IS
'SMPP delivery receipts per (hour, dlr_stat, dlr_err, network_error_code). orphan_receipts counts receipts whose originating submit falls outside the loaded window — still real outcomes, so they are kept rather than dropped.';

-- ---------------------------------------------------------------------------------------------
-- v_smpp_dlr_senders_hourly — delivery outcome per sender, for worst-first ranking
-- ---------------------------------------------------------------------------------------------
-- Keyed on the sender of the ORIGINAL submit, so a receipt is attributed to whoever sent the
-- message rather than to the receipt's own network-side sender. Receipts with no matching submit
-- land under (unmatched) instead of silently leaving the denominator.
CREATE OR REPLACE VIEW zamani.v_smpp_dlr_senders_hourly AS
SELECT
    bucket_hour,
    business_date,
    COALESCE(submit_sender_id, '(unmatched)') AS sender_id,
    dlr_stat,
    COUNT(*)                                 AS receipts,
    COUNT(DISTINCT submit_dest_addr)          AS destinations
FROM zamani.v_smpp_delivery
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW zamani.v_smpp_dlr_senders_hourly IS
'Delivery receipts per (hour, originating sender, dlr_stat), attributed to the submitting sender via the receipted_message_id join. Receipts with no matching submit are grouped as (unmatched) so they stay in the denominator.';

-- ---------------------------------------------------------------------------------------------
-- v_smpp_latency_hourly — submit/deliver round-trip, paired WITHIN A BIND (R4)
-- ---------------------------------------------------------------------------------------------
-- sequence_number is reused within the hour, so pairing on it alone is meaningless: over
-- 2026-08-13 that yields 4,060 pairs with a 24-MINUTE mean and a 6-hour maximum, while its median
-- still looks fine at 75ms. Pairing within (src_ip, src_port) and taking the NEAREST FOLLOWING
-- response gives 2,938 pairs, p50 62ms, p95 112ms, p99 136ms, max 178ms.
--
-- No mean is exposed. A mean is precisely the statistic that hid the mispairing, so publishing one
-- here would re-open the trap this view exists to close.
CREATE OR REPLACE VIEW zamani.v_smpp_latency_hourly AS
WITH ev AS (
    SELECT src_ip, src_port, sequence_number, event_time, business_date,
           CASE WHEN message_type IN ('submit-sm', 'submit-sm-response') THEN 'submit' ELSE 'deliver' END AS pdu_kind,
           (message_type LIKE '%-response') AS is_response
    FROM zamani.smpp
    WHERE message_type IN ('submit-sm', 'submit-sm-response', 'deliver-sm', 'deliver-sm-response')
      AND src_ip IS NOT NULL AND src_port IS NOT NULL
), paired AS (
    SELECT
        business_date, pdu_kind, event_time, is_response,
        MIN(CASE WHEN is_response THEN event_time END) OVER (
            PARTITION BY src_ip, src_port, sequence_number, pdu_kind
            ORDER BY event_time
            ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
        ) AS resp_time
    FROM ev
)
SELECT
    date_trunc('hour', event_time AT TIME ZONE 'UTC') AS bucket_hour,
    business_date,
    pdu_kind,
    COUNT(*)                                                              AS pairs,
    ROUND((PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY ms))::numeric, 1) AS p50_ms,
    ROUND((PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ms))::numeric, 1) AS p95_ms,
    ROUND((PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ms))::numeric, 1) AS p99_ms,
    ROUND(MAX(ms)::numeric, 1)                                            AS max_ms
FROM (
    SELECT business_date, pdu_kind, event_time,
           EXTRACT(EPOCH FROM (resp_time - event_time)) * 1000 AS ms
    FROM paired
    WHERE NOT is_response AND resp_time IS NOT NULL
) x
GROUP BY 1, 2, 3;

COMMENT ON VIEW zamani.v_smpp_latency_hourly IS
'Request->response latency per (hour, pdu_kind), paired within a bind (src_ip, src_port) on the nearest following response — never on sequence_number alone, which is reused within the hour and produces a 24-minute mean. Percentiles only; no mean is exposed by design.';

-- =============================================================================================
-- Network & SRI Integrity (page 4)
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- v_sri_hourly — SRI-for-SM request rate and the enumeration detector
-- ---------------------------------------------------------------------------------------------
-- requests_per_msisdn is the probing signal: near 1.0 means roughly one lookup per message, while
-- a sustained rise means the same numbers are being queried repeatedly. Measured 2026-08-13 it
-- climbed from 1.15 to 2.66 across the day, so this is a live signal rather than a hypothetical.
-- requests_per_sec averages over the whole hour and therefore understates short bursts.
CREATE OR REPLACE VIEW zamani.v_sri_hourly AS
SELECT
    date_trunc('hour', event_time AT TIME ZONE 'UTC') AS bucket_hour,
    business_date,
    COUNT(*)                                                              AS requests,
    COUNT(DISTINCT dest_address)                                          AS msisdns,
    ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT dest_address), 0), 3) AS requests_per_msisdn,
    COUNT(DISTINCT smsc)                                                  AS smscs,
    COUNT(DISTINCT calling_party)                                         AS callers,
    ROUND(COUNT(*)::numeric / 3600, 2)                                    AS requests_per_sec
FROM zamani.sri_req
GROUP BY 1, 2;

COMMENT ON VIEW zamani.v_sri_hourly IS
'SRI-for-SM volume per hour with the enumeration detector: requests_per_msisdn near 1.0 is healthy, a sustained rise indicates repeated probing. requests_per_sec is averaged over the full hour and understates bursts.';

-- ---------------------------------------------------------------------------------------------
-- v_sri_smsc_hourly — which node is doing the querying
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW zamani.v_sri_smsc_hourly AS
SELECT
    date_trunc('hour', event_time AT TIME ZONE 'UTC') AS bucket_hour,
    business_date,
    COALESCE(smsc, '(none)')          AS smsc,
    COALESCE(calling_party, '(none)') AS calling_party,
    COUNT(*)                          AS requests,
    COUNT(DISTINCT dest_address)      AS msisdns,
    ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT dest_address), 0), 3) AS requests_per_msisdn
FROM zamani.sri_req
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW zamani.v_sri_smsc_hourly IS
'SRI requests per (hour, SMSC, calling party) with distinct MSISDNs queried — isolates which querying node is responsible for a rise in the probing ratio.';

-- ---------------------------------------------------------------------------------------------
-- v_ss7_routing_hourly — interconnect view: OPC/DPC pairs and traffic sources
-- ---------------------------------------------------------------------------------------------
-- Counted on deduped messages so routing volumes reconcile with the traffic page. This is the one
-- place calling_party is legitimately meaningful (R1) — as an interconnect identity, never as the
-- sender.
CREATE OR REPLACE VIEW zamani.v_ss7_routing_hourly AS
SELECT
    bucket_hour,
    business_date,
    COALESCE(traffic_source_name, '(none)') AS traffic_source_name,
    opc,
    dpc,
    COALESCE(calling_party, '(none)')       AS calling_party,
    COUNT(*)                                AS messages,
    SUM(parts)                              AS raw_rows,
    COUNT(DISTINCT imsi)                    AS subscribers,
    COUNT(*) FILTER (WHERE final_action <> 'send') AS intervened
FROM (
    SELECT
        business_date,
        date_trunc('hour', event_time AT TIME ZONE 'UTC') AS bucket_hour,
        traffic_source_name, opc, dpc, calling_party, imsi, final_action,
        CASE WHEN concat_ref IS NULL THEN 1
             ELSE ROW_NUMBER() OVER (
                PARTITION BY business_date,
                             date_trunc('hour', event_time AT TIME ZONE 'UTC'),
                             imsi, concat_ref
                ORDER BY concat_seq)
        END AS pick,
        CASE WHEN concat_ref IS NULL THEN 1
             ELSE COUNT(*) OVER (
                PARTITION BY business_date,
                             date_trunc('hour', event_time AT TIME ZONE 'UTC'),
                             imsi, concat_ref)
        END AS parts
    FROM zamani.ss7
) x
WHERE pick = 1
GROUP BY 1, 2, 3, 4, 5, 6;

COMMENT ON VIEW zamani.v_ss7_routing_hourly IS
'SS7 interconnect volumes per (hour, traffic source, OPC, DPC, calling party) on deduped messages. Reconciles exactly with v_traffic_hourly for the same hour when both are read at the same moment; while the source is still backfilling, two stage tables refreshed minutes apart can hold the same historical hour at different completeness. calling_party is used here as the interconnect identity it actually is.';

-- ---------------------------------------------------------------------------------------------
-- v_smpp_content_defects_hourly — content-encoding defect rate (page 5)
-- ---------------------------------------------------------------------------------------------
-- Double encoding at source: content declared as data_coding 3 (Latin-1) that actually carries
-- UTF-8 bytes, so the bytes read back as mojibake ('Ã©' where 'é' was meant). Detected on the
-- tell-tale lead bytes rather than by attempting a re-decode, which Postgres cannot do on text
-- that has already been stored as valid UTF-8.
--
-- Measured 2026-08-13 over 33,396 SMPP requests: 3,297 affected = 9.9% overall, and the damage is
-- entirely inside data_coding 3 (3,297 of 20,588 = 16.0%). data_coding 0 (GSM 7-bit) and 8 (UCS2)
-- are clean, which is what identifies this as a per-encoding source bug and not a transport fault.
-- The figure is reported per data_coding for exactly that reason — an overall rate alone moves with
-- the encoding mix and hides whether the underlying bug got better or worse.
CREATE OR REPLACE VIEW zamani.v_smpp_content_defects_hourly AS
SELECT
    date_trunc('hour', event_time AT TIME ZONE 'UTC') AS bucket_hour,
    business_date,
    COALESCE(data_coding, -1)                        AS data_coding,
    COUNT(*)                                         AS messages,
    COUNT(*) FILTER (WHERE message_content IS NULL)  AS null_content,
    COUNT(*) FILTER (WHERE message_content ~ '(Ã|Â|â)') AS mojibake,
    ROUND(100.0 * COUNT(*) FILTER (WHERE message_content ~ '(Ã|Â|â)')
          / NULLIF(COUNT(*), 0), 2)                  AS mojibake_pct
FROM zamani.smpp
WHERE message_type IN ('submit-sm', 'deliver-sm')
GROUP BY 1, 2, 3;

COMMENT ON VIEW zamani.v_smpp_content_defects_hourly IS
'Content-encoding defect rate per (hour, data_coding): messages whose stored text shows UTF-8-read-as-Latin-1 mojibake, i.e. double-encoded at source. Broken out per data_coding because an overall rate moves with the encoding mix and would mask whether the source bug itself changed.';
