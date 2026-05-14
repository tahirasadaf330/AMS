import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminDatasourcesController } from './admin-datasources.controller';
import { AdminDatasourcesService } from './admin-datasources.service';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { AuditModule } from '../../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([ExternalDataSource]), AuditModule],
  controllers: [AdminDatasourcesController],
  providers: [AdminDatasourcesService],
  exports: [AdminDatasourcesService],
})
export class AdminDatasourcesModule {}
