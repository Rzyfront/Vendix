import { SubmissionsService } from './submissions.service';
import { VendixHttpException } from '../../../common/errors';
import { SubmissionDocumentsService } from './submission-documents.service';

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
      {} as any,
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

describe('SubmissionsService documents (S3)', () => {
  const PREFIX = 'organizations/acme-2/stores/centro-10/data-collection';
  const FILE_FIELD = 5;
  const doc = (n: string) => ({ key: `${PREFIX}/9/${n}`, name: n, size: 3, mime_type: 'application/pdf' });

  const template = (rules: unknown = { documents: { multiple: false, accept: ['pdf'], max_size_mb: 5 } }) => ({
    tabs: [],
    sections: [
      {
        items: [
          { metadata_field_id: FILE_FIELD, metadata_field: { id: FILE_FIELD, field_type: 'file' }, validation_rules: rules },
          { metadata_field_id: 6, metadata_field: { id: 6, field_type: 'text' }, validation_rules: null },
        ],
        child_sections: [],
      },
    ],
  });

  const FOREIGN_KEY = 'organizations/other-3/stores/x-11/data-collection/1/secret.pdf';

  function build(opts: { rules?: unknown; fieldRows?: Record<number, any>; values?: any[] } = {}) {
    const submission = {
      id: 9,
      token: 't',
      status: 'pending',
      store_id: 10,
      template_id: 3,
      booking_id: 44,
      customer_id: 7,
      booking: { order_id: null },
      expires_at: new Date(Date.now() + 86_400_000),
      template: template(opts.rules),
    };
    const fieldRows = opts.fieldRows ?? {
      [FILE_FIELD]: { id: FILE_FIELD, entity_type: 'customer', field_type: 'file' },
      6: { id: 6, entity_type: 'booking', field_type: 'text' },
    };
    const db = {
      data_collection_submissions: {
        findUnique: jest.fn().mockResolvedValue(submission),
        update: jest.fn().mockResolvedValue(submission),
      },
      entity_metadata_fields: {
        findUnique: jest.fn(async ({ where }: any) => fieldRows[where.id] ?? null),
      },
      stores: {
        findUnique: jest.fn(async (..._args: any[]) => ({ id: 10, slug: 'centro', organizations: { id: 2, slug: 'acme' } })),
      },
    } as Record<string, any>;
    db.withoutScope = () => db;
    const s3 = { signUrl: jest.fn(async (k: string) => `https://signed.example/${k}`), uploadFile: jest.fn(), uploadImage: jest.fn() };
    const s3Path = {
      buildStorePath: (org: any, store: any) => `organizations/${org.slug}-${org.id}/stores/${store.slug}-${store.id}`,
    };
    const documents = new SubmissionDocumentsService(db as any, s3 as any, s3Path as any);
    const metadataValues = {
      setValuesUnscoped: jest.fn(async (..._args: any[]) => []),
      getValuesByStoreAndEntity: jest.fn(async (_s: number, type: string) =>
        (opts.values ?? []).filter((v) => v.entity_type === type),
      ),
    };
    const service = new SubmissionsService(
      db as any,
      metadataValues as any,
      { emit: jest.fn() } as any,
      {} as any,
      documents,
    );
    return { service, metadataValues, db };
  }

  it('saveStepResponses stores { files } and the first key, on the entity resolved for the field', async () => {
    const { service, metadataValues } = build();
    await service.saveStepResponses('t', 0, [
      { field_id: FILE_FIELD, value_json: { files: [doc('1-a.pdf')] } },
    ] as any);
    expect(metadataValues.setValuesUnscoped).toHaveBeenCalledWith(10, 'customer', 7, [
      expect.objectContaining({
        field_id: FILE_FIELD,
        value_text: `${PREFIX}/9/1-a.pdf`,
        value_json: { files: [doc('1-a.pdf')] },
      }),
    ]);
  });

  it('saveStepResponses rejects foreign-store keys and, with multiple=false, two files', async () => {
    const { service, metadataValues } = build();
    const foreign = { ...doc('x.pdf'), key: 'organizations/other-3/stores/x-11/data-collection/1/x.pdf' };
    const err1 = await service
      .saveStepResponses('t', 0, [{ field_id: FILE_FIELD, value_json: { files: [foreign] } }] as any)
      .then(() => null, (e) => e);
    expect(err1).toBeInstanceOf(VendixHttpException);
    expect(err1.errorCode).toBe('DCOL_UPLOAD_004');
    const err2 = await service
      .saveStepResponses('t', 0, [{ field_id: FILE_FIELD, value_json: { files: [doc('1.pdf'), doc('2.pdf')] } }] as any)
      .then(() => null, (e) => e);
    expect(err2.errorCode).toBe('DCOL_UPLOAD_004');
    expect(metadataValues.setValuesUnscoped).not.toHaveBeenCalled();
  });

  it('legacy: value_text only on a file field and plain fields keep working unchanged', async () => {
    const { service, metadataValues } = build();
    await service.saveStepResponses('t', 0, [
      { field_id: FILE_FIELD, value_text: `${PREFIX}/9/1-legacy.pdf` },
      { field_id: 6, value_text: 'hola' },
    ] as any);
    const calls = metadataValues.setValuesUnscoped.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][3][0]).toMatchObject({ field_id: FILE_FIELD, value_text: `${PREFIX}/9/1-legacy.pdf`, value_json: undefined });
    expect(calls[1][1]).toBe('booking');
  });

  it('getByToken/findOne responses carry signed files for file fields only', async () => {
    const { service } = build({
      values: [
        {
          id: 1, field_id: FILE_FIELD, entity_type: 'customer', field: { field_type: 'file' },
          value_text: doc('1-a.pdf').key, value_json: { files: [doc('1-a.pdf')] },
        },
        { id: 2, field_id: 6, entity_type: 'booking', field: { field_type: 'text' }, value_text: 'hola', value_json: null },
      ],
    });
    const result: any = await service.getByToken('t');
    const file = result.responses.find((r: any) => r.field_id === FILE_FIELD);
    expect(file.files).toEqual([
      { ...doc('1-a.pdf'), url: `https://signed.example/${doc('1-a.pdf').key}` },
    ]);
    expect(result.responses.find((r: any) => r.field_id === 6).files).toBeUndefined();
  });

  // Regression (verifier P1): a public caller must not get a signed URL for a
  // key of another store, neither by writing it nor by reading a stored one.
  it('legacy value_text with a foreign key is rejected on save', async () => {
    const { service, metadataValues } = build();
    for (const key of [FOREIGN_KEY, `${PREFIX}/../../other/x.pdf`]) {
      const err = await service
        .saveStepResponses('t', 0, [{ field_id: FILE_FIELD, value_text: key }] as any)
        .then(() => null, (e) => e);
      expect(err?.errorCode).toBe('DCOL_UPLOAD_004');
    }
    expect(metadataValues.setValuesUnscoped).not.toHaveBeenCalled();
  });

  it('a stored foreign key is never signed on read', async () => {
    const { service } = build({
      values: [
        {
          id: 1, field_id: FILE_FIELD, entity_type: 'customer', field: { field_type: 'file' },
          value_text: FOREIGN_KEY, value_json: null,
        },
      ],
    });
    const signUrl = (service as any).documents.s3.signUrl as jest.Mock;
    const result: any = await service.getByToken('t');
    const file = result.responses.find((r: any) => r.field_id === FILE_FIELD);
    expect(file.files).toEqual([expect.objectContaining({ key: FOREIGN_KEY, url: null })]);
    expect(signUrl).not.toHaveBeenCalledWith(FOREIGN_KEY);
  });
});
