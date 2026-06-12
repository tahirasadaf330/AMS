import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { VcsBalanceService } from './vcs-balance.service';

@Controller('reports/vcs-balance')
@UseGuards(JwtAuthGuard)
export class VcsBalanceController {
  constructor(private readonly service: VcsBalanceService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }
}
