import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExternalDataSource } from '../common/entities/data-source.entity';
import { DatasourceExecutorService } from './datasource-executor.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ExternalDataSource])],
  providers: [DatasourceExecutorService],
  exports: [DatasourceExecutorService],
})
export class ExternalDatasourcesModule {}
