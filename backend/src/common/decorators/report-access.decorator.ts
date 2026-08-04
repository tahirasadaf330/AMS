import { SetMetadata, applyDecorators } from '@nestjs/common';

export const REPORT_SLUG_KEY = 'reportSlug';
export const REPORT_NAME_KEY = 'reportName';
export const REPORT_SECTION_KEY = 'reportSection';

/** Business section a report/dataset belongs to. Drives the SMS/Voice split + Editor-role defaults. */
export type Section = 'sms' | 'voice';

/**
 * Marks a controller as a report gated by per-user access to `slug`.
 * `name` is the human label the admin UI shows when granting access (defaults to the slug).
 * `section` ('sms' | 'voice') groups the report and is what an Editor-role auto-grants.
 * ReportsRegistryService discovers all three from every controller, so adding a new report needs
 * only this one decorator. The slug metadata is kept as-is so ReportAccessGuard is unaffected.
 */
export const ReportAccess = (slug: string, name?: string, section?: Section) =>
  applyDecorators(
    SetMetadata(REPORT_SLUG_KEY, slug),
    SetMetadata(REPORT_NAME_KEY, name ?? slug),
    SetMetadata(REPORT_SECTION_KEY, section ?? null),
  );
