import { VendixHttpException } from '@common/errors';
import { RutScannerController } from './rut-scanner.controller';

describe('RutScannerController async', () => {
  let scanner: { assertReady: jest.Mock };
  let jobs: { enqueue: jest.Mock };
  let controller: RutScannerController;
  const response = { success: jest.fn((d) => d), error: jest.fn() };
  const file = (mimetype: string) =>
    ({ buffer: Buffer.from('x'), mimetype, originalname: 'a', size: 1 }) as Express.Multer.File;

  beforeEach(() => {
    scanner = { assertReady: jest.fn().mockResolvedValue(undefined) };
    jobs = { enqueue: jest.fn().mockResolvedValue({ job_id: '7' }) };
    controller = new RutScannerController(scanner as any, jobs as any, response as any);
  });

  it('rejects invalid mime with 400 without enqueuing', async () => {
    await expect(controller.scanRutAsync(file('text/plain'))).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue when assertReady fails', async () => {
    const err = new VendixHttpException('RUT_SCAN_AI_FAIL' as any);
    scanner.assertReady.mockRejectedValue(err);
    await expect(controller.scanRutAsync(file('application/pdf'))).rejects.toBe(err);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues kind rut and answers job_id', async () => {
    const f = file('image/png');
    const res = await controller.scanRutAsync(f);
    expect(jobs.enqueue).toHaveBeenCalledWith('rut', [f]);
    expect(res).toEqual({ job_id: '7' });
  });
});
