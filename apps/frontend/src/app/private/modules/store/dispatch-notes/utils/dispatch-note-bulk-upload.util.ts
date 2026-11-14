import type { RegisterBulkUploadRequest } from '../../bulk-uploads/bulk-upload-log.interface';

/**
 * QUI-1004 — an Excel file imported into a purchase-receipt dispatch note
 * (wizard «Excel» mode). The browser reads the file, so the client registers
 * it once the note is created; only these counts are kept, never the rows.
 */
export interface DispatchNoteExcelUpload {
  file_name: string;
  /** SHA-256 fingerprint; `null` when the browser could not compute it. */
  file_hash: string | null;
  /** Non-empty data rows (header excluded). */
  total_rows: number;
  /** Non-empty rows without a product name: not imported. */
  failed_rows: number;
  /** Rows sent to the item list (linked now or queued «por vincular»). */
  loaded_rows: number;
}

/**
 * One register request per Excel file, against the created note. The note
 * lines are allotted to the files in upload order (each file at most its own
 * loaded rows); a loaded row that did not reach the note (left unlinked,
 * removed or merged into an existing line) counts as skipped. Files without
 * a fingerprint are not registered (nothing is invented).
 */
export function buildDispatchNoteBulkUploadRequests(
  uploads: readonly DispatchNoteExcelUpload[],
  noteLineCount: number,
  reference: string | null | undefined,
): RegisterBulkUploadRequest[] {
  let remaining = Math.max(0, noteLineCount);
  const requests: RegisterBulkUploadRequest[] = [];
  for (const upload of uploads) {
    const successful_rows = Math.min(upload.loaded_rows, remaining);
    remaining -= successful_rows;
    if (!upload.file_hash) continue;
    requests.push({
      upload_type: 'dispatch_notes',
      file_name: upload.file_name,
      file_hash: upload.file_hash,
      total_rows: upload.total_rows,
      successful_rows,
      failed_rows: upload.failed_rows,
      skipped_rows: upload.loaded_rows - successful_rows,
      ...(reference ? { result_reference: reference } : {}),
    });
  }
  return requests;
}
