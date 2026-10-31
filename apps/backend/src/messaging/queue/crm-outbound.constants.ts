export const CRM_OUTBOUND_QUEUE = 'crm-outbound';

export interface CrmOutboundJob {
  /** `crm_messages.id` of an outbound row in status `queued`. */
  message_id: number;
}
