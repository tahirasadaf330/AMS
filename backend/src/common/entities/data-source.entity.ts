import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type DataSourceType = 'postgresql' | 'mssql';

@Entity('data_sources')
export class ExternalDataSource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 128, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  type: DataSourceType;

  @Column({ type: 'varchar', length: 255 })
  host: string;

  @Column({ type: 'integer' })
  port: number;

  @Column({ type: 'varchar', length: 128 })
  db: string;

  @Column({ type: 'varchar', length: 128 })
  username: string;

  @Column({ type: 'text', nullable: true })
  password: string | null;

  @Column({ name: 'ssl_mode', type: 'varchar', length: 32, default: 'prefer' })
  sslMode: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
