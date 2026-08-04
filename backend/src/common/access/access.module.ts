import { Global, Module } from '@nestjs/common';
import { AccessResolverService } from './access-resolver.service';
import { AccessSeedService } from './access-seed.service';
import { ReportsRegistryModule } from '../../admin/reports/reports-registry.module';

/**
 * Global provider of the central access resolver (and the boot-time access seeder), so any
 * guard/service can inject AccessResolverService without a module import.
 */
@Global()
@Module({
  imports: [ReportsRegistryModule],
  providers: [AccessResolverService, AccessSeedService],
  exports: [AccessResolverService],
})
export class AccessModule {}
