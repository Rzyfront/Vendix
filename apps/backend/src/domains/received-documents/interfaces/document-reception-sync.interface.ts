import { Prisma } from '@prisma/client';
import { ReceivedDocumentsContext } from '../received-documents.service';

export type DocumentReceptionRunTrigger = 'manual' | 'scheduler' | 'webhook';

export interface ClaimDocumentReceptionRunInput {
  trigger: DocumentReceptionRunTrigger;
  idempotency_key: string;
  expected_version?: number;
  input_payload?: Prisma.InputJsonValue;
  payload_sha256?: string;
}

export interface ClaimDocumentReceptionRunResult {
  run_id: number;
  duplicate: boolean;
}

export type DocumentReceptionConnectionRecord =
  Prisma.document_reception_connectionsGetPayload<{}>;

export interface StartDocumentReceptionRunResult {
  run_id: number;
  connection_id: number;
  connection_version: number;
  lease_token: string;
  connection: DocumentReceptionConnectionRecord;
  context: ReceivedDocumentsContext;
  cursor_before: string | null;
  input_payload: Prisma.JsonValue | null;
  payload_sha256: string | null;
}

export interface FinishDocumentReceptionRunInput {
  received_count: number;
  duplicate_count: number;
  error_count: number;
  document_ids?: number[];
  error_codes?: string[];
  next_cursor: string | null;
  failed?: boolean;
  continue_immediately?: boolean;
}
