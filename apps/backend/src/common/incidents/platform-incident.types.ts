export type PlatformIncidentSeverity = 'warning' | 'critical';

/**
 * Input of `PlatformIncidentService.report`. Generic on purpose: the bulk
 * upload jobs (QUI-1009) and the API monitoring bot (QUI-1010) both feed it.
 */
export interface PlatformIncidentInput {
  /** Stable identity of the incident: the same key never opens two tickets inside the dedupe TTL. */
  dedupeKey: string;
  /** Where it came from, e.g. `bulk_upload_job`. Becomes `source_channel` and a ticket tag. */
  source: string;
  /** `critical` -> P1, `warning` -> P2. */
  severity: PlatformIncidentSeverity;
  title: string;
  summary: string;
  /** Label -> value lines for the ticket description (visible to the organization: no secrets, no stack). */
  details?: Record<string, string | number | boolean | null | undefined>;
  /** Only goes into the e-mail to Vendix (first 10 lines). Never into the ticket. */
  stack?: string | null;
  tags?: string[];
  organizationId: number;
  storeId?: number | null;
  /** Ticket creator; falls back to the first active super_admin. */
  userId?: number | null;
  errorCode?: string | null;
  correlationId?: string | null;
  /** Defaults to 7 days. */
  dedupeTtlSeconds?: number;
}

export interface PlatformIncidentResult {
  ticketNumber: string | null;
  /** `true` only for the call that opened the ticket / sent the e-mail. */
  created: boolean;
  emailed: number;
}
