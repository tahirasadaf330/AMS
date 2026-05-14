'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn, getCronHumanReadable, getNextCronRun } from '@/lib/utils';

type Frequency = 'daily' | 'weekly' | 'monthly' | 'custom';
type DailyType = 'once' | 'repeat';

interface Config {
  frequency: Frequency;
  dailyType: DailyType;
  hour: number;
  minute: number;
  intervalValue: number;
  intervalUnit: 'minutes' | 'hours';
  weekDays: number[];
  monthDay: number;
  rawCron: string;
}

const DAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

const MINUTE_INTERVALS = [1, 5, 10, 15, 20, 30, 45];
const HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12];

function parseCron(cron: string | null | undefined): Config & { enabled: boolean } {
  const base: Config = {
    frequency: 'daily',
    dailyType: 'once',
    hour: 9,
    minute: 0,
    intervalValue: 30,
    intervalUnit: 'minutes',
    weekDays: [1, 2, 3, 4, 5],
    monthDay: 1,
    rawCron: cron ?? '',
  };

  if (!cron) return { ...base, enabled: false };

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { ...base, frequency: 'custom', enabled: true };

  const [min, hour, dom, , dow] = parts;

  if (/^\*\/\d+$/.test(min) && hour === '*' && dom === '*')
    return { ...base, frequency: 'daily', dailyType: 'repeat', intervalValue: parseInt(min.slice(2)), intervalUnit: 'minutes', enabled: true };
  if (/^\*\/\d+$/.test(hour) && dom === '*')
    return { ...base, frequency: 'daily', dailyType: 'repeat', intervalValue: parseInt(hour.slice(2)), intervalUnit: 'hours', enabled: true };
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom))
    return { ...base, frequency: 'monthly', hour: parseInt(hour), minute: parseInt(min), monthDay: parseInt(dom), enabled: true };
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && dow !== '*')
    return { ...base, frequency: 'weekly', hour: parseInt(hour), minute: parseInt(min), weekDays: dow.split(',').map(Number), enabled: true };
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*')
    return { ...base, frequency: 'daily', dailyType: 'once', hour: parseInt(hour), minute: parseInt(min), enabled: true };

  return { ...base, frequency: 'custom', rawCron: cron, enabled: true };
}

function configToCron(config: Config): string {
  const { minute: m, hour: h } = config;
  if (config.frequency === 'custom') return config.rawCron;
  if (config.frequency === 'daily') {
    if (config.dailyType === 'repeat') {
      return config.intervalUnit === 'minutes'
        ? `*/${config.intervalValue} * * * *`
        : `0 */${config.intervalValue} * * *`;
    }
    return `${m} ${h} * * *`;
  }
  if (config.frequency === 'weekly') {
    const days = config.weekDays.length > 0 ? [...config.weekDays].sort((a, b) => a - b).join(',') : '*';
    return `${m} ${h} * * ${days}`;
  }
  return `${m} ${h} ${config.monthDay} * *`;
}

function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const re = /^(\*|\d+(-\d+)?(\/\d+)?)(,(\*|\d+(-\d+)?(\/\d+)?))*$|^\*\/\d+$/;
  return parts.every((p) => re.test(p) || p === '*');
}

interface TriggerPickerProps {
  value: string | null | undefined;
  onChange: (cron: string | null) => void;
}

