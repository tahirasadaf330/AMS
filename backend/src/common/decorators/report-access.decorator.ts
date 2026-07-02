import { SetMetadata, applyDecorators } from '@nestjs/common';

export const REPORT_SLUG_KEY = 'reportSlug';
export const REPORT_NAME_KEY = 'reportName';

/**
 * Marks a controller as a report gated by per-user access to `slug`.
 * `name` is the human label the admin UI shows when granting access
 * (defaults to the slug). ReportsRegistryService discovers both from every
 * controller, so adding a new report needs only this one decorator — it then
 * appears automatically in the admin access list. The slug metadata is kept
 * as-is so ReportAccessGuard is unaffected.
 */
export const ReportAccess = (slug: string, name?: string) =>
  applyDecorators(
    SetMetadata(REPORT_SLUG_KEY, slug),
    SetMetadata(REPORT_NAME_KEY, name ?? slug),
  );
