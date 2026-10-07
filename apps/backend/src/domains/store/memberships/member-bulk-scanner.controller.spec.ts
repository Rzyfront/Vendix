import { MemberBulkScannerController } from './member-bulk-scanner.controller';
import { MemberBulkScannerService } from './member-bulk-scanner.service';
import { VendixHttpException } from '@common/errors';

describe('MemberBulkScannerController.scanAsync', () => {
  let controller: MemberBulkScannerController;
  let jobs: any;
  let response: any;

  const file = (mimetype = 'image/jpeg') =>
    ({
      buffer: Buffer.from('x'),
      mimetype,
      originalname: 'r.jpg',
      size: 1,
    }) as Express.Multer.File;

  beforeEach(() => {
    const scanner = Object.create(MemberBulkScannerService.prototype);
    jobs = { enqueue: jest.fn().mockResolvedValue({ job_id: 'j3' }) };
    response = { success: jest.fn((d) => ({ success: true, data: d })) };
    controller = new MemberBulkScannerController(scanner, jobs, response);
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

  it('OK -> enqueue member_roster y devuelve job_id', async () => {
    const res = await controller.scanAsync(file());
    expect(jobs.enqueue).toHaveBeenCalledWith(
      'member_roster',
      [expect.objectContaining({ mimeType: 'image/jpeg' })],
      {},
    );
    expect(res).toEqual({ success: true, data: { job_id: 'j3' } });
  });
});
