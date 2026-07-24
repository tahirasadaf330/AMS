import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { SrcDstNumberMonitoringService } from './src-dst-number-monitoring.service';

@Controller('reports/src-dst-number-monitoring')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('src-dst-number-monitoring', 'SRC/DST Number Monitoring')
export class SrcDstNumberMonitoringController {
  constructor(private readonly service: SrcDstNumberMonitoringService) {}

  // Fast read from the hourly rollup. kind = 'src'|'dst'; window = thishr|prevhr|4h|12h|1d|2d|3d|7d
  // (5G semantics: last N hourly buckets incl the current partial hour) or custom from/to dates
  // ('YYYY-MM-DD'); limit = display rows (10…10000). No live query — the 5-min scheduled gap-fill
  // keeps the rollup current.
  @Get('data')
  getData(
    @Query('kind') kind?: string,
    @Query('window') window?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getData(kind, window, from, to, limit != null ? Number(limit) : undefined);
  }
}
