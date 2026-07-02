import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import axios from 'axios';
import { GraphEmailService } from '../../notifications/graph-email.service';
import { GoogleMoService } from './google-mo.service';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CRON_JOB_NAME = 'sharepoint-google-mo-sync';

export type SpTarget = 'costs' | 'estimates';

/**
 * A SharePoint document configured as an import source. Derived from the
 * browser share links the admin provided:
 *   https://kingrevolution.sharepoint.com/:x:/r/sites/<site>/_layouts/15/Doc.aspx?sourcedoc={<uniqueId>}&file=<fileName>
 */
interface SpSource {
  target: SpTarget;
  label: string;
  siteHost: string;
  sitePath: string; // server-relative site path, e.g. /sites/PowerBIDataSite
  fileName: string; // exact file name inside the site's document library
  uniqueId: string; // SharePoint sourcedoc GUID (kept for reference)
}

export interface SpSyncStatus {
  target: SpTarget;
  label: string;
  fileName: string;
  sitePath: string;
  lastSyncedAt: string | null;
  lastStatus: 'success' | 'error' | 'never';
  lastMessage: string | null;
  lastResult: unknown | null;
}

@Injectable()
export class SharePointSyncService implements OnModuleInit {
  private readonly logger = new Logger(SharePointSyncService.name);
  private readonly host: string;
  private readonly sources: SpSource[];
  private readonly status = new Map<SpTarget, SpSyncStatus>();

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly graphEmail: GraphEmailService,
    private readonly googleMo: GoogleMoService,
  ) {
    this.host = this.config.get<string>(
      'SHAREPOINT_HOST',
      'kingrevolution.sharepoint.com',
    );
    this.sources = [
      {
        target: 'costs',
        label: 'Google Costs',
        siteHost: this.host,
        sitePath: '/sites/PowerBIDataSite',
        fileName: 'Google costs.xlsx',
        uniqueId: 'C2B13411-F9BB-4B46-ACFB-040514FBDD51',
      },
      {
        target: 'estimates',
        label: 'MO Traffic Estimates',
        siteHost: this.host,
        sitePath: '/sites/PowerBISMSDataSource',
        fileName: 'MO Traffic Estimates.xlsx',
        uniqueId: 'AA8D3014-D14C-4B53-850C-C210547152D6',
      },
    ];
    for (const s of this.sources) {
      this.status.set(s.target, {
        target: s.target,
        label: s.label,
        fileName: s.fileName,
        sitePath: s.sitePath,
        lastSyncedAt: null,
        lastStatus: 'never',
        lastMessage: null,
        lastResult: null,
      });
    }
  }

  /** Register the scheduled auto-pull (configurable via env). */
  onModuleInit(): void {
    const enabled =
      this.config.get<string>('SHAREPOINT_SYNC_ENABLED', 'true') !== 'false';
    if (!enabled) {
      this.logger.log('SharePoint auto-sync disabled (SHAREPOINT_SYNC_ENABLED=false)');
      return;
    }
    const cronExpr = this.config.get<string>('SHAREPOINT_SYNC_CRON', '0 6 * * *');
    try {
      const job = new CronJob(cronExpr, () => {
        void this.runScheduledSync();
      });
      this.scheduler.addCronJob(CRON_JOB_NAME, job as any);
      job.start();
      this.logger.log(`SharePoint auto-sync scheduled (cron: "${cronExpr}")`);
    } catch (err: any) {
      this.logger.error(
        `Failed to schedule SharePoint auto-sync with cron "${cronExpr}": ${err?.message ?? err}`,
      );
    }
  }

  getStatus(): SpSyncStatus[] {
    return this.sources.map((s) => this.status.get(s.target)!);
  }

  /** Pull one file from SharePoint and import it. Updates status; throws on failure. */
  async sync(target: SpTarget): Promise<SpSyncStatus> {
    const source = this.sources.find((s) => s.target === target);
    if (!source) throw new Error(`Unknown SharePoint sync target: ${target}`);

    try {
      const buffer = await this.downloadSource(source);
      const result =
        target === 'costs'
          ? await this.googleMo.importCosts(buffer, XLSX_MIME, source.fileName)
          : await this.googleMo.importEstimates(buffer, XLSX_MIME, source.fileName);

      const status: SpSyncStatus = {
        target: source.target,
        label: source.label,
        fileName: source.fileName,
        sitePath: source.sitePath,
        lastSyncedAt: new Date().toISOString(),
        lastStatus: 'success',
        lastMessage: `${result.upserted} rows upserted`,
        lastResult: result,
      };
      this.status.set(target, status);
      this.logger.log(`SharePoint sync (${target}): ${status.lastMessage}`);
      return status;
    } catch (err: any) {
      const message = this.describeError(err);
      this.status.set(target, {
        target: source.target,
        label: source.label,
        fileName: source.fileName,
        sitePath: source.sitePath,
        lastSyncedAt: new Date().toISOString(),
        lastStatus: 'error',
        lastMessage: message,
        lastResult: null,
      });
      this.logger.warn(`SharePoint sync (${target}) failed: ${message}`);
      throw new Error(message);
    }
  }

  private async runScheduledSync(): Promise<void> {
    this.logger.log('Running scheduled SharePoint sync for Google MO imports…');
    for (const source of this.sources) {
      try {
        await this.sync(source.target);
      } catch {
        // sync() already recorded status + logged the warning
      }
    }
  }

  /** Downloads the file bytes via Microsoft Graph using the shared app-only token. */
  private async downloadSource(source: SpSource): Promise<Buffer> {
    const token = await this.graphEmail.getGraphToken();
    const siteId = await this.resolveSiteId(token, source);
    const downloadUrl = await this.resolveDownloadUrl(token, siteId, source);
    // downloadUrl is a short-lived pre-authenticated URL — no Authorization header.
    const fileResp = await axios.get<ArrayBuffer>(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    return Buffer.from(fileResp.data);
  }

  private async resolveSiteId(token: string, source: SpSource): Promise<string> {
    const url = `${GRAPH}/sites/${source.siteHost}:${source.sitePath}?$select=id`;
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 20000,
    });
    const id = resp.data?.id;
    if (!id) throw new Error(`Could not resolve SharePoint site "${source.sitePath}"`);
    return id;
  }

  /**
   * Finds the file's pre-authenticated download URL. Tries the default document
   * library by path first, then falls back to searching every drive (library)
   * on the site so subfolders / non-default libraries still resolve.
   */
  private async resolveDownloadUrl(
    token: string,
    siteId: string,
    source: SpSource,
  ): Promise<string> {
    const auth = {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    };
    const encName = encodeURIComponent(source.fileName);
    const DL = '@microsoft.graph.downloadUrl';

    // 1) Default drive, addressed by path.
    try {
      const r = await axios.get(
        `${GRAPH}/sites/${siteId}/drive/root:/${encName}?$select=id,name,${DL}`,
        auth,
      );
      if (r.data?.[DL]) return r.data[DL];
    } catch {
      // fall through to search
    }

    // 2) Search each drive on the site by file name.
    const drivesResp = await axios.get(
      `${GRAPH}/sites/${siteId}/drives?$select=id,name`,
      auth,
    );
    const drives: Array<{ id: string }> = drivesResp.data?.value ?? [];
    const wanted = source.fileName.toLowerCase();
    for (const drive of drives) {
      const sr = await axios.get(
        `${GRAPH}/drives/${drive.id}/root/search(q='${encName}')?$select=id,name,file,${DL}`,
        auth,
      );
      const match = (sr.data?.value ?? []).find(
        (it: any) => it.file && String(it.name).toLowerCase() === wanted,
      );
      if (match?.[DL]) return match[DL];
      if (match?.id) {
        const item = await axios.get(
          `${GRAPH}/drives/${drive.id}/items/${match.id}?$select=${DL}`,
          auth,
        );
        if (item.data?.[DL]) return item.data[DL];
      }
    }

    throw new Error(
      `File "${source.fileName}" not found in site "${source.sitePath}"`,
    );
  }

  private describeError(err: any): string {
    const status = err?.response?.status;
    const gErr = err?.response?.data?.error;
    let detail: string | undefined;
    if (gErr && typeof gErr === 'object') detail = gErr.message || gErr.code;
    else if (err?.response?.data) {
      try {
        detail = JSON.stringify(err.response.data).slice(0, 200);
      } catch {
        detail = undefined;
      }
    }
    detail = detail || err?.message;

    if (status === 401 || status === 403) {
      return `Microsoft Graph denied access (HTTP ${status}). The Graph app registration most likely needs the "Sites.Read.All" application permission with admin consent granted. Detail: ${detail}`;
    }
    if (status === 404) {
      return `SharePoint returned 404 — check the site path and file name. Detail: ${detail}`;
    }
    return `SharePoint sync failed${status ? ` (HTTP ${status})` : ''}: ${detail || 'unknown error'}`;
  }
}
