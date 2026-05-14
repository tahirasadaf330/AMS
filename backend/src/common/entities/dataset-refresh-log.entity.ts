import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Dataset } from './dataset.entity';

@Entity('dataset_refresh_log')
@Index('idx_refresh_log', ['datasetId', 'startedAt'])
export class DatasetRefreshLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'dataset_id', type: 'uuid', nullable: true })
  datasetId: string | null;

  @ManyToOne(() => Dataset, { nullable: true })
  @JoinColumn({ name: 'dataset_id' })
  dataset: Dataset | null;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'NOW()' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'varchar', length: 32 })
  status: string;

  @Column({ name: 'row_count', type: 'integer', nullable: true })
  rowCount: number | null;

  @Column({ name: 'duration_ms', type: 'integer', nullable: true })
  durationMs: number | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
