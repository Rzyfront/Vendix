/** State of the inbound webhook of a flow (`GET …/inbound-hook`). The secret is never part of it. */
export interface InboundHookState {
  public_id: string;
  /** Path under the API base, e.g. `/public/workflows/hooks/wfh_…`. */
  path: string;
  is_active: boolean;
  rate_limit_per_minute: number;
  last_used_at: string | null;
  created_at: string;
  recent_requests_24h: number;
}

/** Create / rotate answer: the secret is shown once. */
export interface InboundHookWithSecret extends InboundHookState {
  secret: string;
}

export interface InboundHookPatch {
  is_active?: boolean;
  rate_limit_per_minute?: number;
}

/** State of the mailbox of a flow (`GET …/mailbox`). */
export interface MailboxState {
  address: string;
  is_active: boolean;
  last_received_at: string | null;
  created_at: string;
  received_24h: number;
}
