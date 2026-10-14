import type { ReceivedDocument, ReceivedDocumentQuery, ReceivedDocumentsScope } from './received-documents.interface';

export function receivedInboxRefreshDelay(failures: number): number {
  return failures <= 0 ? 30_000 : Math.min(300_000, 30_000 * 2 ** Math.min(failures, 4));
}
export function receivedInboxCanPoll(visible: boolean, online: boolean, ready: boolean): boolean {
  return visible && online && ready;
}
export function receivedInboxContextKey(scope: ReceivedDocumentsScope, query: ReceivedDocumentQuery, tenantKey = ''): string {
  return JSON.stringify([scope, tenantKey, ...Object.entries(query).sort(([a], [b]) => a.localeCompare(b))]);
}

const STATUS_FIELDS = [
  'inbox_state', 'legal_status', 'event_delivery_status', 'blocking_reasons',
  'processing_status', 'validation_status', 'structural_validation_status', 'signature_validation_status',
  'dian_validation_status', 'review_status', 'matching_status', 'fiscal_status', 'posting_status',
  'accepted_at', 'confirmed_goods_at', 'updated_at', 'version',
] as const;

/** While an operator is working, update compact status only; do not reorder/remove rows or replace drafts. */
export function receivedInboxProtectedRows(current: ReceivedDocument[], incoming: ReceivedDocument[]): ReceivedDocument[] {
  const byId = new Map(incoming.map((row) => [row.id, row]));
  return current.map((row) => {
    const update = byId.get(row.id);
    if (!update) return row;
    const patch = Object.fromEntries(STATUS_FIELDS.filter((key) => update[key] !== undefined).map((key) => [key, update[key]]));
    return { ...row, ...patch };
  });
}
export function receivedInboxNewRowCount(current: ReceivedDocument[], incoming: ReceivedDocument[]): number {
  const ids = new Set(current.map((row) => row.id));
  return incoming.filter((row) => !ids.has(row.id)).length;
}
export function receivedInboxMembershipChanged(current: ReceivedDocument[], incoming: ReceivedDocument[]): boolean {
  return current.length !== incoming.length || current.some((row, index) => row.id !== incoming[index]?.id);
}
