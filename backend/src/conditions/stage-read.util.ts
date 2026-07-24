// Datasets whose stage table keeps MULTIPLE time buckets of rows (the hourly rollup of SRC/DST
// Number Monitoring) must be evaluated by conditions on the LATEST stored bucket only — otherwise an
// alert would fire once per number per bucket (inflated matchedCount, duplicate notification rows).
// Normal single-snapshot stage tables are read in full, exactly as before.
const LATEST_BUCKET_ONLY_TABLES = new Set<string>(['ds_src_dst_number_monitoring']);

/**
 * SQL that reads the rows a condition should evaluate for a stage table.
 * - Normal tables: `SELECT * FROM <table> <suffix>` (unchanged behaviour).
 * - Bucketed rollup tables: restricted to the latest stored hour via `WHERE bucket = (SELECT max…)`.
 * `suffix` (e.g. 'ORDER BY id DESC') is appended verbatim. The table name is validated as a safe
 * SQL identifier before interpolation.
 */
export function stageConditionReadSql(table: string, suffix = ''): string {
  if (!/^[a-z_][a-z0-9_]{0,127}$/i.test(table)) {
    throw new Error(`Unsafe stage table name: ${table}`);
  }
  const where = LATEST_BUCKET_ONLY_TABLES.has(table)
    ? `WHERE bucket = (SELECT max(bucket) FROM ${table})`
    : '';
  return `SELECT * FROM ${table} ${where} ${suffix}`.replace(/\s+/g, ' ').trim();
}
