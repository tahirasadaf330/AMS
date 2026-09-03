import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { ZamaniFirewallService } from './zamani-firewall.service';

@Controller('reports/zamani-firewall')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('zamani-firewall', 'Zamani SMS Firewall', 'sms')
export class ZamaniFirewallController {
  constructor(private readonly service: ZamaniFirewallService) {}

  @Get('data')
  getData(@Query('hours') hours?: string) {
    const parsed = hours ? Number(hours) : 24;
    return this.service.getData(Number.isFinite(parsed) ? parsed : 24);
  }

  @Get('messages-tab')
  getMessagesTab(
    @Query('stream') stream?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (stream !== 'ss7' && stream !== 'smpp' && stream !== 'srism') {
      throw new BadRequestException('stream must be ss7, smpp or srism');
    }
    // An unparseable bound degrades to "unbounded" rather than a 500 — same posture as the rest of
    // the report, where a bad input never blanks the page.
    const iso = (v?: string) => {
      if (!v) return undefined;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    };
    return this.service.getMessagesTab(stream, iso(from), iso(to));
  }
}
