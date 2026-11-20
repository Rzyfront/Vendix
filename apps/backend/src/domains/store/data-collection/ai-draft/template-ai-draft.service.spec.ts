import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { AiScanJobService } from '@common/ai-scan-jobs/ai-scan-job.service';
import { AiScanHandlerRegistry } from '@common/ai-scan-jobs/ai-scan-handler.registry';
import {
  TEMPLATE_DRAFT_MAX_BYTES,
  TEMPLATE_DRAFT_SCAN_KIND,
  TemplateAiDraftService,
  checkTemplateDraftUpload,
  toTemplateAiDraftStatus,
} from './template-ai-draft.service';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const upload = (over: Partial<Express.Multer.File> = {}) =>
  ({ buffer: PDF, mimetype: 'application/pdf', size: PDF.length, originalname: 'ficha.pdf', ...over }) as Express.Multer.File;

describe('checkTemplateDraftUpload', () => {
  it('accepts a PDF and a PNG whose bytes match', () => {
    expect(checkTemplateDraftUpload(upload())).toBeNull();
    expect(checkTemplateDraftUpload(upload({ buffer: PNG, mimetype: 'image/png', size: PNG.length, originalname: 'foto.png' }))).toBeNull();
  });

  it('rejects a missing or empty file', () => {
    expect(checkTemplateDraftUpload(undefined)).toContain('Sube un PDF o una foto');
    expect(checkTemplateDraftUpload(upload({ buffer: Buffer.alloc(0), size: 0 }))).toContain('Sube un PDF o una foto');
  });

  it('rejects an unsupported type (Word, HEIC)', () => {
    expect(checkTemplateDraftUpload(upload({ mimetype: 'application/msword', originalname: 'ficha.doc' }))).toContain('Formato no soportado');
    expect(checkTemplateDraftUpload(upload({ mimetype: 'image/heic', originalname: 'foto.heic' }))).toContain('HEIC');
  });

  it('rejects a file over 10 MB', () => {
    const big = Buffer.concat([PDF, Buffer.alloc(TEMPLATE_DRAFT_MAX_BYTES)]);
    expect(checkTemplateDraftUpload(upload({ buffer: big, size: big.length }))).toContain('10 MB');
  });

  it('rejects bytes that do not match the declared type and a mismatching extension', () => {
    expect(checkTemplateDraftUpload(upload({ buffer: Buffer.from('<html>pdf</html>') }))).toContain('no coincide con su tipo');
    expect(checkTemplateDraftUpload(upload({ originalname: 'ficha.png' }))).toContain('extensión');
  });
});

describe('toTemplateAiDraftStatus', () => {
  it('maps queue states to pending | done | failed', () => {
    expect(toTemplateAiDraftStatus({ status: 'waiting' })).toEqual({ status: 'pending' });
    expect(toTemplateAiDraftStatus({ status: 'active' })).toEqual({ status: 'pending' });
    expect(
      toTemplateAiDraftStatus({ status: 'completed', result: { json: { name: 'x' }, errors: [{ path: 'name', message: 'm' }] } }),
    ).toEqual({ status: 'done', json: { name: 'x' }, errors: [{ path: 'name', message: 'm' }] });
  });

  it('explains a missing vision model and an exhausted plan quota', () => {
    expect(toTemplateAiDraftStatus({ status: 'failed', error: 'AI_VISION_001' })).toMatchObject({
      status: 'failed',
      error_code: 'AI_VISION_001',
      error_reason: 'not_configured',
      message: expect.stringContaining('modelo de IA con visión'),
    });
    expect(toTemplateAiDraftStatus({ status: 'failed', error: 'SUBSCRIPTION_005' })).toMatchObject({
      error_reason: 'plan_quota',
      message: expect.stringContaining('cuota de IA'),
    });
    expect(toTemplateAiDraftStatus({ status: 'failed', error: 'DCOL_AI_003' })).toMatchObject({
      error_code: 'DCOL_AI_003',
      message: expect.stringContaining('menos páginas'),
    });
    expect(toTemplateAiDraftStatus({ status: 'failed', error: 'socket hang up' })).toMatchObject({
      error_code: null,
      message: expect.stringContaining('Inténtalo de nuevo'),
    });
  });
});

