'use client';

import * as React from 'react';
import { Plus, Trash2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Toggle } from '@/components/ui/toggle';
import { ChannelConfigurator } from './channel-configurator';
import { TriggerPicker } from './trigger-picker';
import type { Condition, ConditionRow, ConditionChannels, ConditionOperator, Dataset, ColumnMeta } from '@/types';

const NUMERIC_OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: '==', label: '==' },
  { value: '!=', label: '!=' },
];

const TEXT_OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: '==', label: 'equals' },
  { value: '!=', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
];

const DATE_OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: '>', label: 'after' },
  { value: '<', label: 'before' },
  { value: '>=', label: 'after or on' },
  { value: '<=', label: 'before or on' },
  { value: '==', label: 'equals' },
];

function getOperatorsForType(type: ColumnMeta['type']): typeof NUMERIC_OPERATORS {
  if (type === 'numeric') return NUMERIC_OPERATORS;
  if (type === 'date') return DATE_OPERATORS;
  return TEXT_OPERATORS;
}

const emptyRow: ConditionRow = { column: '', operator: '==', value: '' };

interface ConditionBuilderProps {
  datasets: Dataset[];
  initialValues?: Partial<Condition>;
  onSubmit: (data: Omit<Condition, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  conditionId?: string;
  onPreview?: (id: string) => Promise<import('@/types').ConditionPreviewResult>;
  onTestNotify?: (data: Omit<Condition, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  isTestNotifying?: boolean;
}

export function ConditionBuilder({
  datasets,
  initialValues,
  onSubmit,
  onCancel,
  isSubmitting,
  conditionId,
  onPreview,
  onTestNotify,
  isTestNotifying,
}: ConditionBuilderProps) {
  const [name, setName] = React.useState(initialValues?.name ?? '');
  const [datasetId, setDatasetId] = React.useState(initialValues?.dataset_id ?? '');
  const [logic, setLogic] = React.useState<'AND' | 'OR'>(initialValues?.logic ?? 'AND');
  const [rows, setRows] = React.useState<ConditionRow[]>(
    initialValues?.condition_rows?.length ? initialValues.condition_rows : [{ ...emptyRow }]
  );
  const [channels, setChannels] = React.useState<ConditionChannels>(
    initialValues?.channels ?? {}
  );
  const [triggerCron, setTriggerCron] = React.useState<string | null>(
    initialValues?.trigger_cron ?? null
  );
  const [isActive, setIsActive] = React.useState(initialValues?.is_active ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const selectedDataset = datasets.find((d) => d.id === datasetId);
  const availableColumns = selectedDataset?.column_metadata ?? [];

  const addRow = () => setRows((prev) => [...prev, { ...emptyRow }]);

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof ConditionRow, val: string) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        if (field === 'column') {
          // Reset operator when column changes
          const col = availableColumns.find((c) => c.key === val);
          const ops = getOperatorsForType(col?.type ?? 'text');
          return { ...row, column: val, operator: ops[0].value, value: '' };
        }
        if (field === 'operator') return { ...row, operator: val as ConditionOperator };
        return { ...row, value: val };
      })
    );
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!datasetId) errs.datasetId = 'Dataset is required';
    rows.forEach((row, i) => {
      if (!row.column) errs[`row_${i}_column`] = 'Select a column';
      if (row.value === '') errs[`row_${i}_value`] = 'Enter a value';
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    await onSubmit({
      name,
      dataset_id: datasetId,
      logic,
      condition_rows: rows,
      channels,
      trigger_cron: triggerCron,
      is_active: isActive,
      last_triggered_at: null,
    });
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
      {/* Name */}
      <div className="space-y-1.5">
        <Label required>Condition Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Low Balance Alert"
          error={errors.name}
        />
      </div>

      {/* Dataset */}
      <div className="space-y-1.5">
        <Label required>Dataset</Label>
        <Select
          value={datasetId}
          onChange={(e) => setDatasetId(e.target.value)}
          placeholder="Select a dataset"
          error={errors.datasetId}
        >
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </div>

      {/* Logic */}
      <div className="space-y-1.5">
        <Label>Logic Operator</Label>
        <div className="flex gap-2">
          {(['AND', 'OR'] as const).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => setLogic(op)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                logic === op
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {op}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {logic === 'AND' ? 'All conditions must match' : 'Any condition can match'}
        </p>
      </div>

      {/* Condition rows */}
      <div className="space-y-2">
        <Label>Conditions</Label>
        {rows.map((row, index) => {
          const col = availableColumns.find((c) => c.key === row.column);
          const operators = getOperatorsForType(col?.type ?? 'text');

          return (
            <div key={index} className="flex gap-2 items-start">
              {/* Column */}
              <Select
                value={row.column}
                onChange={(e) => updateRow(index, 'column', e.target.value)}
                className="flex-1"
                error={errors[`row_${index}_column`]}
              >
                <option value="">Select column</option>
                {availableColumns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>

              {/* Operator */}
              <Select
                value={row.operator}
                onChange={(e) => updateRow(index, 'operator', e.target.value)}
                className="w-36"
              >
                {operators.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </Select>

              {/* Value */}
              <Input
                value={String(row.value)}
                onChange={(e) => updateRow(index, 'value', e.target.value)}
                placeholder="Value"
                type={col?.type === 'numeric' ? 'number' : col?.type === 'date' ? 'date' : 'text'}
                className="flex-1"
                error={errors[`row_${index}_value`]}
              />

              {/* Remove */}
              {rows.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(index)}
                  className="text-red-400 hover:text-red-300 flex-shrink-0 mt-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        })}

        <Button type="button" variant="ghost" size="sm" onClick={addRow} className="text-blue-400">
          <Plus className="h-4 w-4" />
          Add Condition Row
        </Button>
      </div>

      {/* Channels */}
      <div className="space-y-1.5">
        <Label>Notification Channels</Label>
        <ChannelConfigurator
          value={channels}
          onChange={setChannels}
          availableColumns={availableColumns.filter((c) => c.visible !== false)}
        />
      </div>

      {/* Trigger Schedule */}
      <div className="space-y-1.5">
        <Label>Trigger Schedule</Label>
        <TriggerPicker value={triggerCron} onChange={setTriggerCron} />
      </div>

      {/* Active */}
      <div className="flex items-center gap-3">
        <Toggle checked={isActive} onChange={setIsActive} label="Active" />
      </div>

      {/* Preview */}
      {conditionId && onPreview && (
        <div className="rounded-lg border border-gray-700 p-4">
          <div className="text-sm font-medium text-gray-300 mb-3">Match Preview</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onPreview(conditionId)}
          >
            Preview matches (no notification)
          </Button>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <div>
          {onTestNotify && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onTestNotify({
                name,
                dataset_id: datasetId,
                logic,
                condition_rows: rows,
                channels,
                trigger_cron: triggerCron,
                is_active: isActive,
                last_triggered_at: null,
              })}
              isLoading={isTestNotifying}
              className="gap-2 border-blue-700 text-blue-400 hover:bg-blue-900/30"
            >
              <Send className="h-3.5 w-3.5" />
              Send Test Email
            </Button>
          )}
        </div>
        <div className="flex gap-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            Save Condition
          </Button>
        </div>
      </div>
    </form>
  );
}
