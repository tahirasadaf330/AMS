'use client';

import * as React from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth.store';
import { useUIStore } from '@/store/ui.store';
import { googleMoImportApi, type SharePointSyncStatus } from '@/lib/api';
import { CheckCircle2, AlertCircle, Upload, FileText, X, RefreshCw, Cloud } from 'lucide-react';

interface ImportResult {
  upserted: number;
  vendor_rows?: number; // costs only — raw vendor rows before aggregation
  skipped: number;
}

interface SectionState {
  file: File | null;
  loading: boolean;
  result: ImportResult | null;
  error: string | null;
}

const defaultSection = (): SectionState => ({
  file: null,
  loading: false,
  result: null,
  error: null,
});

function FileDropZone({
  accept,
  file,
  onFile,
  onClear,
}: {
  accept: string;
  file: File | null;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-blue-300 dark:border-blue-600/50 bg-blue-50 dark:bg-blue-900/20 px-4 py-3">
        <FileText className="h-5 w-5 text-blue-500 flex-shrink-0" />
        <span className="text-sm text-gray-700 dark:text-gray-200 flex-1 truncate">{file.name}</span>
        <span className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</span>
        <button onClick={onClear} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border-2 border-dashed transition-colors cursor-pointer
        ${dragging
          ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
          : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
        }
        px-6 py-8 text-center`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Drop file here or <span className="text-blue-500 underline">browse</span>
      </p>
      <p className="text-xs text-gray-400 mt-1">Supports XLSX, CSV, PDF</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
    </div>
  );
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  return d.toLocaleString();
}

function SharePointStatusLine({ status }: { status: SharePointSyncStatus }) {
  const color =
    status.lastStatus === 'success'
      ? 'text-green-600 dark:text-green-400'
      : status.lastStatus === 'error'
        ? 'text-red-600 dark:text-red-400'
        : 'text-gray-400 dark:text-gray-500';
  return (
    <div className="text-xs">
      <span className="text-gray-500 dark:text-gray-400">
        Source: <code className="font-mono text-gray-500 dark:text-gray-400">{status.fileName}</code>
      </span>
      <span className={`ml-2 ${color}`}>
        {status.lastStatus === 'never'
          ? 'Not synced yet'
          : `Last sync: ${formatSyncTime(status.lastSyncedAt)} · ${status.lastStatus}`}
      </span>
      {status.lastStatus === 'error' && status.lastMessage && (
        <p className="mt-1 text-red-600 dark:text-red-400">{status.lastMessage}</p>
      )}
    </div>
  );
}

function ImportSection({
  title,
  description,
  columns,
  state,
  onFile,
  onClear,
  onImport,
  spStatus,
  syncing,
  onSyncSharePoint,
}: {
  title: string;
  description: string;
  columns: string;
  state: SectionState;
  onFile: (f: File) => void;
  onClear: () => void;
  onImport: () => void;
  spStatus?: SharePointSyncStatus | null;
  syncing?: boolean;
  onSyncSharePoint?: () => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-5 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Required columns: <code className="text-blue-400 font-mono">{columns}</code>
        </p>
      </div>

      {onSyncSharePoint && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-700/40 bg-blue-50/60 dark:bg-blue-900/10 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
              <Cloud className="h-4 w-4" />
              SharePoint source
            </div>
            <Button onClick={onSyncSharePoint} disabled={syncing} isLoading={syncing} size="sm" variant="outline">
              <RefreshCw className="h-3.5 w-3.5" />
              Sync from SharePoint
            </Button>
          </div>
          {spStatus && <SharePointStatusLine status={spStatus} />}
        </div>
      )}

      <FileDropZone
        accept=".xlsx,.xls,.csv,.pdf"
        file={state.file}
        onFile={onFile}
        onClear={onClear}
      />

      {state.result && (
        <div className="flex items-start gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-green-700 dark:text-green-400">
            <span className="font-semibold">{state.result.upserted} country/month records</span> upserted
            {state.result.vendor_rows !== undefined && (
              <span className="text-green-600 dark:text-green-500"> (summed from {state.result.vendor_rows} vendor rows)</span>
            )}
            {state.result.skipped > 0 && (
              <span className="text-green-600 dark:text-green-500"> · {state.result.skipped} rows skipped (invalid)</span>
            )}
          </div>
        </div>
      )}

      {state.error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={onImport}
          disabled={!state.file || state.loading}
          isLoading={state.loading}
          size="sm"
        >
          <Upload className="h-3.5 w-3.5" />
          Import
        </Button>
      </div>
    </div>
  );
}

export default function GoogleMoImportsPage() {
  const isAdmin = useAuthStore((s) => s.canAccess('admin'));
  const addToast = useUIStore((s) => s.addToast);

  const [costs, setCosts] = React.useState<SectionState>(defaultSection());
  const [estimates, setEstimates] = React.useState<SectionState>(defaultSection());

  const [spStatus, setSpStatus] = React.useState<Record<'costs' | 'estimates', SharePointSyncStatus | null>>({
    costs: null,
    estimates: null,
  });
  const [spSyncing, setSpSyncing] = React.useState<Record<'costs' | 'estimates', boolean>>({
    costs: false,
    estimates: false,
  });

  const loadSpStatus = React.useCallback(async () => {
    try {
      const { data } = await googleMoImportApi.sharePointStatus();
      const next: Record<'costs' | 'estimates', SharePointSyncStatus | null> = { costs: null, estimates: null };
      for (const s of data) next[s.target] = s;
      setSpStatus(next);
    } catch {
      // status is best-effort; ignore if it fails to load
    }
  }, []);

  React.useEffect(() => {
    if (isAdmin) void loadSpStatus();
  }, [isAdmin, loadSpStatus]);

  const handleSharePointSync = async (target: 'costs' | 'estimates') => {
    setSpSyncing((p) => ({ ...p, [target]: true }));
    try {
      const { data } = await googleMoImportApi.syncFromSharePoint(target);
      setSpStatus((p) => ({ ...p, [target]: data }));
      addToast({
        title: `${data.lastResult?.upserted ?? 0} rows synced from SharePoint`,
        variant: 'success',
      });
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        err?.message ??
        'SharePoint sync failed.';
      addToast({ title: msg, variant: 'destructive' });
      void loadSpStatus();
    } finally {
      setSpSyncing((p) => ({ ...p, [target]: false }));
    }
  };

  const handleImport = async (
    type: 'costs' | 'estimates',
    setState: React.Dispatch<React.SetStateAction<SectionState>>,
    file: File,
  ) => {
    setState((p) => ({ ...p, loading: true, result: null, error: null }));
    try {
      const { data } =
        type === 'costs'
          ? await googleMoImportApi.importCosts(file)
          : await googleMoImportApi.importEstimates(file);
      setState((p) => ({ ...p, loading: false, result: data, file: null }));
      addToast({ title: `${data.upserted} rows imported`, variant: 'success' });
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        err?.message ??
        'Import failed. Check file format and try again.';
      setState((p) => ({ ...p, loading: false, error: msg }));
      addToast({ title: msg, variant: 'destructive' });
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        Admin access required.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Google MO Data Imports"
        description="Upload XLSX, CSV, or PDF files to update Google Costs and MO Traffic Estimates. Existing rows are replaced by country+year+month key."
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ImportSection
          title="Google Costs"
          description="Monthly cost and miscellaneous data per country. Upserts by Country + Year + Month."
          columns="Country, Year, Month, Monthly Cost, Miscellaneous"
          state={costs}
          onFile={(f) => setCosts((p) => ({ ...p, file: f, result: null, error: null }))}
          onClear={() => setCosts((p) => ({ ...p, file: null, result: null, error: null }))}
          onImport={() => {
            if (costs.file) void handleImport('costs', setCosts, costs.file);
          }}
          spStatus={spStatus.costs}
          syncing={spSyncing.costs}
          onSyncSharePoint={() => void handleSharePointSync('costs')}
        />

        <ImportSection
          title="MO Traffic Estimates"
          description="Conservative monthly traffic estimates per country. Upserts by Country."
          columns="Country, Estimation"
          state={estimates}
          onFile={(f) => setEstimates((p) => ({ ...p, file: f, result: null, error: null }))}
          onClear={() => setEstimates((p) => ({ ...p, file: null, result: null, error: null }))}
          onImport={() => {
            if (estimates.file) void handleImport('estimates', setEstimates, estimates.file);
          }}
          spStatus={spStatus.estimates}
          syncing={spSyncing.estimates}
          onSyncSharePoint={() => void handleSharePointSync('estimates')}
        />
      </div>

      <div className="rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/10 px-4 py-3">
        <p className="text-sm text-amber-700 dark:text-amber-400">
          <span className="font-semibold">Note:</span> Imports run inside a database transaction. If any error occurs, the entire import is rolled back and existing data is preserved.
          PDF parsing works best with simple tabular formats. For reliable imports, prefer XLSX or CSV.
        </p>
      </div>
    </div>
  );
}
