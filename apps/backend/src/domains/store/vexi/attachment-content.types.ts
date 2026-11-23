/**
 * Contract between attachment ingestion (T41, `VexiAttachmentsService`) and the
 * `read_attachment` tool (T43). Vex Plus F6, odd/tasks/vex-agente-avanzado.md §3.5.
 *
 * The extracted content is a *derived* artifact: it is stored as JSON in S3 under
 * `ai_attachments.derived_text_key` and never overwrites the original object.
 */

/** One sheet of a spreadsheet (XLSX) or the single sheet of a CSV. */
export interface AttachmentSheet {
  name: string;
  /** Header row (first non-empty row), stringified. */
  columns: string[];
  /** Data rows, stringified cells, same width as `columns` when possible. */
  rows: string[][];
}

export type AttachmentContent =
  | {
      kind: 'table';
      original_name: string;
      mime_type: string;
      sheets: AttachmentSheet[];
    }
  | {
      kind: 'text';
      original_name: string;
      mime_type: string;
      /** Plain text (DOCX, TXT, PDF text layer). Empty for a scanned PDF. */
      text: string;
      /** PDF page count when known. */
      pages?: number;
      /** PDF pages read before the time limit, only when it stopped early. */
      pages_read?: number;
    }
  | {
      /** Images (and anything without a text layer): use vision / OCR instead. */
      kind: 'image';
      original_name: string;
      mime_type: string;
    };
