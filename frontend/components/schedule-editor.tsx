'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn, getCronHumanReadable, getNextCronRun } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScheduleConfig {
  frequency: 'daily' | 'weekly' | 'monthly';
  dailyType: 'once' | 'repeat';
  hour: number;
  minute: number;
  intervalValue: number;
  intervalUnit: 'minutes' | 'hours';
  weekDays: number[];   // 0=Sun, 1=Mon, ..., 6=Sat
  monthDay: number;
  isCustom: boolean;
  rawCron: string;
  startDate: string;    // 'YYYY-MM-DD'
  endDate: string;      // 'YYYY-MM-DD' or ''
  noEndDate: boolean;
}

export interface ScheduleEditorProps {
  datasetId: string;
  datasetName: string;
  currentCron: string;
  scheduleStartDate?: string | null;
  scheduleEndDate?: string | null;
  onSave: (datasetId: string, cron: string, startDate: string | null, endDate: string | null) => Promise<void>;
  onTrigger: (datasetId: string) => Promise<void>;
  onCancel?: (datasetId: string) => Promise<void>;
  isSaving?: boolean;
  isTriggering?: boolean;
  isCancelling?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseCron(cron: string, startDate?: string | null, endDate?: string | null): ScheduleConfig {
  const sd = startDate ? startDate.slice(0, 10) : todayIso();
  const ed = endDate ? endDate.slice(0, 10) : '';
  const base: ScheduleConfig = {
    frequency: 'daily',
    dailyType: 'once',
    hour: 9,
    minute: 0,
    intervalValue: 30,
    intervalUnit: 'minutes',
    weekDays: [1, 2, 3, 4, 5],
    monthDay: 1,
    isCustom: false,
    rawCron: cron ?? '',
    startDate: sd,
    endDate: ed,
    noEndDate: !endDate,
  };

  if (!cron) return base;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { ...base, isCustom: true };

  const [min, hour, dom, month, dow] = parts;

  // Every N minutes: */N * * * *
  if (/^\*\/\d+$/.test(min) && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return { ...base, frequency: 'daily', dailyType: 'repeat', intervalValue: parseInt(min.slice(2)), intervalUnit: 'minutes' };
  }
  // Every N hours: M */N * * *
  if (/^\*\/\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
    return { ...base, frequency: 'daily', dailyType: 'repeat', intervalValue: parseInt(hour.slice(2)), intervalUnit: 'hours' };
  }
  // Monthly: M H D * *
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && month === '*' && dow === '*') {
    return { ...base, frequency: 'monthly', hour: parseInt(hour), minute: parseInt(min), monthDay: parseInt(dom) };
  }
  // Weekly: M H * * D[,D...]
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow !== '*') {
    const days = dow.split(',').map(Number).filter((n) => !isNaN(n));
    return { ...base, frequency: 'weekly', hour: parseInt(hour), minute: parseInt(min), weekDays: days };
  }
  // Daily once: M H * * *
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
    return { ...base, frequency: 'daily', dailyType: 'once', hour: parseInt(hour), minute: parseInt(min) };
  }

  return { ...base, isCustom: true };
}

function configToCron(config: ScheduleConfig): string {
  if (config.isCustom) return config.rawCron;
  const m = config.minute;
  const h = config.hour;
  switch (config.frequency) {
    case 'daily':
      if (config.dailyType === 'repeat') {
        if (config.intervalUnit === 'minutes') return `*/${config.intervalValue} * * * *`;
        return `0 */${config.intervalValue} * * *`;
      }
      return `${m} ${h} * * *`;
    case 'weekly': {
      const days = config.weekDays.length > 0
        ? [...config.weekDays].sort((a, b) => a - b).join(',')
        : '*';
      return `${m} ${h} * * ${days}`;
    }
    case 'monthly':
      return `${m} ${h} ${config.monthDay} * *`;
  }
}

function isValidCron(cron: string | undefined | null): boolean {
  if (!cron) return false;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const validPart = /^(\*|\d+(-\d+)?(\/\d+)?)(,(\*|\d+(-\d+)?(\/\d+)?))*$|^\*\/\d+$/;
  return parts.every((p) => validPart.test(p) || p === '*');
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const DAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

const MINUTE_INTERVALS = [1, 2, 5, 10, 15, 20, 30, 45];
const HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12];

