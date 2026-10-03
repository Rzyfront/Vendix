import { InventoryCountScannerService } from './inventory-count-scanner.service';
import { VendixHttpException } from '@common/errors';

describe('InventoryCountScannerService', () => {
  const LOCATION_ID = 5;
  let service: InventoryCountScannerService;
  let aiMock: any;
  let prismaMock: any;
  let registryMock: any;

  const AI_FIXTURE = JSON.stringify({
    counted_items: [
      {
        description: 'Coca Cola 350',
        quantity: 12,
        sku_if_visible: 'COC-350',
        barcode_if_visible: null,
        confidence: 90,
      },
    ],
    confidence: 88,
  });

  const multerFile = (mimetype = 'image/jpeg') =>
    ({
      buffer: Buffer.from('fake'),
      mimetype,
      originalname: 'conteo.jpg',
      size: 4,
    }) as Express.Multer.File;

  const scanFile = (mimeType = 'image/jpeg') => ({
    buffer: Buffer.from('fake'),
    mimeType,
    originalName: 'conteo.jpg',
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
    prismaMock = {
      products: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 9, name: 'Coca Cola 350ml', sku: 'COC-350' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      stock_levels: { findMany: jest.fn().mockResolvedValue([]) },
    };
    registryMock = { register: jest.fn() };
    service = new InventoryCountScannerService(
      aiMock,
      prismaMock,
      registryMock,
    );
  });

  it('scanCountFromFiles da el mismo resultado que scanCount', async () => {
    const sync = await service.scanCount(multerFile(), LOCATION_ID);
    const viaFiles = await service.scanCountFromFiles(
      [scanFile()],
      LOCATION_ID,
    );
    expect(viaFiles).toEqual(sync);
    expect(viaFiles.matched_products[0].selected_product_id).toBe(9);
  });

  it('el matching consulta via StorePrismaService (scoped por el contexto)', async () => {
    await service.scanCountFromFiles([scanFile()], LOCATION_ID);
    expect(prismaMock.products.findFirst).toHaveBeenCalled();
    expect(prismaMock.stock_levels.findMany).toHaveBeenCalled();
  });

  it('rechaza archivo ausente y mime invalido', async () => {
    await expect(
      service.scanCountFromFiles([], LOCATION_ID),
    ).rejects.toBeInstanceOf(VendixHttpException);
    await expect(
      service.scanCountFromFiles([scanFile('text/plain')], LOCATION_ID),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('onModuleInit registra inventory_count y delega con location_id numerico', async () => {
    service.onModuleInit();
    expect(registryMock.register).toHaveBeenCalledWith(
      'inventory_count',
      expect.any(Function),
    );
    const handler = registryMock.register.mock.calls[0][1];
    const spy = jest.spyOn(service, 'scanCountFromFiles');
    const files = [scanFile()];
    await handler({ files, params: { location_id: '5' }, context: {} });
    expect(spy).toHaveBeenCalledWith(files, 5);
  });
});
