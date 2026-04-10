export interface QueueEntryEvent {
  store_id: number;
  entry_id: number;
  token: string;
  position?: number;
  first_name: string;
  last_name: string;
  document_number: string;
  status: string;
}
