import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Dataset } from './dataset.entity';
import { User } from './user.entity';

export interface ConditionRow {
  column: string;
  operator: string;
  value: string | number;
}

export interface ConditionChannels {
  email?: {
    enabled: boolean;
    recipients: string[];
    text?: string;
    columns?: string[];
  };
  teams?: {
    enabled: boolean;
    webhook_url?: string;
    severity?: 'critical' | 'warning' | 'info';
  };
}

@Entity('conditions')
export class Condition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'dataset' })
  type: 'dataset' | 'python';

  @Column({ name: 'python_script', type: 'text', nullable: true })
  pythonScript: string | null;

  @Column({ name: 'dataset_id', type: 'uuid', nullable: true })
  datasetId: string | null;

  @ManyToOne(() => Dataset, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'dataset_id' })
  dataset: Dataset | null;

  @Column({ type: 'varchar', length: 8, default: 'AND' })
  logic: 'AND' | 'OR';

  @Column({ name: 'condition_rows', type: 'jsonb', default: () => "'[]'" })
  conditionRows: ConditionRow[];

  @Column({ type: 'jsonb', default: () => "'{}'" })
  channels: ConditionChannels;

  @Column({ name: 'trigger_cron', type: 'varchar', length: 100, nullable: true })
  triggerCron: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'last_triggered_at', type: 'timestamptz', nullable: true })
  lastTriggeredAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdByUser: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
