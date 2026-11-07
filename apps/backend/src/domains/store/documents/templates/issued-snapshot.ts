import { TokenScope } from './template-tokens';
import { DEFAULT_TIMEZONE } from './template-data.service';

/** `issued_documents.data_snapshot`: what the PDF was (and will be) drawn from. */
export interface IssuedSnapshot {
  timezone: string;
  currency: string;
  /** Resolved values by token path. */
  values: Record<string, unknown>;
}

export function snapshotScope(raw: unknown): TokenScope {
  const s = (raw ?? {}) as Partial<IssuedSnapshot>;
  return {
    values: s.values ?? {},
    timezone: s.timezone || DEFAULT_TIMEZONE,
    currency: s.currency || 'COP',
  };
}
