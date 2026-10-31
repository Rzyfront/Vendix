export const CRM_INBOUND_QUEUE = 'crm-inbound';

export interface CrmInboundJob {
  /** `social_webhook_events.id` stored by the webhook. */
  event_id: number;
}
