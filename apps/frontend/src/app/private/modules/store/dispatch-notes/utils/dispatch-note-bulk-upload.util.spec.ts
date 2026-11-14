import {
  DispatchNoteExcelUpload,
  buildDispatchNoteBulkUploadRequests,
} from './dispatch-note-bulk-upload.util';

describe('buildDispatchNoteBulkUploadRequests (QUI-1004)', () => {
  const upload = (over: Partial<DispatchNoteExcelUpload> = {}): DispatchNoteExcelUpload => ({
    file_name: 'recibo.xlsx',
    file_hash: 'a'.repeat(64),
    total_rows: 4,
    failed_rows: 1,
    loaded_rows: 3,
    ...over,
  });

  it('registra el Excel de la remisión con sus conteos y el número de la remisión', () => {
    expect(buildDispatchNoteBulkUploadRequests([upload()], 3, 'RM-0007')).toEqual([
      {
        upload_type: 'dispatch_notes',
        file_name: 'recibo.xlsx',
        file_hash: 'a'.repeat(64),
        total_rows: 4,
        successful_rows: 3,
        failed_rows: 1,
        skipped_rows: 0,
        result_reference: 'RM-0007',
      },
    ]);
  });

  it('las filas que no llegaron a la remisión cuentan como omitidas', () => {
    const [request] = buildDispatchNoteBulkUploadRequests([upload()], 2, 'RM-0007');
    expect(request.successful_rows).toBe(2);
    expect(request.skipped_rows).toBe(1);
  });

  it('dos archivos en la misma remisión: una fila por archivo, líneas repartidas en orden', () => {
    const requests = buildDispatchNoteBulkUploadRequests(
      [upload(), upload({ file_name: 'b.xlsx', file_hash: 'b'.repeat(64), loaded_rows: 2, total_rows: 2, failed_rows: 0 })],
      4,
      'RM-0008',
    );
    expect(requests.map((r) => [r.file_name, r.successful_rows, r.skipped_rows])).toEqual([
      ['recibo.xlsx', 3, 0],
      ['b.xlsx', 1, 1],
    ]);
  });

  it('sin huella no registra nada', () => {
    expect(buildDispatchNoteBulkUploadRequests([upload({ file_hash: null })], 3, 'RM-1')).toEqual([]);
  });
});
