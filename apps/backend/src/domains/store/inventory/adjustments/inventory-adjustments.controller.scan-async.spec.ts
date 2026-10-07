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
