/**
 * Seam between template rendering (P4.1/P4.5) and the signature seal (P4.2).
 * The seal never edits the issued PDF: it renders the document again from its
 * frozen template version and data snapshot, with each signature drawn in its
 * box, and appends the evidence sheet.
 */

/** A drawn signature to place in a template signature box. */
export interface SignatureStamp {
  /** `signature_slots[].key` of the template; null = first free box. */
  slot_key: string | null;
  role_label: string | null;
  name: string;
  document_number: string | null;
  /** PNG of the stroke. */
  image: Buffer;
  signed_at: Date;
}

export interface RenderIssuedOptions {
  signatures?: SignatureStamp[];
  /** Extra pages written after the document (the evidence sheet). */
  appendPages?: (doc: PDFKit.PDFDocument) => void | Promise<void>;
}

export abstract class IssuedDocumentRenderer {
  /**
   * Renders an issued document of the current store from its frozen version
   * and `data_snapshot` and returns the PDF bytes. Throws when the document
   * does not exist in the store.
   */
  abstract render(issuedDocumentId: number, options?: RenderIssuedOptions): Promise<Buffer>;
}
