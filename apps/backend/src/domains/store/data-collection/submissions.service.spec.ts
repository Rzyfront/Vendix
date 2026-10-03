import { SubmissionsService } from './submissions.service';

const flush = () => new Promise<void>((r) => setImmediate(r));

describe('SubmissionsService.submitFinal prediagnosis (fire-and-forget)', () => {
  let service: SubmissionsService;
  let aiEngine: { getApplication: jest.Mock; run: jest.Mock };
  let savePrediagnosis: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    const submission = {
      id: 7,
      token: 't',
      status: 'pending',
      store_id: 1,
      template_id: 3,
      booking_id: null,
      customer_id: null,
      booking: null,
    };
    const db = {
      data_collection_submissions: {
        findUnique: jest.fn().mockResolvedValue(submission),
        update: jest.fn().mockResolvedValue({ ...submission, status: 'completed' }),
      },
      data_collection_templates: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const prisma = { withoutScope: () => db };
    aiEngine = {
      getApplication: jest.fn().mockResolvedValue({ is_active: true }),
      run: jest.fn(),
    };
    service = new SubmissionsService(
      prisma as any,
      {} as any,
      { emit: jest.fn() } as any,
      aiEngine as any,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 7 } as any);
    jest.spyOn(service, 'buildPrediagnosisVariables').mockResolvedValue({} as any);
    savePrediagnosis = jest
      .spyOn(service, 'savePrediagnosis')
      .mockResolvedValue(undefined as any);
    loggerError = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
  });

  it('resolves even if aiEngine.run never resolves', async () => {
    aiEngine.run.mockReturnValue(new Promise(() => undefined));
    await expect(service.submitFinal('t')).resolves.toMatchObject({
      status: 'completed',
    });
    expect(savePrediagnosis).not.toHaveBeenCalled();
  });

  it('saves result.content when run resolves', async () => {
    aiEngine.run.mockResolvedValue({ success: true, content: 'X' });
    await service.submitFinal('t');
    await flush();
    expect(savePrediagnosis).toHaveBeenCalledWith(7, 'X');
  });

  it('logs an error with the submission id when run rejects', async () => {
    aiEngine.run.mockRejectedValue(new Error('boom'));
    await expect(service.submitFinal('t')).resolves.toBeDefined();
    await flush();
    expect(savePrediagnosis).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('submission 7'),
      expect.anything(),
    );
  });
});
