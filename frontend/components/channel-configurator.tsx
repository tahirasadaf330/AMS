'use client';

import * as React from 'react';
import { X, Mail, MessageSquare, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { ConditionChannels, ColumnMeta } from '@/types';

interface ChannelConfiguratorProps {
  value: ConditionChannels;
  onChange: (channels: ConditionChannels) => void;
  availableColumns?: ColumnMeta[];
}

export function ChannelConfigurator({ value, onChange, availableColumns = [] }: ChannelConfiguratorProps) {
  const [newEmail, setNewEmail] = React.useState('');
  const [emailError, setEmailError] = React.useState('');

  const emailEnabled = value.email?.enabled ?? false;
  const recipients = value.email?.recipients ?? [];
  const text = value.email?.text ?? '';
  const selectedColumns = value.email?.columns ?? [];
  const teamsEnabled = value.teams?.enabled ?? false;
  const webhookUrl = value.teams?.webhook_url ?? '';
  const severity = value.teams?.severity ?? 'info';

  const visibleColumns = availableColumns.filter((c) => c.visible !== false);

  const updateEmail = (patch: Partial<NonNullable<ConditionChannels['email']>>) => {
    onChange({
      ...value,
      email: { enabled: emailEnabled, recipients, text, columns: selectedColumns, ...patch },
    });
  };

  const setTeamsEnabled = (enabled: boolean) => {
    onChange({ ...value, teams: { enabled, webhook_url: webhookUrl, severity } });
  };

  const addRecipient = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('Invalid email address');
      return;
    }
    if (recipients.includes(email)) {
      setEmailError('Already added');
      return;
    }
    setEmailError('');
    updateEmail({ recipients: [...recipients, email] });
    setNewEmail('');
  };

  const removeRecipient = (email: string) => {
    updateEmail({ recipients: recipients.filter((r) => r !== email) });
  };

  const toggleColumn = (key: string) => {
    const next = selectedColumns.includes(key)
      ? selectedColumns.filter((k) => k !== key)
      : [...selectedColumns, key];
    updateEmail({ columns: next });
  };

  const toggleAllColumns = () => {
    const allKeys = visibleColumns.map((c) => c.key);
    const allSelected = allKeys.every((k) => selectedColumns.includes(k));
    updateEmail({ columns: allSelected ? [] : allKeys });
  };

  const setWebhookUrl = (url: string) => {
    onChange({ ...value, teams: { enabled: teamsEnabled, webhook_url: url, severity } });
  };

  const setSeverity = (s: 'critical' | 'warning' | 'info') => {
    onChange({ ...value, teams: { enabled: teamsEnabled, webhook_url: webhookUrl, severity: s } });
  };

  const allSelected = visibleColumns.length > 0 && visibleColumns.every((c) => selectedColumns.includes(c.key));
  const someSelected = selectedColumns.length > 0 && !allSelected;

  return (
    <div className="space-y-4">
      {/* Email */}
      <div className="rounded-lg border border-gray-700 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-blue-400" />
            <Label className="text-gray-200 font-medium">Email Notifications</Label>
          </div>
          <Toggle checked={emailEnabled} onChange={(v) => updateEmail({ enabled: v })} size="sm" />
        </div>

        {emailEnabled && (
          <div className="space-y-3">
            {/* Add Text */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-400">Add Text</Label>
              <textarea
                rows={3}
                placeholder="Write the message that will appear in the email…"
                value={text}
                onChange={(e) => updateEmail({ text: e.target.value })}
                className="flex w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-blue-500 resize-y"
              />
            </div>

            {/* Column selection */}
            {visibleColumns.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-gray-400">
                    Columns in Email
                    {selectedColumns.length > 0 && (
                      <span className="ml-1 text-blue-400">({selectedColumns.length} selected)</span>
                    )}
                  </Label>
                  <button
                    type="button"
                    onClick={toggleAllColumns}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="rounded-md border border-gray-600 bg-gray-900 p-2 max-h-40 overflow-y-auto">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {visibleColumns.map((col) => {
                      const checked = selectedColumns.length === 0 ? true : selectedColumns.includes(col.key);
                      return (
                        <label
                          key={col.key}
                          className="flex items-center gap-2 cursor-pointer py-0.5 group"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleColumn(col.key)}
                            className="h-3.5 w-3.5 rounded border-gray-500 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                          />
                          <span className="text-xs text-gray-300 group-hover:text-gray-100 truncate">
                            {col.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <p className="text-xs text-gray-600">
                  {selectedColumns.length === 0 ? 'All columns will be included.' : `${selectedColumns.length} of ${visibleColumns.length} columns selected.`}
                </p>
              </div>
            )}

            {/* Recipients */}
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Recipients</Label>
              {recipients.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {recipients.map((email) => (
                    <span
                      key={email}
                      className="flex items-center gap-1 rounded-full bg-blue-900/40 border border-blue-700 px-2.5 py-0.5 text-xs text-blue-300"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => removeRecipient(email)}
                        className="hover:text-blue-100 ml-0.5"
                        aria-label={`Remove ${email}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="user@example.com"
                  value={newEmail}
                  onChange={(e) => {
                    setNewEmail(e.target.value);
                    setEmailError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addRecipient();
                    }
                  }}
                  error={emailError}
                  className="flex-1"
                />
                <Button type="button" variant="secondary" size="sm" onClick={addRecipient}>
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Teams */}
      <div className="rounded-lg border border-gray-700 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-purple-400" />
            <Label className="text-gray-200 font-medium">Teams Notifications</Label>
          </div>
          <Toggle checked={teamsEnabled} onChange={setTeamsEnabled} size="sm" />
        </div>

        {teamsEnabled && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Webhook URL</Label>
              <Input
                type="url"
                placeholder="https://outlook.office.com/webhook/..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Severity</Label>
              <div className="flex gap-2">
                {(['info', 'warning', 'critical'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeverity(s)}
                    className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                      severity === s
                        ? s === 'critical'
                          ? 'bg-red-900/60 border-red-500 text-red-300'
                          : s === 'warning'
                          ? 'bg-yellow-900/60 border-yellow-500 text-yellow-300'
                          : 'bg-blue-900/60 border-blue-500 text-blue-300'
                        : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
