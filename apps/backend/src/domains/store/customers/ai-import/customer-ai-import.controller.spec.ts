import { CustomerAiImportController } from './customer-ai-import.controller';

/**
 * QUI-1004 — la importación de clientes con IA entra al registro de cargas
 * masivas: la huella se calcula en `async` (donde llega el archivo) y el
 * commit registra la carga con sus conteos.
 */
describe('CustomerAiImportController · registro de cargas masivas', () => {
  const FILE_INFO = {
    file_name: 'clientes.xlsx',
    file_hash: 'b'.repeat(64),
    duplicate_of: null,
  };
  let importService: any;
  let jobs: any;
  let bulkUploadLogs: any;
  let controller: CustomerAiImportController;

  beforeEach(() => {
    importService = {
      assertValidFile: jest.fn(),
      toScanFile: jest.fn(() => ({ mimeType: 'text/csv' })),
      commit: jest.fn(),
    };
    jobs = { enqueue: jest.fn().mockResolvedValue({ job_id: 'j9' }) };
    bulkUploadLogs = {
      describeFile: jest.fn().mockResolvedValue(FILE_INFO),
      trackUpload: jest.fn().mockResolvedValue(undefined),
    };
    controller = new CustomerAiImportController(
      importService,
      jobs,
      { success: jest.fn((d) => ({ success: true, data: d })) } as any,
      bulkUploadLogs,
    );
  });

  it('async devuelve el job y la huella del archivo de esta tienda', async () => {
    const file = {
      buffer: Buffer.from('a,b'),
      mimetype: 'text/csv',
      originalname: 'clientes.xlsx',
      size: 3,
    } as Express.Multer.File;
    const res: any = await controller.scanAsync(file);
    expect(bulkUploadLogs.describeFile).toHaveBeenCalledWith(
      'customers_ai',
      file.buffer,
      'clientes.xlsx',
    );
    expect(res.data).toEqual({ job_id: 'j9', ...FILE_INFO });
  });

  it('commit registra creados, actualizados, omitidos y con error', async () => {
    importService.commit.mockResolvedValue({
      created: 2,
      updated: 1,
      locations_added: 1,
      locations_already_registered: 0,
      skipped: 1,
      failed: 1,
      results: [
        { outcome: 'created' },
        { outcome: 'created' },
        { outcome: 'updated' },
        { outcome: 'locations_added' },
        { outcome: 'skipped' },
        { outcome: 'failed' },
      ],
    });
    const dto: any = {
      customers: new Array(6).fill({}),
      file_name: 'clientes.xlsx',
      file_hash: FILE_INFO.file_hash,
    };
    await controller.commit(dto);
    expect(bulkUploadLogs.trackUpload).toHaveBeenCalledWith('customers_ai', dto, {
      total: 6,
      successful: 4,
      created: 2,
      failed: 1,
      skipped: 1,
    });
  });
});
