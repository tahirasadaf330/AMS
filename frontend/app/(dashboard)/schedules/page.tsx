'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Edit2, ChevronDown, ChevronUp } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { ScheduleEditor } from '@/components/schedule-editor';
import { RefreshHistoryTable } from '@/components/refresh-history-table';
import { Dialog, DialogHeader, DialogBody } from '@/components/ui/dialog';
import { SkeletonTable } from '@/components/ui/skeleton';
import { schedulesApi } from '@/lib/api';
import { useRefreshHistory } from '@/hooks/useDashboard';
import { useUIStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';
import { getCronHumanReadable, getNextCronRun, formatDatetime } from '@/lib/utils';
import type { Schedule } from '@/types';

function useSchedules() {
  return useQuery({
    queryKey: ['schedules'],
    queryFn: async () => {
      const { data } = await schedulesApi.list();
      return data;
    },
    staleTime: 60 * 1000,
  });
}

export default function SchedulesPage() {
  const { data: schedules, isLoading } = useSchedules();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const canManage = useAuthStore((s) => s.canAccess('manage_schedule'));
  const canTrigger = useAuthStore((s) => s.canAccess('trigger_refresh'));

  const [editTarget, setEditTarget] = React.useState<Schedule | null>(null);
  const [historyDatasetId, setHistoryDatasetId] = React.useState<string | null>(null);

  const { data: historyData, isLoading: historyLoading } = useRefreshHistory(
    historyDatasetId ?? ''
  );

  const saveScheduleMutation = useMutation({
    mutationFn: async ({ datasetId, cron, startDate, endDate }: { datasetId: string; cron: string; startDate: string | null; endDate: string | null }) => {
      await schedulesApi.update(datasetId, cron, startDate, endDate);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schedules'] });
      addToast({ title: 'Schedule saved', variant: 'success' });
      setEditTarget(null);
    },
    onError: () => {
      addToast({ title: 'Failed to save schedule', variant: 'destructive' });
    },
  });

  const triggerMutation = useMutation({
    mutationFn: async (datasetId: string) => {
      await schedulesApi.trigger(datasetId);
    },
    onSuccess: () => {
      addToast({ title: 'Refresh triggered', variant: 'success' });
    },
    onError: () => {
      addToast({ title: 'Trigger failed', variant: 'destructive' });
    },
  });

  if (!canManage) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        You do not have permission to manage schedules.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Schedule Manager"
        description="Configure refresh schedules for datasets"
      />

      {isLoading ? (
        <SkeletonTable rows={4} cols={7} />
      ) : (
        <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Dataset</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Schedule</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Run</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Next Run</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Rows</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(schedules ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500 text-sm">
                    No schedules configured
                  </td>
                </tr>
              )}
              {(schedules ?? []).map((schedule) => (
                <React.Fragment key={schedule.dataset_id}>
                  <tr className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                    <td className="px-4 py-3 text-gray-800 dark:text-gray-200 font-medium">{schedule.dataset_name}</td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-gray-800 dark:text-gray-200">{getCronHumanReadable(schedule.cron)}</p>
                        <code className="text-xs text-gray-500 font-mono">{schedule.cron}</code>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                      {schedule.last_run ? formatDatetime(schedule.last_run) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {schedule.last_status ? <StatusBadge status={schedule.last_status} /> : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                      {schedule.next_run
                        ? formatDatetime(schedule.next_run)
                        : getNextCronRun(schedule.cron)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">
                      {schedule.row_count?.toLocaleString() ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEditTarget(schedule)}
                          title="Edit schedule"
                        >
                          <Edit2 className="h-3.5 w-3.5 text-blue-400" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setHistoryDatasetId((prev) =>
                              prev === schedule.dataset_id ? null : schedule.dataset_id
                            )
                          }
                          className="text-xs text-gray-500 dark:text-gray-400"
                        >
                          History
                          {historyDatasetId === schedule.dataset_id ? (
                            <ChevronUp className="h-3 w-3 ml-1" />
                          ) : (
                            <ChevronDown className="h-3 w-3 ml-1" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>

                  {/* Inline history */}
                  {historyDatasetId === schedule.dataset_id && (
                    <tr>
                      <td colSpan={7} className="bg-gray-50 dark:bg-gray-900/50 p-4">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium">
                          Recent Refresh History — {schedule.dataset_name}
                        </p>
                        <RefreshHistoryTable
                          entries={(historyData ?? []).slice(0, 20)}
                          isLoading={historyLoading}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit schedule dialog */}
      <Dialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        className="max-w-2xl"
      >
        <DialogHeader title="Edit Schedule" onClose={() => setEditTarget(null)} />
        <DialogBody>
          {editTarget && (
            <ScheduleEditor
              datasetId={editTarget.dataset_id}
              datasetName={editTarget.dataset_name}
              currentCron={editTarget.cron}
              scheduleStartDate={editTarget.schedule_start_date}
              scheduleEndDate={editTarget.schedule_end_date}
              onSave={async (id, cron, startDate, endDate) => {
                await saveScheduleMutation.mutateAsync({ datasetId: id, cron, startDate, endDate });
              }}
              onTrigger={async (id) => {
                await triggerMutation.mutateAsync(id);
              }}
              isSaving={saveScheduleMutation.isPending}
              isTriggering={triggerMutation.isPending}
            />
          )}
        </DialogBody>
      </Dialog>
    </div>
  );
}
