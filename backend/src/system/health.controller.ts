import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JerasoftService } from '../datasources/jerasoft/jerasoft.service';
import { GraphEmailService } from '../notifications/graph-email.service';

@Controller('system')
export class HealthController {
  constructor(
    @InjectDataSource()
    private dataSource: DataSource,
    private jerasoftService: JerasoftService,
    private graphEmailService: GraphEmailService,
  ) {}

  @Get('health')
  async checkHealth() {
    const checks = await Promise.allSettled([
      this.checkAmsDb(),
      this.jerasoftService.testConnection(),
    ]);

    const amsDbOk = checks[0].status === 'fulfilled' && checks[0].value;
    const jerasoftOk = checks[1].status === 'fulfilled' && checks[1].value;
    const graphTokenValid = this.graphEmailService.isTokenValid();

    const healthy = amsDbOk && jerasoftOk;

    return {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        ams_database: amsDbOk ? 'ok' : 'error',
        jerasoft_database: jerasoftOk ? 'ok' : 'error',
        graph_token: graphTokenValid ? 'valid' : 'not_acquired',
      },
      uptime: process.uptime(),
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      },
    };
  }

  private async checkAmsDb(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
