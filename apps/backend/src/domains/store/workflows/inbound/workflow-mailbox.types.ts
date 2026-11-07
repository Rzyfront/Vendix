import type { Readable } from 'node:stream';

/**
 * Injection token of the workflow mailbox receiver. The document-reception
 * consumer resolves it lazily through `ModuleRef` (the workflows module
 * already depends on the invoicing module, which depends on reception).
 */
export const WORKFLOW_MAILBOX_RECEIVER = Symbol('WORKFLOW_MAILBOX_RECEIVER');

export interface WorkflowMailboxDelivery {
  /** Full address (`flujos-<hex>@<domain>`), domain already checked by the caller. */
  recipient: string;
  /** SES message id: unique per delivered mail. */
  ses_message_id: string;
  /** `From` header as SES reports it (may carry a display name). */
  from_header: string | null;
  facts: { virus_status: string; spam_status: string };
  /** Opens the raw MIME; only called once the mail passed the cheap checks. */
  openRaw: () => Promise<Readable>;
  signal?: AbortSignal;
}

export type WorkflowMailboxOutcome =
  | { status: 'accepted'; instance_id: number }
  | { status: 'duplicate' | 'ignored' | 'rejected' };

export interface WorkflowMailboxReceiver {
  /** Never throws for a bad mail: it records `rejected` and returns. */
  receive(delivery: WorkflowMailboxDelivery): Promise<WorkflowMailboxOutcome>;
}
