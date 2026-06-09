import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { REPORT_SLUG_KEY } from '../decorators/report-access.decorator';

@Injectable()
export class ReportAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const slug =
      this.reflector.get<string>(REPORT_SLUG_KEY, context.getHandler()) ??
      this.reflector.get<string>(REPORT_SLUG_KEY, context.getClass());

    if (!slug) return true;

    const request = context.switchToHttp().getRequest<{ user?: { sub: string; role: string } }>();
    const user = request.user;
    if (!user) return false;

    if (user.role === 'admin') return true;

    const rows = await this.dataSource.query(
      `SELECT 1 FROM user_report_access WHERE user_id = $1 AND report_slug = $2 LIMIT 1`,
      [user.sub, slug],
    );
    return rows.length > 0;
  }
}
