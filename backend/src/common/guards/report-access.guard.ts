import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REPORT_SLUG_KEY } from '../decorators/report-access.decorator';
import { AccessResolverService } from '../access/access-resolver.service';

@Injectable()
export class ReportAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const slug =
      this.reflector.get<string>(REPORT_SLUG_KEY, context.getHandler()) ??
      this.reflector.get<string>(REPORT_SLUG_KEY, context.getClass());

    if (!slug) return true;

    const request = context.switchToHttp().getRequest<{ user?: { sub: string; role: string } }>();
    const user = request.user;
    if (!user) return false;

    // Central resolver: admin → all; else section-editor reports ∪ role/group grants ∪ individual.
    const acc = await this.access.resolve(user.sub);
    return acc.isAdmin || acc.reportSlugs.has(slug);
  }
}
