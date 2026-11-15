import { InventoryAdjustmentsController } from './inventory-adjustments.controller';
import { InventoryCountScannerService } from './inventory-count-scanner.service';
import { VendixHttpException } from '@common/errors';

describe('InventoryAdjustmentsController.scanCountAsync', () => {
  let controller: InventoryAdjustmentsController;
  let jobs: any;
  let response: any;

  const file = (mimetype = 'image/jpeg') =>
    ({
      buffer: Buffer.from('x'),
      mimetype,
      originalname: 'c.jpg',
      size: 1,
    }) as Express.Multer.File;

  beforeEach(() => {
    const scanner = Object.create(InventoryCountScannerService.prototype);
    jobs = { enqueue: jest.fn().mockResolvedValue({ job_id: 'j2' }) };
    response = { success: jest.fn((d) => ({ success: true, data: d })) };
    controller = new InventoryAdjustmentsController(
      {} as any,
      {} as any,
      scanner,
      jobs,
      response,
      {} as any,
    );
  });

  it('mime invalido -> error sin encolar', async () => {
    await expect(
      controller.scanCountAsync(file('text/plain'), '5'),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'abc', '0', '-3', '1.5'])(
    'location_id %p invalido -> error sin encolar',
    async (loc) => {
      await expect(
        controller.scanCountAsync(file(), loc as any),
      ).rejects.toBeInstanceOf(VendixHttpException);
      expect(jobs.enqueue).not.toHaveBeenCalled();
    },
  );

  it('OK -> enqueue inventory_count con {location_id} y devuelve job_id', async () => {
    const res = await controller.scanCountAsync(file(), '5');
    expect(jobs.enqueue).toHaveBeenCalledWith(
      'inventory_count',
      [expect.objectContaining({ mimeType: 'image/jpeg' })],
      { location_id: 5 },
    );
    expect(res).toEqual({ success: true, data: { job_id: 'j2' } });
  });
});

describe('InventoryAdjustmentsController.uploadBulkAdjustments (QUI-1004)', () => {
  it('la carga directa queda en el registro de cargas masivas', async () => {
    const result = { success: true, total_processed: 3, successful: 2, failed: 1, results: [] };
    const bulkService = { uploadFromFile: jest.fn().mockResolvedValue(result) };
    const fileInfo = { file_name: 'ajustes.xlsx', file_hash: 'c'.repeat(64), duplicate_of: null };
    const logs = {
      describeFile: jest.fn().mockResolvedValue(fileInfo),
      trackUpload: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new InventoryAdjustmentsController(
      {} as any,
      bulkService as any,
      {} as any,
      {} as any,
      { success: jest.fn((d) => ({ success: true, data: d })) } as any,
      logs as any,
    );
    const file = { buffer: Buffer.from('x'), originalname: 'ajustes.xlsx' };
    await controller.uploadBulkAdjustments(file, {} as any);
    expect(logs.describeFile).toHaveBeenCalledWith(
      'inventory_adjustments',
      file.buffer,
      'ajustes.xlsx',
    );
    expect(logs.trackUpload).toHaveBeenCalledWith('inventory_adjustments', fileInfo, result);
  });
});
