import { ConditionRow } from '../common/entities/condition.entity';

/**
 * Split a flat list of condition rows into its condition groups, ordered by group index.
 *
 * A row's optional `group` says which group it belongs to; rows without one are group 0, so a
 * legacy flat alert (no `group` on any row) comes back as exactly one group and evaluates as it
 * always has. Groups are OR'd at evaluation time: `(country == A AND city == A) OR
 * (country == B AND city == B)` is two groups of two rows each.
 */
export function splitConditionGroups(conditionRows: ConditionRow[] | null | undefined): ConditionRow[][] {
  if (!Array.isArray(conditionRows) || conditionRows.length === 0) return [];
  const byGroup = new Map<number, ConditionRow[]>();
  for (const row of conditionRows) {
    const g = Number.isInteger(row?.group) ? (row.group as number) : 0;
    let bucket = byGroup.get(g);
    if (!bucket) { bucket = []; byGroup.set(g, bucket); }
    bucket.push(row);
  }
  return [...byGroup.entries()].sort(([a], [b]) => a - b).map(([, rows]) => rows);
}
