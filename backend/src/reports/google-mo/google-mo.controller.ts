import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { GoogleMoService } from './google-mo.service';

@Controller('reports/google-mo')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('google_mo', 'Google MO Traffic', 'sms')
export class GoogleMoController {
  constructor(private readonly service: GoogleMoService) {}

  @Get('filters')
  getFilters() {
    return this.service.getFilters();
  }

  @Get('data')
  getData(
    @Query('date_start') date_start?: string,
    @Query('date_end')   date_end?: string,
    @Query('mccmnc')     mccmnc?: string,
    @Query('country')    country?: string,
    @Query('operator')   operator?: string,
  ) {
    return this.service.getData({ date_start, date_end, mccmnc, country, operator });
  }

  @Get('comparison')
  getComparison(
    @Query('date_old') date_old?: string,
    @Query('date_new') date_new?: string,
    @Query('customer') customer?: string,
    @Query('countries') countries?: string,
    @Query('operators') operators?: string,
  ) {
    return this.service.getComparison({
      date_old,
      date_new,
      customer,
      countries: countries ? countries.split(',').filter(Boolean) : [],
      operators: operators ? operators.split(',').filter(Boolean) : [],
    });
  }

  @Get('profit-loss')
  getProfitLoss(
    @Query('mccmnc') mccmnc?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('countries') countries?: string,
    @Query('operators') operators?: string,
  ) {
    return this.service.getProfitLoss({
      mccmnc,
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined,
      countries: countries ? countries.split(',').filter(Boolean) : [],
      operators: operators ? operators.split(',').filter(Boolean) : [],
    });
  }

  @Get('yesterday')
  getYesterday(
    @Query('mccmnc')    mccmnc?: string,
    @Query('countries') countries?: string,
    @Query('operators') operators?: string,
  ) {
    return this.service.getYesterday({
      mccmnc,
      countries: countries ? countries.split(',').filter(Boolean) : [],
      operators: operators ? operators.split(',').filter(Boolean) : [],
    });
  }

  @Get('yesterday-iristel-filters')
  getYesterdayIristelFilters() {
    return this.service.getYesterdayIristelFilters();
  }

  @Get('yesterday-iristel')
  getYesterdayIristel(
    @Query('mccmnc')    mccmnc?: string,
    @Query('countries') countries?: string,
    @Query('operators') operators?: string,
  ) {
    return this.service.getYesterdayIristel({
      mccmnc,
      countries: countries ? countries.split(',').filter(Boolean) : [],
      operators: operators ? operators.split(',').filter(Boolean) : [],
    });
  }

  @Get('pl-years')
  getProfitLossYears() {
    return this.service.getProfitLossYears();
  }

  @Get('pl-months')
  getProfitLossMonths(@Query('year') year?: string) {
    return this.service.getProfitLossMonths(year ? Number(year) : undefined);
  }

  @Get('estimates')
  getEstimates(
    @Query('mccmnc')     mccmnc?: string,
    @Query('country')    country?: string,
    @Query('operator')   operator?: string,
  ) {
    return this.service.getEstimates({ mccmnc, country, operator });
  }

  // Per-country operating fees (USD) vs MO revenue — Cost vs Revenue tab.
  @Get('cost-vs-revenue')
  getCostVsRevenue() {
    return this.service.getCostVsRevenue();
  }
}
