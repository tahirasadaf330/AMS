import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ReportsRegistryService } from './reports-registry.service';
import { ReportsRegistryController } from './reports-registry.controller';

@Module({
  imports: [DiscoveryModule],
  controllers: [ReportsRegistryController],
  providers: [ReportsRegistryService],
  exports: [ReportsRegistryService],
})
export class ReportsRegistryModule {}