export function TriggerPicker({ value, onChange }: TriggerPickerProps) {
  const parsed = React.useMemo(() => parseCron(value), []);
  const [enabled, setEnabled] = React.useState(parsed.enabled);
  const [config, setConfig] = React.useState<Config>(parsed);

  const set = (patch: Partial<Config>) => setConfig((c) => ({ ...c, ...patch }));

  const cron = enabled ? configToCron(config) : '';
  const cronValid = enabled ? isValidCron(cron) : true;

  React.useEffect(() => {
    onChange(enabled && cronValid && cron ? cron : null);
  }, [cron, enabled, cronValid]);

  const toggleDay = (day: number) => {
    const next = config.weekDays.includes(day)
      ? config.weekDays.filter((d) => d !== day)
      : [...config.weekDays, day];
    if (next.length > 0) set({ weekDays: next });
  };

  return (
    <div className="rounded-lg border border-gray-700 p-4 space-y-3">
      {/* Enable toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-gray-500 bg-gray-700 text-blue-500"
        />
        <span className="text-sm text-gray-300">Enable automatic trigger</span>
      </label>

      {!enabled && (
        <p className="text-xs text-gray-500">No automatic trigger — run manually only</p>
      )}

      {enabled && (
        <div className="space-y-3">
          {/* Frequency tabs */}
          <div className="flex gap-1 p-1 bg-gray-800 rounded-lg">
            {(['daily', 'weekly', 'monthly', 'custom'] as Frequency[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => set({ frequency: f })}
                className={cn(
                  'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors capitalize',
                  config.frequency === f
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-gray-200'
                )}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/* Custom */}
          {config.frequency === 'custom' && (
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Cron Expression</Label>
              <Input
                value={config.rawCron}
                onChange={(e) => set({ rawCron: e.target.value })}
                placeholder="0 9 * * 1-5"
                className="font-mono"
              />
              <p className="text-xs text-gray-500">minute  hour  day-of-month  month  day-of-week</p>
            </div>
          )}

          {/* Daily */}
          {config.frequency === 'daily' && (
            <div className="space-y-2 p-3 rounded-lg border border-gray-700 bg-gray-900/40">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="radio" name="tpDailyType" checked={config.dailyType === 'once'}
                  onChange={() => set({ dailyType: 'once' })} className="text-blue-500" />
                <span className="text-gray-300 text-sm w-28">Occurs once at</span>
                <TimeInputs hour={config.hour} minute={config.minute}
                  onHourChange={(h) => set({ hour: h })} onMinuteChange={(m) => set({ minute: m })} />
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="radio" name="tpDailyType" checked={config.dailyType === 'repeat'}
                  onChange={() => set({ dailyType: 'repeat' })} className="text-blue-500" />
                <span className="text-gray-300 text-sm w-28">Occurs every</span>
                <div className="flex items-center gap-2">
                  <Select value={config.intervalValue}
                    onChange={(e) => set({ intervalValue: parseInt(e.target.value) })}
                    className="w-20" disabled={config.dailyType !== 'repeat'}>
                    {(config.intervalUnit === 'minutes' ? MINUTE_INTERVALS : HOUR_INTERVALS).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </Select>
                  <Select value={config.intervalUnit}
                    onChange={(e) => set({ intervalUnit: e.target.value as 'minutes' | 'hours', intervalValue: e.target.value === 'minutes' ? 30 : 1 })}
                    className="w-28" disabled={config.dailyType !== 'repeat'}>
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                  </Select>
                </div>
              </label>
            </div>
          )}

          {/* Weekly */}
          {config.frequency === 'weekly' && (
            <div className="space-y-3 p-3 rounded-lg border border-gray-700 bg-gray-900/40">
              <div className="flex items-center gap-4">
                <Label className="text-xs text-gray-400 w-10">Time</Label>
                <TimeInputs hour={config.hour} minute={config.minute}
                  onHourChange={(h) => set({ hour: h })} onMinuteChange={(m) => set({ minute: m })} />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {DAYS.map((d) => (
                  <button key={d.value} type="button" onClick={() => toggleDay(d.value)}
                    className={cn(
                      'px-3 py-1.5 rounded text-xs font-medium transition-colors border',
                      config.weekDays.includes(d.value)
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-400'
                    )}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Monthly */}
          {config.frequency === 'monthly' && (
            <div className="space-y-3 p-3 rounded-lg border border-gray-700 bg-gray-900/40">
              <div className="flex items-center gap-4">
                <Label className="text-xs text-gray-400 w-10">Time</Label>
                <TimeInputs hour={config.hour} minute={config.minute}
                  onHourChange={(h) => set({ hour: h })} onMinuteChange={(m) => set({ minute: m })} />
              </div>
              <div className="flex items-center gap-3">
                <Label className="text-xs text-gray-400">Day</Label>
                <Select value={config.monthDay}
                  onChange={(e) => set({ monthDay: parseInt(e.target.value) })} className="w-20">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </Select>
                <span className="text-gray-400 text-xs">of every month</span>
              </div>
            </div>
          )}

          {/* Summary */}
          {cronValid && cron && (
            <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3 space-y-1">
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
            </div>
          )}
          {!cronValid && config.frequency === 'custom' && config.rawCron && (
            <p className="text-xs text-red-400">Invalid cron expression</p>
          )}
        </div>
      )}
    </div>
  );
}

function TimeInputs({ hour, minute, onHourChange, onMinuteChange }: {
  hour: number; minute: number;
  onHourChange: (h: number) => void; onMinuteChange: (m: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Select value={hour} onChange={(e) => onHourChange(parseInt(e.target.value))} className="w-20">
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
        ))}
      </Select>
      <span className="text-gray-400 font-mono">:</span>
      <Select value={minute} onChange={(e) => onMinuteChange(parseInt(e.target.value))} className="w-20">
        {Array.from({ length: 60 }, (_, i) => (
          <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
        ))}
      </Select>
    </div>
  );
}
