import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ExternalDataSource, DataSourceType } from '../../common/entities/data-source.entity';
import { DatasourceExecutorService } from '../../datasources/datasource-executor.service';
import { CredentialsService } from '../../credentials/credentials.service';

export interface CreateDataSourceDto {
  name: string;
  type: DataSourceType;
  host: string;
  port: number;
  db: string;
  username: string;
  password?: string;
  sslMode?: string;
  isActive?: boolean;
}

export interface UpdateDataSourceDto extends Partial<CreateDataSourceDto> {}

export interface TestDataSourceDto {
  type: DataSourceType;
  host: string;
  port: number;
  db: string;
  username: string;
  password: string;
  sslMode?: string;
}

@Injectable()
export class AdminDatasourcesService {
  private readonly logger = new Logger(AdminDatasourcesService.name);

  constructor(
    @InjectRepository(ExternalDataSource)
    private dsRepo: Repository<ExternalDataSource>,
    private executor: DatasourceExecutorService,
    private credentialsService: CredentialsService,
    private config: ConfigService,
  ) {}

  private buildJerasoftEntry(): ExternalDataSource & { is_builtin: boolean } {
    return {
      id: 'jerasoft',
      name: 'Jerasoft',
      type: 'postgresql' as DataSourceType,
      host: this.config.get<string>('JERASOFT_HOST', ''),
      port: parseInt(this.config.get<string>('JERASOFT_PORT', '5432'), 10),
      db: this.config.get<string>('JERASOFT_DB', ''),
      username: this.config.get<string>('JERASOFT_USER', ''),
      password: '***',
      sslMode: this.config.get<string>('JERASOFT_SSL', 'prefer'),
      isActive: true,
      createdBy: null,
      createdAt: new Date(0),
      is_builtin: true,
    } as any;
  }

  async findAll(): Promise<(ExternalDataSource & { is_builtin?: boolean })[]> {
    const rows = await this.dsRepo.find({ order: { name: 'ASC' } });
    return [this.buildJerasoftEntry(), ...rows];
  }

  async findOne(id: string): Promise<ExternalDataSource> {
    const ds = await this.dsRepo.findOne({ where: { id } });
    if (!ds) throw new NotFoundException(`Data source ${id} not found`);
    return ds;
  }

  async create(dto: CreateDataSourceDto, createdBy: string): Promise<ExternalDataSource> {
    const existing = await this.dsRepo.findOne({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A data source with this name already exists');

    const encryptedPassword = dto.password
      ? this.credentialsService.encrypt(dto.password)
      : null;

    const ds = this.dsRepo.create({
      name: dto.name,
      type: dto.type,
      host: dto.host,
      port: dto.port,
      db: dto.db,
      username: dto.username,
      password: encryptedPassword,
      sslMode: dto.sslMode ?? 'prefer',
      isActive: dto.isActive ?? true,
      createdBy,
    });

    return this.dsRepo.save(ds);
  }

  async update(id: string, dto: UpdateDataSourceDto): Promise<ExternalDataSource> {
    const ds = await this.findOne(id);

    if (dto.name && dto.name !== ds.name) {
      const existing = await this.dsRepo.findOne({ where: { name: dto.name } });
      if (existing) throw new ConflictException('A data source with this name already exists');
    }

    const updates: Partial<ExternalDataSource> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.type !== undefined) updates.type = dto.type;
    if (dto.host !== undefined) updates.host = dto.host;
    if (dto.port !== undefined) updates.port = dto.port;
    if (dto.db !== undefined) updates.db = dto.db;
    if (dto.username !== undefined) updates.username = dto.username;
    if (dto.sslMode !== undefined) updates.sslMode = dto.sslMode;
    if (dto.isActive !== undefined) updates.isActive = dto.isActive;
    if (dto.password !== undefined && dto.password !== '***') {
      updates.password = this.credentialsService.encrypt(dto.password);
    }

    await this.dsRepo.update(id, updates);
    this.executor.invalidatePool(id);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    this.executor.invalidatePool(id);
    await this.dsRepo.delete(id);
  }

  async testConnection(dto: TestDataSourceDto): Promise<{ success: boolean; message: string }> {
    try {
      await this.executor.testConnectionConfig({
        type: dto.type,
        host: dto.host,
        port: dto.port,
        db: dto.db,
        username: dto.username,
        password: dto.password,
        sslMode: dto.sslMode ?? 'prefer',
      });
      return { success: true, message: 'Connection successful' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  }

  maskPassword(ds: ExternalDataSource): ExternalDataSource & { password: string } {
    return { ...ds, password: ds.password ? '***' : '' };
  }
}
