import { VendixHttpException } from '@common/errors';
import { ResolutionsController } from './resolutions.controller';

describe('ResolutionsController scan/async', () => {
  let scanner: { assertReady: jest.Mock };
  let jobs: { enqueue: jest.Mock };
  let controller: ResolutionsController;
  const response = { success: jest.fn((d) => d) };
  const file = (mimetype: string) =>
    ({ buffer: Buffer.from('x'), mimetype, originalname: 'a', size: 1 }) as Express.Multer.File;

  beforeEach(() => {
    scanner = { assertReady: jest.fn().mockResolvedValue(undefined) };
    jobs = { enqueue: jest.fn().mockResolvedValue({ job_id: '9' }) };
    controller = new ResolutionsController({} as any, response as any, scanner as any, jobs as any);
  });

  it('rejects invalid mime without enqueuing', async () => {
    await expect(controller.scanAsync(file('text/plain'))).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue when assertReady fails', async () => {
    const err = new Error('no vision');
    scanner.assertReady.mockRejectedValue(err);
    await expect(controller.scanAsync(file('application/pdf'))).rejects.toBe(err);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues dian_resolution and answers job_id', async () => {
    const f = file('image/jpeg');
    await expect(controller.scanAsync(f)).resolves.toEqual({ job_id: '9' });
    expect(jobs.enqueue).toHaveBeenCalledWith('dian_resolution', [f]);
  });
});
