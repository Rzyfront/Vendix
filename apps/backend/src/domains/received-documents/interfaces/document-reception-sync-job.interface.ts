/** Minimal BullMQ transport payload; all tenant/lease data is reloaded from DB. */
export interface DocumentReceptionSyncJob {
  run_id: number;
}
