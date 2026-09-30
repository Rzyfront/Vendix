import type { ReceivedDocumentsContext } from '../received-documents.service';

/** Tenant-scoped, secret-free payload for the received-document OCR worker. */
export interface ReceivedDocumentScanJob {
  document_id: number;
  file_id: number;
  context: ReceivedDocumentsContext & { request_id: string };
}

export interface ReceivedDocumentScanResult {
  document_id: number;
  version: number;
  validation_status: string;
  review_required: true;
  page_count: number;
}

export type ReceivedDocumentScanJobState =
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'completed'
  | 'failed';

export interface ReceivedDocumentScanJobStatus {
  status: ReceivedDocumentScanJobState;
  result?: ReceivedDocumentScanResult;
  error?: string;
  error_code?: string;
}
