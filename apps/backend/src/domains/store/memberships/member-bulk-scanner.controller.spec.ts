import {
  MemberBulkScannerController,
  rosterUploadCounts,
} from './member-bulk-scanner.controller';
import { MemberBulkScannerService } from './member-bulk-scanner.service';
import { VendixHttpException } from '@common/errors';
import * as XLSX from 'xlsx';

describe('MemberBulkScannerController.scanAsync', () => {
  let controller: MemberBulkScannerController;
  let jobs: any;
  let response: any;
  let scanner: any;
  let bulkUploadLogs: any;
  const FILE_INFO = {
    file_name: 'r.jpg',
    file_hash: 'a'.repeat(64),
    duplicate_of: null,
  };

  // The real type is read from the bytes (ai-ingest detector), not the mimetype.
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  const file = (
    mimetype = 'image/jpeg',
    buffer: Buffer = JPEG,
    originalname = 'r.jpg',
  ) =>
    ({
      buffer,
      mimetype,
      originalname,
      size: buffer.length,
    }) as Express.Multer.File;

  beforeEach(() => {
    scanner = Object.create(MemberBulkScannerService.prototype);
    jobs = { enqueue: jest.fn().mockResolvedValue({ job_id: 'j3' }) };
    response = { success: jest.fn((d) => ({ success: true, data: d })) };
    bulkUploadLogs = {
      describeFile: jest.fn().mockResolvedValue(FILE_INFO),
      trackUpload: jest.fn().mockResolvedValue(undefined),
      trackSessionPage: jest.fn().mockResolvedValue(undefined),
    };
    controller = new MemberBulkScannerController(
      scanner,
      jobs,
      response,
      bulkUploadLogs,
    );
  });

  it('tipo invalido (por sus bytes) -> 400 sin encolar', async () => {
    await expect(
      controller.scanAsync(file('image/jpeg', Buffer.from([0, 1, 2, 0]), 'r.bin')),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('foto HEIC que el servidor no decodifica -> mensaje claro sin encolar', async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(16)]);
    await expect(controller.scanAsync(file('image/heic', heic, 'r.heic'))).rejects.toMatchObject({
      errorCode: 'AI_INGEST_UNSUPPORTED_TYPE',
    });
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('ia-cargas F2: acepta una hoja de cálculo y la encola', async () => {
    const csv = Buffer.from('nombre;documento;plan\nAna Lopez;123;Mensual\n');
    await controller.scanAsync(file('text/csv', csv, 'socios.csv'));
    expect(jobs.enqueue).toHaveBeenCalledWith(
      'member_roster',
      [expect.objectContaining({ originalName: 'socios.csv' })],
      {},
    );
  });

  it('P0 #1291: el escaneo síncrono rechaza un xlsx declarado como image/png (400, sin parsear)', async () => {
    const xlsx = XLSX.write(
      (() => {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['nombre'], ['Ana']]), 'S');
        return wb;
      })(),
      { type: 'buffer', bookType: 'xlsx' },
    ) as Buffer;
    const scanRoster = jest.spyOn(scanner, 'scanRoster');

    const error = await controller
      .scan(file('image/png', xlsx, 'socios.png'))
      .catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error).toMatchObject({ errorCode: 'MEMBER_SCAN_INVALID_FILE' });
    expect(error.getStatus()).toBe(400);
    expect(scanRoster).not.toHaveBeenCalled();
  });

  it('P0 #1291: el escaneo síncrono sigue aceptando imágenes reales', async () => {
    const scanRoster = jest
      .spyOn(scanner, 'scanRoster')
      .mockResolvedValue({ members: [] } as any);

    await controller.scan(file());

    expect(scanRoster).toHaveBeenCalledTimes(1);
    expect(response.success).toHaveBeenCalled();
  });

  it('sin archivo -> error sin encolar', async () => {
    await expect(controller.scanAsync(undefined)).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('OK -> enqueue member_roster y devuelve job_id con la huella del archivo (QUI-1004)', async () => {
    const res = await controller.scanAsync(file());
    expect(jobs.enqueue).toHaveBeenCalledWith(
      'member_roster',
      [expect.objectContaining({ mimeType: 'image/jpeg' })],
      {},
    );
    expect(bulkUploadLogs.describeFile).toHaveBeenCalledWith(
      'memberships',
      expect.any(Buffer),
      'r.jpg',
    );
    expect(res).toEqual({
      success: true,
      data: { job_id: 'j3', ...FILE_INFO },
    });
  });

  it('commit registra la carga del padrón con sus conteos (QUI-1004)', async () => {
    scanner.commitRoster = jest.fn().mockResolvedValue({
      ready: 4,
      succeeded: 2,
      failed: 1,
      results: [
        { row_number: 1, status: 'success' },
        { row_number: 2, status: 'success' },
        { row_number: 3, status: 'error' },
        { row_number: 4, status: 'skipped' },
      ],
      plan_errors: [],
    });
    const dto: any = {
      plans: [],
      members: [],
      file_name: 'padron.pdf',
      file_hash: FILE_INFO.file_hash,
    };
    await controller.commit(dto);
    expect(bulkUploadLogs.trackUpload).toHaveBeenCalledWith('memberships', dto, {
      total: 4,
      successful: 2,
      failed: 1,
      skipped: 1,
    });
  });

  it('ia-cargas F2: un padrón en tramos suma en UNA fila del registro (session_id)', async () => {
    scanner.commitRoster = jest.fn().mockResolvedValue({
      ready: 2,
      succeeded: 2,
      failed: 0,
      results: [
        { row_number: 201, status: 'success' },
        { row_number: 202, status: 'success' },
      ],
      plan_errors: [],
    });
    const dto: any = {
      plans: [],
      members: [{}, {}],
      file_name: 'padron.xlsx',
      file_hash: FILE_INFO.file_hash,
      session_id: 'sess-1',
      total_members: 900,
    };
    await controller.commit(dto);
    expect(bulkUploadLogs.trackUpload).not.toHaveBeenCalled();
    expect(bulkUploadLogs.trackSessionPage).toHaveBeenCalledWith('memberships', 'sess-1', dto, {
      total: 900,
      successful: 2,
      failed: 0,
      skipped: 0,
    });
  });
});

describe('rosterUploadCounts', () => {
  it('si fallan los planes no se persiste nada: todo cuenta como error', () => {
    expect(
      rosterUploadCounts({
        ready: 3,
        succeeded: 0,
        failed: 0,
        results: [],
        plan_errors: [{ ref_index: 0, error: 'x' }],
      }),
    ).toEqual({ total: 3, successful: 0, failed: 3, skipped: 0 });
  });
});
