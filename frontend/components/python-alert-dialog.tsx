'use client';

import * as React from 'react';
import { Dialog, DialogHeader, DialogBody } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TriggerPicker } from './trigger-picker';
import type { Condition } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<Condition, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  isSubmitting?: boolean;
  initialValues?: Partial<Condition>;
}

export function PythonAlertDialog({ open, onClose, onSubmit, isSubmitting, initialValues }: Props) {
  const [name, setName] = React.useState(initialValues?.name ?? '');
  const [script, setScript] = React.useState(initialValues?.python_script ?? '');
  const [triggerCron, setTriggerCron] = React.useState<string | null>(initialValues?.trigger_cron ?? null);
  const [teamsEnabled, setTeamsEnabled] = React.useState(initialValues?.channels?.teams?.enabled ?? false);
  const [teamsWebhook, setTeamsWebhook] = React.useState(initialValues?.channels?.teams?.webhook_url ?? '');
  const [errors, setErrors] = React.useState<{ name?: string; script?: string }>({});

  React.useEffect(() => {
    if (open) {
      setName(initialValues?.name ?? '');
      setScript(initialValues?.python_script ?? '');
      setTriggerCron(initialValues?.trigger_cron ?? null);
      setTeamsEnabled(initialValues?.channels?.teams?.enabled ?? false);
      setTeamsWebhook(initialValues?.channels?.teams?.webhook_url ?? '');
      setErrors({});
    }
  }, [open]);

  const validate = () => {
    const e: typeof errors = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!script.trim()) e.script = 'Script is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    await onSubmit({
      name,
      type: 'python',
      python_script: script,
      dataset_id: undefined,
      logic: 'AND',
      condition_rows: [],
      // Preserve channels this dialog doesn't edit (e.g. code-managed email recipients) —
      // previously `channels: {}` here wiped them on every save.
      channels: {
        ...(initialValues?.channels ?? {}),
        teams: {
          ...(initialValues?.channels?.teams ?? {}),
          enabled: teamsEnabled,
          webhook_url: teamsWebhook.trim(),
          severity: initialValues?.channels?.teams?.severity ?? 'info',
        },
      },
      trigger_cron: triggerCron,
      is_active: true,
      last_triggered_at: null,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader title={initialValues?.id ? 'Edit Python Alert' : 'New Python Alert'} onClose={onClose} />
      <DialogBody>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">

          {/* Name */}
          <div className="space-y-1.5">
            <Label required>Alert Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Low Balance Alert"
              error={errors.name}
            />
          </div>

          {/* Script */}
          <div className="space-y-2">
            <Label required>Python Script</Label>
            <div className="rounded-lg border border-emerald-800/50 bg-gray-900/60 p-3 text-xs text-gray-400 space-y-1">
              <p className="font-medium text-emerald-400">Script contract</p>
              <p>Print a JSON object as the last line of stdout:</p>
              <pre className="mt-1 text-gray-300 bg-gray-800 rounded p-2 overflow-x-auto">{`import json, os\n\n# Jerasoft DB credentials are injected automatically:\n# os.environ['JERASOFT_HOST'], ['JERASOFT_PORT'],\n# ['JERASOFT_DB'], ['JERASOFT_USER'], ['JERASOFT_PASS']\n\nprint(json.dumps({\n    "triggered": True,        # required\n    "message":  "5 alerts",   # optional\n    "rows":     [{"k": "v"}]  # optional\n}))`}</pre>
              <p><code className="text-gray-300">triggered: true</code> → notification sent &nbsp;|&nbsp; <code className="text-gray-300">false</code> → skipped &nbsp;|&nbsp; error → failed. Timeout: 30 s.</p>
            </div>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={14}
              placeholder={`import json\n\nresult = {"triggered": False, "message": "", "rows": []}\n\n# ... your logic ...\n\nprint(json.dumps(result))`}
              className={`w-full rounded-md border bg-gray-900 px-3 py-2 font-mono text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 resize-y ${
                errors.script
                  ? 'border-red-500 focus:ring-red-500'
                  : 'border-gray-700 focus:ring-emerald-500'
              }`}
            />
            {errors.script && <p className="text-xs text-red-400">{errors.script}</p>}
          </div>

          {/* Trigger — optional */}
          <div className="space-y-1.5">
            <Label>Trigger Schedule <span className="text-gray-500 font-normal">(optional)</span></Label>
            <TriggerPicker value={triggerCron} onChange={setTriggerCron} />
          </div>

          {/* Teams channel — optional. Email recipients for python alerts are code-managed, but the
              Teams webhook is operational config, so it is editable here. */}
          <div className="space-y-1.5">
            <Label>Teams Channel <span className="text-gray-500 font-normal">(optional)</span></Label>
            <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 space-y-2.5">
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={teamsEnabled}
                  onChange={(e) => setTeamsEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800 accent-emerald-500"
                />
                Post the script&apos;s rows to a Teams channel
              </label>
              {teamsEnabled && (
                <div className="space-y-1">
                  <Input
                    value={teamsWebhook}
                    onChange={(e) => setTeamsWebhook(e.target.value)}
                    placeholder="Incoming-webhook URL (empty = TEAMS_DEFAULT_WEBHOOK_URL)"
                  />
                  <p className="text-xs text-gray-500">
                    The channel&apos;s incoming-webhook / Power Automate URL. Leave empty to use the default webhook.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" isLoading={isSubmitting}>Save Alert</Button>
          </div>

        </form>
      </DialogBody>
    </Dialog>
  );
}
