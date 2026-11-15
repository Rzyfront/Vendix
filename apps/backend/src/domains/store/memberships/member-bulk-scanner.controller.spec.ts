import {
  MemberBulkScannerController,
  rosterUploadCounts,
} from './member-bulk-scanner.controller';
import { MemberBulkScannerService } from './member-bulk-scanner.service';
import { VendixHttpException } from '@common/errors';

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

  const file = (mimetype = 'image/jpeg') =>
    ({
      buffer: Buffer.from('x'),
      mimetype,
      originalname: 'r.jpg',
      size: 1,
    }) as Express.Multer.File;

  beforeEach(() => {
    scanner = Object.create(MemberBulkScannerService.prototype);
    jobs = { enqueue: jest.fn().mockResolvedValue({ job_id: 'j3' }) };
    response = { success: jest.fn((d) => ({ success: true, data: d })) };
    bulkUploadLogs = {
      describeFile: jest.fn().mockResolvedValue(FILE_INFO),
      trackUpload: jest.fn().mockResolvedValue(undefined),
    };
    controller = new MemberBulkScannerController(
      scanner,
      jobs,
      response,
      bulkUploadLogs,
    );
  });

  it('mime invalido -> 400 sin encolar', async () => {
    await expect(controller.scanAsync(file('text/plain'))).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    expect(jobs.enqueue).not.toHaveBeenCalled();
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
