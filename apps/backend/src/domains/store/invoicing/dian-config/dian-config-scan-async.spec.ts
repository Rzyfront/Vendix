import { VendixHttpException } from '@common/errors';
import { DianConfigController } from './dian-config.controller';

describe('DianConfigController scan-habilitation/async', () => {
  let scanner: { assertReady: jest.Mock };
  let jobs: { enqueue: jest.Mock };
  let controller: DianConfigController;
  const response = { success: jest.fn((d) => d) };
  const file = (mimetype: string) =>
    ({ buffer: Buffer.from('x'), mimetype, originalname: 'a', size: 1 }) as Express.Multer.File;

  beforeEach(() => {
    scanner = { assertReady: jest.fn().mockResolvedValue(undefined) };
    jobs = { enqueue: jest.fn().mockResolvedValue({ job_id: '3' }) };
    controller = new DianConfigController(
      {} as any, {} as any, {} as any, {} as any,
      response as any, {} as any, scanner as any, jobs as any,
    );
  });

  it('rejects invalid mime without enqueuing', async () => {
    await expect(
      controller.scanHabilitationAsync([file('text/plain')]),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('rejects empty and too many files', async () => {
    await expect(controller.scanHabilitationAsync([])).rejects.toBeInstanceOf(VendixHttpException);
    const many = Array.from({ length: 4 }, () => file('image/png'));
    await expect(controller.scanHabilitationAsync(many)).rejects.toBeInstanceOf(VendixHttpException);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue when assertReady fails', async () => {
    const err = new Error('no vision');
    scanner.assertReady.mockRejectedValue(err);
    await expect(
      controller.scanHabilitationAsync([file('application/pdf')]),
    ).rejects.toBe(err);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues dian_habilitation and answers job_id', async () => {
    const files = [file('image/png'), file('application/pdf')];
    await expect(controller.scanHabilitationAsync(files)).resolves.toEqual({ job_id: '3' });
    expect(jobs.enqueue).toHaveBeenCalledWith('dian_habilitation', files);
  });
});
