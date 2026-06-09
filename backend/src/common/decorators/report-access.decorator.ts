import { SetMetadata } from '@nestjs/common';

export const REPORT_SLUG_KEY = 'reportSlug';
export const ReportAccess = (slug: string) => SetMetadata(REPORT_SLUG_KEY, slug);
