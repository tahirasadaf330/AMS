'use client';

import * as React from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { ConditionPreviewResult } from '@/types';

interface ConditionPreviewPanelProps {
  conditionId: string;
  onPreview: (id: string) => Promise<ConditionPreviewResult>;
}

export function ConditionPreviewPanel({ conditionId, onPreview }: ConditionPreviewPanelProps) {
  const [result, setResult] = React.useState<ConditionPreviewResult | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handlePreview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await onPreview(conditionId);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setIsLoading(false);
    }
  };

  const columns = result?.matched_rows[0] ? Object.keys(result.matched_rows[0]) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">Preview Match Results</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handlePreview()}
          disabled={isLoading}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          Preview
        </Button>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-900/20 rounded p-2">{error}</p>
      )}

      {result && !isLoading && (
        <div>
          <p className="text-xs text-gray-400 mb-2">
            <span className="font-medium text-gray-300">{result.matched_count}</span> rows matched
            (no notification sent)
          </p>
          {result.matched_rows.length > 0 ? (
            <div className="overflow-auto max-h-60 rounded border border-gray-700">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-800 border-b border-gray-700">
                    {columns.slice(0, 6).map((col) => (
                      <th
                        key={col}
                        className="px-3 py-2 text-left text-gray-400 font-medium whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.matched_rows.slice(0, 20).map((row, idx) => (
                    <tr key={idx} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      {columns.slice(0, 6).map((col) => (
                        <td key={col} className="px-3 py-2 text-gray-300 whitespace-nowrap">
                          {String(row[col] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.matched_rows.length > 20 && (
                <p className="text-xs text-gray-500 p-2 text-center">
                  Showing 20 of {result.matched_rows.length} rows
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500 italic">No rows matched the current conditions</p>
          )}
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-4">
          <Spinner size="sm" />
        </div>
      )}
    </div>
  );
}
