import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Condition, ConditionRow } from '../common/entities/condition.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Dataset } from '../common/entities/dataset.entity';

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
    const matchedRows = this.filterRows(
      rows,
      condition.conditionRows || [],
      condition.logic,
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

  private evaluateRow(row: Record<string, unknown>, condition: ConditionRow): boolean {
    const rawValue = row[condition.column];
    const condValue = condition.value;

    if (rawValue === undefined || rawValue === null) {
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
   */
  previewCondition(
    conditionRows: ConditionRow[],
    logic: 'AND' | 'OR',
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    return this.filterRows(rows, conditionRows, logic);
  }
}
