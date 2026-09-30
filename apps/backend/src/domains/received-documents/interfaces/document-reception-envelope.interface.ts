export type DocumentReceptionEnvelopeMimeType =
  | 'application/xml'
  | 'text/xml'
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp';

export interface DocumentReceptionEnvelopeDocument {
  external_id: string;
  file_name: string;
  mime_type: DocumentReceptionEnvelopeMimeType;
  content: Buffer;
}

/** Decoded, validated provider payload; tenant identity is supplied out-of-band. */
export interface DocumentReceptionEnvelope {
  version: 1;
  documents: DocumentReceptionEnvelopeDocument[];
  next_cursor: string | null;
}