function TimeInputs({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
}: {
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Select
        value={hour}
        onChange={(e) => onHourChange(parseInt(e.target.value))}
        className="w-20"
      >
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
        ))}
      </Select>
      <span className="text-gray-400 font-mono">:</span>
      <Select
        value={minute}
        onChange={(e) => onMinuteChange(parseInt(e.target.value))}
        className="w-20"
      >
        {Array.from({ length: 60 }, (_, i) => (
          <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
        ))}
      </Select>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ScheduleEditor({
  datasetId,
  datasetName,
  currentCron,
  scheduleStartDate,
  scheduleEndDate,
  onSave,
  onTrigger,
  onCancel,
  isSaving,
  isTriggering,
  isCancelling,
}: ScheduleEditorProps) {
  const [config, setConfig] = React.useState<ScheduleConfig>(() =>
    parseCron(currentCron ?? '', scheduleStartDate, scheduleEndDate)
  );

  const cron = configToCron(config);
  const cronValid = isValidCron(cron);

  const set = (patch: Partial<ScheduleConfig>) => setConfig((c) => ({ ...c, ...patch }));

  const toggleDay = (day: number) => {
    const next = config.weekDays.includes(day)
      ? config.weekDays.filter((d) => d !== day)
      : [...config.weekDays, day];
    if (next.length > 0) set({ weekDays: next });
  };

  const handleSave = async () => {
    if (!cronValid) return;
    const startDate = config.startDate || null;
    const endDate = config.noEndDate ? null : (config.endDate || null);
    await onSave(datasetId, cron, startDate, endDate);
  };

  return (
    <div className="space-y-5 text-sm">
      {/* Dataset name */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">Dataset</span>
        <span className="text-gray-200 font-medium">{datasetName}</span>
      </div>

      {/* ── Frequency tabs ── */}
      <div className="space-y-3">
        <Label>Frequency</Label>
        <div className="flex gap-1 p-1 bg-gray-800 rounded-lg">
          {(['daily', 'weekly', 'monthly'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => set({ frequency: f, isCustom: false })}
              className={cn(
                'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors capitalize',
                config.frequency === f && !config.isCustom
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              )}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => set({ isCustom: true })}
            className={cn(
              'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors',
              config.isCustom
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            )}
          >
            Custom
          </button>
        </div>
      </div>

      {/* ── Custom cron ── */}
      {config.isCustom && (
        <div className="space-y-2 p-3 rounded-lg border border-gray-700 bg-gray-900/40">
          <Label>Cron Expression</Label>
          <Input
            value={config.rawCron}
            onChange={(e) => set({ rawCron: e.target.value })}
            placeholder="* * * * *"
            className="font-mono"
          />
          <p className="text-xs text-gray-500">Format: minute hour day-of-month month day-of-week</p>
        </div>
      )}

      {/* ── Daily ── */}
      {!config.isCustom && config.frequency === 'daily' && (
        <div className="space-y-3 p-3 rounded-lg border border-gray-700 bg-gray-900/40">
          <Label>Daily Frequency</Label>

          {/* Once at */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="dailyType"
              checked={config.dailyType === 'once'}
              onChange={() => set({ dailyType: 'once' })}
              className="text-blue-500"
            />
            <span className="text-gray-300 w-32">Occurs once at</span>
            <TimeInputs
              hour={config.hour}
              minute={config.minute}
              onHourChange={(h) => set({ hour: h })}
              onMinuteChange={(m) => set({ minute: m })}
            />
          </label>

          {/* Repeat */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="dailyType"
              checked={config.dailyType === 'repeat'}
              onChange={() => set({ dailyType: 'repeat' })}
              className="text-blue-500"
            />
            <span className="text-gray-300 w-32">Occurs every</span>
            <div className="flex items-center gap-2">
              <Select
                value={config.intervalValue}
                onChange={(e) => set({ intervalValue: parseInt(e.target.value) })}
                className="w-20"
                disabled={config.dailyType !== 'repeat'}
              >
                {(config.intervalUnit === 'minutes' ? MINUTE_INTERVALS : HOUR_INTERVALS).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </Select>
              <Select
                value={config.intervalUnit}
                onChange={(e) => set({ intervalUnit: e.target.value as 'minutes' | 'hours', intervalValue: e.target.value === 'minutes' ? 30 : 1 })}
                className="w-28"
                disabled={config.dailyType !== 'repeat'}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
              </Select>
            </div>
          </label>
        </div>
      )}

      {/* ── Weekly ── */}
      {!config.isCustom && config.frequency === 'weekly' && (
        <div className="space-y-3 p-3 rounded-lg border border-gray-700 bg-gray-900/40">
          <div className="flex items-center gap-4">
            <Label className="w-10">Time</Label>
            <TimeInputs
              hour={config.hour}
              minute={config.minute}
              onHourChange={(h) => set({ hour: h })}
              onMinuteChange={(m) => set({ minute: m })}
            />
          </div>

          <div className="space-y-2">
            <Label>On days</Label>
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={cn(
                    'px-3 py-1.5 rounded text-xs font-medium transition-colors border',
                    config.weekDays.includes(d.value)
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-400'
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Monthly ── */}
      {!config.isCustom && config.frequency === 'monthly' && (
        <div className="space-y-3 p-3 rounded-lg border border-gray-700 bg-gray-900/40">
          <div className="flex items-center gap-4">
            <Label className="w-10">Time</Label>
            <TimeInputs
              hour={config.hour}
              minute={config.minute}
              onHourChange={(h) => set({ hour: h })}
              onMinuteChange={(m) => set({ minute: m })}
            />
          </div>

          <div className="flex items-center gap-3">
            <Label>Day</Label>
            <Select
              value={config.monthDay}
              onChange={(e) => set({ monthDay: parseInt(e.target.value) })}
              className="w-20"
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
            <span className="text-gray-400 text-xs">of every month</span>
          </div>
        </div>
      )}

      {/* ── Duration ── */}
      <div className="space-y-3 p-3 rounded-lg border border-gray-700 bg-gray-900/40">
        <Label>Duration</Label>

        <div className="flex items-center gap-3">
          <span className="text-gray-400 w-24 text-xs">Start date</span>
          <Input
            type="date"
            value={config.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
            className="w-40"
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="endType"
              checked={config.noEndDate}
              onChange={() => set({ noEndDate: true, endDate: '' })}
              className="text-blue-500"
            />
            <span className="text-gray-300 text-xs">No end date</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="endType"
              checked={!config.noEndDate}
              onChange={() => set({ noEndDate: false })}
              className="text-blue-500"
            />
            <span className="text-gray-300 text-xs w-16">End on</span>
            {!config.noEndDate && (
              <Input
                type="date"
                value={config.endDate}
                onChange={(e) => set({ endDate: e.target.value })}
                className="w-40"
                min={config.startDate}
              />
            )}
          </label>
        </div>
      </div>

      {/* ── Summary ── */}
      {cronValid && (
        <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3 space-y-1.5">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Summary</p>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Schedule</span>
            <span className="text-gray-200 font-medium">{getCronHumanReadable(cron)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Expression</span>
            <code className="text-blue-400 font-mono">{cron}</code>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Next run</span>
            <span className="text-gray-200">{getNextCronRun(cron)}</span>
          </div>
          {config.startDate && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">Active from</span>
              <span className="text-gray-200">{config.startDate}{!config.noEndDate && config.endDate ? ` → ${config.endDate}` : ' (no end)'}</span>
            </div>
          )}
        </div>
      )}

      {!cronValid && config.isCustom && config.rawCron && (
        <p className="text-xs text-red-400">Invalid cron expression</p>
      )}

      {/* ── Actions ── */}
      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={!cronValid}
          isLoading={isSaving}
          size="sm"
        >
          Save Schedule
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void onTrigger(datasetId)}
          isLoading={isTriggering}
        >
          Trigger Now
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => void onCancel(datasetId)}
            isLoading={isCancelling}
            disabled={!isTriggering}
          >
            Cancel Refresh
          </Button>
        )}
      </div>
    </div>
  );
}
