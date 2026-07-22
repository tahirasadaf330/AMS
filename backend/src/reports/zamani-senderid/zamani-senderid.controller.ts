import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { ZamaniSenderIdService } from './zamani-senderid.service';

@Controller('reports/zamani-sender-id')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('zamani-sender-id', 'Zamani Sender ID')
export class ZamaniSenderIdController {
  constructor(private readonly service: ZamaniSenderIdService) {}

  // from/to are ISO-8601 UTC instants (optional). Omitted → the whole retained ~48h window.
  @Get('data')
  getData(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getData(from, to);
  }
}
