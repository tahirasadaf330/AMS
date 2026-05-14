import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Condition } from './condition.entity';
import { Dataset } from './dataset.entity';

@Entity('notification_log')
@Index('idx_notif_log_time', ['triggeredAt'])
export class NotificationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'condition_id', type: 'uuid', nullable: true })
  conditionId: string | null;

  @ManyToOne(() => Condition, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'condition_id' })
  condition: Condition | null;

  @Column({ name: 'dataset_id', type: 'uuid', nullable: true })
  datasetId: string | null;

  @ManyToOne(() => Dataset, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'dataset_id' })
  dataset: Dataset | null;

  @Column({ type: 'varchar', length: 32 })
  channel: string;

  @Column({ type: 'jsonb', nullable: true })
  recipients: string[] | null;

  @Column({ name: 'webhook_url', type: 'text', nullable: true })
  webhookUrl: string | null;

  @Column({ name: 'matched_rows', type: 'jsonb', nullable: true })
  matchedRows: Record<string, unknown>[] | null;

  @Column({ name: 'matched_count', type: 'integer', nullable: true })
  matchedCount: number | null;

  @Column({ type: 'varchar', length: 32 })
  status: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number;

  @Column({ name: 'last_retry_at', type: 'timestamptz', nullable: true })
  lastRetryAt: Date | null;

  @Column({ name: 'triggered_at', type: 'timestamptz', default: () => 'NOW()' })
  triggeredAt: Date;
}
