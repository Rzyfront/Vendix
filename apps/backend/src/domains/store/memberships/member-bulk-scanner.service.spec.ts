import { MemberBulkScannerService } from './member-bulk-scanner.service';
import { VendixHttpException } from '@common/errors';

describe('MemberBulkScannerService (scan)', () => {
  let service: MemberBulkScannerService;
  let aiMock: any;
  let registryMock: any;

  const AI_FIXTURE = JSON.stringify({
    document_type: 'roster',
    detected_plans: [{ name: 'Mensual', price: 80000, duration_days: 30 }],
    members: [{ first_name: 'Ana', last_name: 'Lopez', plan_name: 'Mensual' }],
    confidence: 91,
  });

  const multerFile = (mimetype = 'image/jpeg') =>
    ({
      buffer: Buffer.from('fake'),
      mimetype,
      originalname: 'padron.jpg',
      size: 4,
    }) as Express.Multer.File;

  const scanFile = (mimeType = 'image/jpeg') => ({
    buffer: Buffer.from('fake'),
    mimeType,
    originalName: 'padron.jpg',
    size: 4,
  });

  beforeEach(() => {
    aiMock = {
      run: jest.fn().mockResolvedValue({
        success: true,
        content: AI_FIXTURE,
        model: 'm',
      }),
    };
    registryMock = { register: jest.fn() };
    service = new MemberBulkScannerService(
      aiMock,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      registryMock,
    );
  });

  it('scanRosterFromFiles da el mismo resultado que scanRoster', async () => {
    const sync = await service.scanRoster(multerFile());
    const viaFiles = await service.scanRosterFromFiles([scanFile()]);
    expect(viaFiles).toEqual(sync);
    expect(aiMock.run).toHaveBeenCalledWith(
      'member_roster_ocr',
      {},
      expect.any(Array),
    );
  });

  it('rechaza archivo ausente y mime invalido', async () => {
    await expect(service.scanRosterFromFiles([])).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    await expect(
      service.scanRosterFromFiles([scanFile('text/plain')]),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('onModuleInit registra member_roster y delega', async () => {
    service.onModuleInit();
    expect(registryMock.register).toHaveBeenCalledWith(
      'member_roster',
      expect.any(Function),
    );
    const handler = registryMock.register.mock.calls[0][1];
    const spy = jest.spyOn(service, 'scanRosterFromFiles');
    const files = [scanFile()];
    await handler({ files, params: {}, context: {} });
    expect(spy).toHaveBeenCalledWith(files);
  });
});
