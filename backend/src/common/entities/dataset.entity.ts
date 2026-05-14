import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('datasets')
export class Dataset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'source_db', type: 'varchar', length: 64, default: 'jerasoft' })
  sourceDb: string;

  @Column({ name: 'sql_query', type: 'text' })
  sqlQuery: string;

  @Column({ name: 'stage_table_name', type: 'varchar', length: 128, unique: true })
  stageTableName: string;

  @Column({ name: 'column_metadata', type: 'jsonb', nullable: true })
  columnMetadata: Record<string, unknown> | null;

  @Column({ name: 'schedule_cron', type: 'varchar', length: 128, default: '0 */6 * * *', nullable: true })
  scheduleCron: string | null;

  @Column({ name: 'schedule_start_date', type: 'timestamptz', nullable: true })
  scheduleStartDate: Date | null;

  @Column({ name: 'schedule_end_date', type: 'timestamptz', nullable: true })
  scheduleEndDate: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'data_source_id', type: 'uuid', nullable: true })
  dataSourceId: string | null;

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