describe('TemplateAiDraftService', () => {
  const ownerCtx = { store_id: 7, organization_id: 3, user_id: 11, is_super_admin: false, request_id: 'r1' };

  function makeService() {
    const jobsStore = new Map<string, { id: string; data: unknown; state: string; returnvalue?: unknown }>();
    const queue = {
      add: jest.fn(async (_name: string, data: unknown) => {
        const id = String(jobsStore.size + 1);
        jobsStore.set(id, { id, data, state: 'completed', returnvalue: { json: { name: 'Ficha' }, errors: [] } });
        return { id };
      }),
      getJob: jest.fn(async (id: string) => {
        const job = jobsStore.get(id);
        return job ? { ...job, getState: async () => job.state } : undefined;
      }),
    };
    const s3 = { uploadFile: jest.fn(async (_b: Buffer, key: string) => key) };
    const monitor = { describe: jest.fn(async () => ({})) };
    const jobs = new AiScanJobService(queue as never, s3 as never, monitor as never);
    const aiEngine = { assertVisionModelLinked: jest.fn().mockResolvedValue(undefined), run: jest.fn() };
    const registry = new AiScanHandlerRegistry();
    const service = new TemplateAiDraftService(aiEngine as never, { prepare: jest.fn() } as never, registry, jobs);
    return { service, queue, s3, aiEngine, registry, jobsStore };
  }

  const asStore = <T>(ctx: Record<string, unknown>, fn: () => Promise<T>) =>
    RequestContextService.run({ is_owner: false, ...ctx } as never, fn);

  it('registers the data_collection_template handler once', () => {
    const { service, registry } = makeService();
    service.onModuleInit();
    expect(registry.get(TEMPLATE_DRAFT_SCAN_KIND)).toBeDefined();
  });

  it('rejects an invalid file with DCOL_AI_001 before uploading or enqueuing', async () => {
    const { service, queue, s3 } = makeService();
    await expect(
      asStore(ownerCtx, () => service.enqueue(upload({ buffer: Buffer.from('MZ\x90\x00'), size: 4 }))),
    ).rejects.toMatchObject({ errorCode: 'DCOL_AI_001' });
    expect(s3.uploadFile).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('answers AI_VISION_001 without enqueuing when the store has no vision model', async () => {
    const { service, queue, aiEngine } = makeService();
    aiEngine.assertVisionModelLinked.mockRejectedValue(new VendixHttpException(ErrorCodes.AI_VISION_001));
    await expect(asStore(ownerCtx, () => service.enqueue(upload()))).rejects.toMatchObject({ errorCode: 'AI_VISION_001' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('enqueues under the store prefix and only the creating store reads the draft', async () => {
    const { service, queue, s3 } = makeService();
    const { job_id } = await asStore(ownerCtx, () => service.enqueue(upload()));

    expect(queue.add).toHaveBeenCalledWith(TEMPLATE_DRAFT_SCAN_KIND, expect.anything(), expect.anything());
    expect(s3.uploadFile.mock.calls[0][1]).toMatch(/^ai-scans\/3\/store-7\/data_collection_template\//);

    await expect(asStore(ownerCtx, () => service.getStatus(job_id))).resolves.toEqual({
      status: 'done',
      json: { name: 'Ficha' },
      errors: [],
    });
    // Another store of the same organization, same user id: same 404 as an unknown job.
    await expect(asStore({ ...ownerCtx, store_id: 8 }, () => service.getStatus(job_id))).rejects.toMatchObject({
      errorCode: 'AI_QUEUE_002',
    });
    await expect(asStore(ownerCtx, () => service.getStatus('999'))).rejects.toMatchObject({ errorCode: 'AI_QUEUE_002' });
  });

  it('does not expose jobs of another ai-scan kind through this endpoint', async () => {
    const { service, jobsStore } = makeService();
    jobsStore.set('42', {
      id: '42',
      state: 'completed',
      data: { kind: 'customer_import', context: ownerCtx, file_keys: [], params: {} },
      returnvalue: { customers: [] },
    });
    await expect(asStore(ownerCtx, () => service.getStatus('42'))).rejects.toMatchObject({ errorCode: 'AI_QUEUE_002' });
  });
});
