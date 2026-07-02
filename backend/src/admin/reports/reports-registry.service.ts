import { Injectable } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import {
  REPORT_SLUG_KEY,
  REPORT_NAME_KEY,
} from '../../common/decorators/report-access.decorator';

export interface ReportInfo {
  slug: string;
  name: string;
}

/**
 * Builds the list of grantable reports by scanning every controller for the
 * @ReportAccess decorator. No central list to maintain: a new report shows up
 * automatically as soon as its controller is decorated (which it must be for
 * ReportAccessGuard to work anyway).
 */
@Injectable()
export class ReportsRegistryService {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  list(): ReportInfo[] {
    const bySlug = new Map<string, string>();
    for (const wrapper of this.discovery.getControllers()) {
      const metatype = wrapper.metatype;
      if (!metatype) continue;
      const slug = this.reflector.get<string>(REPORT_SLUG_KEY, metatype);
      if (!slug || bySlug.has(slug)) continue;
      const name =
        this.reflector.get<string>(REPORT_NAME_KEY, metatype) ?? slug;
      bySlug.set(slug, name);
    }
    return [...bySlug.entries()]
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
