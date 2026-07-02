import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReportsRegistryService } from './reports-registry.service';

@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ReportsRegistryController {
  constructor(private readonly registry: ReportsRegistryService) {}

  /** All reports available to grant per-user access to (auto-discovered). */
  @Get()
  list() {
    return this.registry.list();
  }
}
