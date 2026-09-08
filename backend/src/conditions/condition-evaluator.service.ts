import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionRow } from '../common/entities/condition.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Dataset } from '../common/entities/dataset.entity';
import { splitConditionGroups } from './condition-groups.util';

// ── Voice Live Traffic: group-level (aggregate) evaluation ───────────────────
// Voice conditions are evaluated at the (account, destination) GROUP level, not
// per row. Dimension clauses (account/destination/vendor) select which rows form
// each group; metric clauses are tested against the group's CALL-WEIGHTED
// aggregate — the same math as the report / dashboard-viewer footer. See
// filterVoiceGroups().
const VOICE_STAGE = 'ds_voice_live_traffic';
const VOICE_DIMENSIONS = new Set(['account', 'destination', 'vendor']);
const VOICE_METRICS = new Set(['attempts', 'acd', 'asr', 'failed_calls', 'volume', 'answered_calls']);

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

@Injectable()
export class ConditionEvaluatorService {
  private readonly logger = new Logger(ConditionEvaluatorService.name);

  constructor(
    @InjectRepository(Condition)
    private conditionRepo: Repository<Condition>,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Evaluate all active conditions for the given dataset against the provided rows.
   * Runs entirely in-memory — no SQL filtering. Never throws.
   */
  async evaluateForDataset(
    dataset: Dataset,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    try {
      const conditions = await this.conditionRepo.find({
        where: { datasetId: dataset.id, isActive: true },
      });

      for (const condition of conditions) {
        try {
          await this.evaluateCondition(condition, dataset, rows);
        } catch (err) {
          this.logger.error(
            `Error evaluating condition ${condition.id}: ${condition.name}`,
            err,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Error loading conditions for dataset ${dataset.id}`, err);
    }
  }

  private async evaluateCondition(
    condition: Condition,
    dataset: Dataset,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    const matchedRows = this.filterRowsForCondition(
      rows,
      condition.conditionRows || [],
      condition.logic,
      dataset.stageTableName,
    );

    if (matchedRows.length === 0) {
      return;
    }

    await this.conditionRepo.update(condition.id, { lastTriggeredAt: new Date() });

    // Dispatch notifications
    await this.notificationsService.dispatch({
      condition,
      datasetName: dataset.name,
      matchedRows,
      columnMeta: Array.isArray(dataset.columnMetadata) ? (dataset.columnMetadata as any[]) : undefined,
    });
  }

  /**
   * Top-level filter for one condition: evaluate each condition GROUP independently (with the
   * condition's AND/OR logic inside the group, and the Voice group-aggregate path where it
   * applies) and OR the groups together, so `(country == A AND city == A) OR (country == B AND
   * city == B)` alerts on both pairs. A flat alert (no `group` on any row) is a single group and
   * goes straight down the existing path. Matched rows keep the stage order and are never
   * duplicated even when several groups match the same row.
   */
  private filterRowsForCondition(
    rows: Record<string, unknown>[],
    conditionRows: ConditionRow[],
    logic: 'AND' | 'OR',
    stageTableName?: string,
  ): Record<string, unknown>[] {
    const groups = splitConditionGroups(conditionRows);
    if (groups.length <= 1) {
      return this.filterRowsForStage(rows, conditionRows, logic, stageTableName);
    }
    const matched = new Set<Record<string, unknown>>();
    for (const groupRows of groups) {
      for (const r of this.filterRowsForStage(rows, groupRows, logic, stageTableName)) {
        matched.add(r);
      }
    }
    return rows.filter((r) => matched.has(r));
  }

  private filterRows(
    rows: Record<string, unknown>[],
    conditionRows: ConditionRow[],
    logic: 'AND' | 'OR',
  ): Record<string, unknown>[] {
    if (!conditionRows || conditionRows.length === 0) {
      return rows;
    }

    return rows.filter((row) => {
      if (logic === 'AND') {
        return conditionRows.every((cr) => this.evaluateRow(row, cr));
      } else {
        return conditionRows.some((cr) => this.evaluateRow(row, cr));
      }
    });
  }

  /**
   * Dataset-aware row filter. Voice Live Traffic uses group-level aggregate
   * evaluation (see filterVoiceGroups); every other dataset uses per-row filtering.
   */
  private filterRowsForStage(
    rows: Record<string, unknown>[],
    conditionRows: ConditionRow[],
    logic: 'AND' | 'OR',
    stageTableName?: string,
  ): Record<string, unknown>[] {
    if (stageTableName === VOICE_STAGE) {
      const grouped = this.filterVoiceGroups(rows, conditionRows, logic);
      if (grouped !== null) return grouped;
    }
    return this.filterRows(rows, conditionRows, logic);
  }

  /**
   * Voice Live Traffic group evaluation. Returns every row of the (account,
   * destination) groups whose CALL-WEIGHTED aggregate satisfies the condition, or
   * `null` to signal "not applicable — fall back to per-row filtering".
   *
   * Applies only to AND logic over the known Voice columns. Dimension clauses
   * (account/destination/vendor) filter which rows belong to each group; metric
   * clauses (attempts/acd/asr/failed_calls/volume/answered_calls) are tested against
   * the group aggregate. On a match, every row of the group is returned so the
   * notification shows all vendors and the totals reflect the whole Account +
   * Destination — exactly what the dashboard-viewer footer shows.
   */
  private filterVoiceGroups(
    rows: Record<string, unknown>[],
    conditionRows: ConditionRow[],
    logic: 'AND' | 'OR',
  ): Record<string, unknown>[] | null {
    // OR aggregate semantics are ambiguous — only AND uses the group path.
    if (logic !== 'AND') return null;
    if (!conditionRows || conditionRows.length === 0) return null;
    // Every referenced column must be a known Voice dimension or metric, else fall
    // back to per-row so an unexpected column is never silently mis-aggregated.
    const known = (c: ConditionRow) =>
      VOICE_DIMENSIONS.has(c.column) || VOICE_METRICS.has(c.column);
    if (!conditionRows.every(known)) return null;

    const dimClauses = conditionRows.filter((c) => VOICE_DIMENSIONS.has(c.column));
    const metricClauses = conditionRows.filter((c) => VOICE_METRICS.has(c.column));

    // Phase 1 — dimension clauses select which rows are in play.
    const filtered = dimClauses.length
      ? rows.filter((r) => dimClauses.every((c) => this.evaluateRow(r, c)))
      : rows;

    // Phase 2 — group the surviving rows by (account, destination).
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const r of filtered) {
      const key = `${r.account ?? ''}${r.destination ?? ''}`;
      let g = groups.get(key);
      if (!g) { g = []; groups.set(key, g); }
      g.push(r);
    }

    // Phase 3 — a group matches when its weighted aggregate passes every metric
    // clause. Return all rows of matching groups (no metric clauses ⇒ every formed
    // group matches, i.e. a pure dimension alert).
    const matched: Record<string, unknown>[] = [];
    for (const groupRows of groups.values()) {
      const agg = this.aggregateVoiceGroup(groupRows);
      if (metricClauses.every((c) => this.evaluateRow(agg, c))) {
        matched.push(...groupRows);
      }
    }
    return matched;
  }

  /**
   * Call-weighted aggregate of one Voice group — identical math to the report /
   * dashboard-viewer footer and to buildAccountDestinationTotals(): sums for the
   * count columns, ACD = Σvolume/Σanswered, ASR = Σanswered/Σattempts × 100, each
   * rounded to 2 dp so the value TESTED is exactly the value SHOWN.
   */
  private aggregateVoiceGroup(rows: Record<string, unknown>[]): Record<string, unknown> {
    let attempts = 0, answered = 0, failed = 0, volume = 0;
    for (const r of rows) {
      attempts += toNum(r.attempts);
      answered += toNum(r.answered_calls);
      failed += toNum(r.failed_calls);
      volume += toNum(r.volume);
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    return {
      account: rows[0]?.account ?? null,
      destination: rows[0]?.destination ?? null,
      vendor: null,
      attempts,
      answered_calls: answered,
      failed_calls: failed,
      volume: round2(volume),
      acd: answered > 0 ? round2(volume / answered) : null,
      asr: attempts > 0 ? round2((answered / attempts) * 100) : null,
    };
  }

  private evaluateRow(row: Record<string, unknown>, condition: ConditionRow): boolean {
    const rawValue = row[condition.column];
    const condValue = condition.value;

    if (rawValue === undefined || rawValue === null) {
      // A NULL/absent value has no magnitude, so it NEVER satisfies a threshold comparison
      // (<, <=, >, >=) - standard SQL three-valued logic. Prevents false matches such as a
      // non-consuming company (days_to_reach_cl = NULL) matching `days_to_reach_cl <= 10`, or a
      // route with no history matching `asr_change <= -10`. Only `!=` matches a null value.
      return condition.operator === '!=';
    }

    const strRaw = String(rawValue);
    const strCond = String(condValue);
    const numRaw = parseFloat(strRaw);
    const numCond = parseFloat(strCond);

    switch (condition.operator) {
      case '>':
        return !isNaN(numRaw) && !isNaN(numCond) && numRaw > numCond;
      case '<':
        return !isNaN(numRaw) && !isNaN(numCond) && numRaw < numCond;
      case '>=':
        return !isNaN(numRaw) && !isNaN(numCond) && numRaw >= numCond;
      case '<=':
        return !isNaN(numRaw) && !isNaN(numCond) && numRaw <= numCond;
      case '==':
        if (!isNaN(numRaw) && !isNaN(numCond)) return numRaw === numCond;
        return strRaw.toLowerCase() === strCond.toLowerCase();
      case '!=':
        if (!isNaN(numRaw) && !isNaN(numCond)) return numRaw !== numCond;
        return strRaw.toLowerCase() !== strCond.toLowerCase();
      case 'contains':
        return strRaw.toLowerCase().includes(strCond.toLowerCase());
      case 'starts_with':
        return strRaw.toLowerCase().startsWith(strCond.toLowerCase());
      case 'ends_with':
        return strRaw.toLowerCase().endsWith(strCond.toLowerCase());
      default:
        this.logger.warn(`Unknown operator: ${condition.operator}`);
        return false;
    }
  }

  /**
   * Preview which rows would match for a condition (no notifications dispatched).
   * Pass `stageTableName` so Voice Live Traffic uses group-level evaluation. Condition groups
   * are honoured exactly as in the scheduled run (see filterRowsForCondition).
   */
  previewCondition(
    conditionRows: ConditionRow[],
    logic: 'AND' | 'OR',
    rows: Record<string, unknown>[],
    stageTableName?: string,
  ): Record<string, unknown>[] {
    return this.filterRowsForCondition(rows, conditionRows, logic, stageTableName);
  }
}
