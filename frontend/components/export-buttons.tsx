'use client';

import { Download, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useExportCsv, useExportExcel } from '@/hooks/useExport';

interface ExportButtonsProps {
  datasetId: string;
  exportParams?: Record<string, string>;
}

export function ExportButtons({ datasetId, exportParams }: ExportButtonsProps) {
  const csv = useExportCsv(datasetId, exportParams);
  const excel = useExportExcel(datasetId, exportParams);

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void csv.download()}
        isLoading={csv.isLoading}
        title="Export as CSV"
      >
        <Download className="h-4 w-4" />
        CSV
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void excel.download()}
        isLoading={excel.isLoading}
        title="Export as Excel"
      >
        <FileSpreadsheet className="h-4 w-4" />
        Excel
      </Button>
    </>
  );
}
