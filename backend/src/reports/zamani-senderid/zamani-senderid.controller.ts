import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { ZamaniSenderIdService } from './zamani-senderid.service';

@Controller('reports/zamani-sender-id')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('zamani-sender-id', 'Zamani Sender ID', 'sms')
export class ZamaniSenderIdController {
  constructor(private readonly service: ZamaniSenderIdService) {}

  // from/to are ISO-8601 UTC instants (optional). Omitted → the whole retained ~48h window.
  @Get('data')
  getData(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('supplier') supplier?: string,
  ) {
    return this.service.getData(from, to, supplier);
  }

  // Line-chart series. dimension = customer|sender, granularity = hour|day|week|month, keys = JSON
  // array of the selected customer/sender values (empty → top series by volume).
  @Get('timeseries')
  getTimeseries(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('dimension') dimension?: string,
    @Query('granularity') granularity?: string,
    @Query('keys') keys?: string,
    @Query('filter') filter?: string,
    @Query('supplier') supplier?: string,
  ) {
    let keyList: string[] = [];
    if (keys) { try { const parsed = JSON.parse(keys); if (Array.isArray(parsed)) keyList = parsed.map(String); } catch { /* ignore */ } }
    const dim = dimension === 'sender' ? 'sender' : 'customer';
    const gran = (['hour', 'day', 'week', 'month'].includes(granularity ?? '') ? granularity : 'day') as 'hour' | 'day' | 'week' | 'month';
    return this.service.getTimeseries(from, to, dim, gran, keyList, filter, supplier);
  }

  // New / Lost senders between two date periods (Sales: "what traffic has been added?").
  @Get('new-senders')
  getNewSenders(
    @Query('old_start') old_start: string,
    @Query('old_end')   old_end:   string,
    @Query('new_start') new_start: string,
    @Query('new_end')   new_end:   string,
    @Query('supplier')  supplier?: string,
  ) {
    return this.service.getNewSenders({ old_start, old_end, new_start, new_end, supplier });
  }
}
