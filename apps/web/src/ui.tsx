import { z } from 'zod';
import type { ReactNode } from 'react';
import { Icon, Button, Dialog, type IconName } from './design-system';
import type { Entrant as RunEntrant } from '../../../packages/contracts/src/configured-runs.ts';
import type { Entrant } from './design-system';
export async function api<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data: unknown = await response.json();
  if (!response.ok) {
    const parsed = z
      .object({ error: z.string(), issues: z.array(z.object({ message: z.string() })).optional() })
      .safeParse(data);
    throw new Error(
      parsed.success ? (parsed.data.issues?.map((i) => i.message).join('; ') ?? parsed.data.error) : 'Request failed',
    );
  }
  return schema.parse(data);
}
export const Okay = z.object({ ok: z.literal(true) });
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Request failed');
export const runLabel = (n: number) => `Run ${String(n).padStart(4, '0')}`;
export const shortDateTime = (value: string) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(value));
export const shortDate = (value: string) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric',
}).format(new Date(value));
export function entrantTag(e: RunEntrant): Entrant {
  const effort =
    e.harness === 'codex'
      ? e.settings.reasoningEffort
      : e.harness === 'claude'
        ? e.settings.effort
        : e.settings.variant;
  return {
    app: e.harness,
    model: e.model,
    effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort ?? '') ? (effort as Entrant['effort']) : 'auto',
  };
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <h2>{title}</h2>
      <div className="muted">{children}</div>
      {action}
    </section>
  );
}
export function Confirm({
  title,
  children,
  label,
  onClose,
  onConfirm,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  label: string;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog open onClose={onClose} title={title} size="sm">
      <p>{children}</p>
      <div className="actions end">
        <Button onClick={onClose} disabled={busy}>
          Keep it
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {label}
        </Button>
      </div>
    </Dialog>
  );
}
export function Notice({ error }: { error: string }) {
  return error ? (
    <p className="notice danger" role="alert">
      <Icon name="review" />
      {error}
    </p>
  ) : null;
}
