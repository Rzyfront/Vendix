import type { Prisma } from '@prisma/client';
import type { NormalizedReceivedDocument } from './received-document.interface';

export interface ReceivedDocumentScanExtraction {
  normalized: NormalizedReceivedDocument;
  /** Bounded provider JSON for evidence/provenance; never treated as trusted fields. */
  raw_extraction: Prisma.InputJsonObject;
  page_count: number;
  model: string | null;
}
