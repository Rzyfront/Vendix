import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceScannerService } from './invoice-scanner.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PurchaseOrdersService } from './purchase-orders.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { CostingService } from '../../inventory/shared/services/costing.service';
import { CostingMethodResolverService } from '../../inventory/shared/services/costing-method-resolver.service';
import { InventorySerialNumbersService } from '../../inventory/serial-numbers/inventory-serial-numbers.service';
import { SerialNumberEnforcementService } from '../../inventory/serial-numbers/serial-number-enforcement.service';
import { AuditService } from '@common/audit/audit.service';
import { S3Service } from '@common/services/s3.service';
import { SettingsService } from '../../settings/settings.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AccountsPayableService } from '../../accounts-payable/accounts-payable.service';
import { VatResponsibilityService } from '@common/helpers/vat-responsibility.helper';

/**
 * QUI-855 (paso 7a) — el documento escaneado nunca se pierde: subida a S3 bajo
 * la tienda, vínculo en la tx de la OC, y control de pertenencia (IDOR) en los
 * adjuntos.
 */
describe('PurchaseOrders — documento escaneado y adjuntos (QUI-855)', () => {
  const ORG_ID = 1;
  const STORE_ID = 10;
  const USER_ID = 7;
  const LOCATION_ID = 999;
  const SUPPLIER_ID = 77;
  const PRODUCT_ID = 555;
  const PREFIX = 'organizations/acme-1/stores/tienda-10/purchase-orders/scans';

  let service: PurchaseOrdersService;
  let prismaService: any;
  let s3Service: {
    uploadFile: jest.Mock;
    signUrl: jest.Mock;
    deleteFile: jest.Mock;
  };
  let attachments: { findFirst: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    s3Service = {
      uploadFile: jest.fn().mockImplementation(async (_b, key) => key),
      signUrl: jest.fn().mockResolvedValue('https://signed'),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    attachments = {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 1 }),
    };
    prismaService = {
      $transaction: jest.fn(),
      stores: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: STORE_ID, slug: 'tienda' }),
      },
      organizations: {
        findFirst: jest.fn().mockResolvedValue({ id: ORG_ID, slug: 'acme' }),
      },
      purchase_orders: { findFirst: jest.fn().mockResolvedValue({ id: 42 }) },
      purchase_order_attachments: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      purchase_order_receptions: { findMany: jest.fn().mockResolvedValue([]) },
      accounting_entries: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const eventEmitter = { emit: jest.fn() };
    const costingService = { calculateCostOnReceipt: jest.fn() };
    const stockLevelManager = { updateStock: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: StorePrismaService, useValue: prismaService },
        { provide: StockLevelManager, useValue: stockLevelManager },
        { provide: CostingService, useValue: costingService },
        {
          provide: CostingMethodResolverService,
          useValue: {
            resolveCostingMethod: jest.fn().mockResolvedValue('fifo'),
          },
        },
        {
          provide: InventorySerialNumbersService,
          useValue: { populatePoolOnReceipt: jest.fn() },
        },
        {
          provide: SerialNumberEnforcementService,
          useValue: {
            isSerialized: jest.fn().mockResolvedValue(false),
            assertParityForLocation: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
            logCustom: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: S3Service, useValue: s3Service },
        {
          provide: SettingsService,
          useValue: {
            getFiscalData: jest
              .fn()
              .mockResolvedValue({ tax_responsibilities: ['O-48'] }),
          },
        },
        {
          provide: FiscalScopeService,
          useValue: {
            resolveAccountingEntityForFiscal: jest
              .fn()
              .mockResolvedValue({ id: 1 }),
          },
        },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: AccountsPayableService, useValue: {} as any },
        VatResponsibilityService,
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
    jest
      .spyOn(RequestContextService, 'getOrganizationId')
      .mockReturnValue(ORG_ID);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(USER_ID);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  const file = {
    buffer: Buffer.from('x'),
    originalname: 'Factura Nº 1 (copia).pdf',
    mimetype: 'application/pdf',
    size: 1,
  } as Express.Multer.File;

  it('uploadScanDocument: sube bajo la ruta de la tienda y devuelve la KEY', async () => {
    const res = await service.uploadScanDocument(file);
    const key = s3Service.uploadFile.mock.calls[0][1] as string;
    expect(key.startsWith(`${PREFIX}/`)).toBe(true);
    expect(key).not.toMatch(/[ º()]/);
    expect(res).toEqual({
      key,
      file_name: 'Factura Nº 1 (copia).pdf',
      file_type: 'application/pdf',
      file_size: 1,
    });
  });

  function mockCreateTx() {
    return {
      product_variants: { findMany: jest.fn().mockResolvedValue([]) },
      products: { findMany: jest.fn().mockResolvedValue([]) },
      inventory_locations: {
        findFirst: jest.fn().mockResolvedValue({ id: LOCATION_ID }),
        findUnique: jest.fn().mockResolvedValue({ store_id: STORE_ID }),
      },
      suppliers: {
        findFirst: jest.fn().mockResolvedValue({ id: SUPPLIER_ID }),
      },
      purchase_orders: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({
            id: 4242,
            order_number: data.order_number,
            organization_id: ORG_ID,
            location: { store_id: STORE_ID },
            status: data.status,
          }),
        ),
      },
      purchase_order_payment_schedules: { create: jest.fn() },
      purchase_order_attachments: attachments,
    };
  }

  const runCreate = async (scan: any) => {
    const tx = mockCreateTx();
    prismaService.$transaction.mockImplementation((cb: any) => cb(tx));
    await service.create({
      supplier_id: SUPPLIER_ID,
      location_id: LOCATION_ID,
      items: [
        {
          product_id: PRODUCT_ID,
          quantity: 5,
          unit_price: 1000,
          prices_include_tax: false,
          taxes: [],
        },
      ],
      scan_attachment: scan,
    } as any);
    return tx;
  };
  const scan = (key: string) => ({
    key,
    file_name: 'f.pdf',
    file_type: 'application/pdf',
    file_size: 10,
    supplier_invoice_number: 'FV-9',
  });

  it('create con scan_attachment de la tienda: crea el adjunto en la tx y no filtra el campo a la OC', async () => {
    const key = `${PREFIX}/1-f.pdf`;
    const tx = await runCreate(scan(key));
    expect(attachments.create).toHaveBeenCalledTimes(1);
    expect(attachments.create.mock.calls[0][0].data).toMatchObject({
      purchase_order_id: 4242,
      file_url: key,
      file_name: 'f.pdf',
      notes: 'Factura escaneada con IA',
      uploaded_by_user_id: USER_ID,
      supplier_invoice_number: 'FV-9',
    });
    expect(
      tx.purchase_orders.create.mock.calls[0][0].data.scan_attachment,
    ).toBeUndefined();
  });

  it('create con key de OTRA tienda: 400 y no liga nada', async () => {
    await expect(
      runCreate(
        scan('organizations/otra-2/stores/x-99/purchase-orders/scans/1-f.pdf'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(attachments.create).not.toHaveBeenCalled();
  });

  it('create con key que intenta escapar del prefijo (..): 400', async () => {
    await expect(
      runCreate(scan(`${PREFIX}/../../../x.pdf`)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create con nombre de puntos seguidos (captura macOS «a.m..png») vincula el adjunto', async () => {
    await runCreate(scan(`${PREFIX}/1790744718377-Captura_12.05.14___a.m..png`));
    expect(attachments.create).toHaveBeenCalledTimes(1);
  });

  it('repetir el vínculo (update de borrador reenviado) no duplica', async () => {
    attachments.findFirst.mockResolvedValue({ id: 5 });
    await runCreate(scan(`${PREFIX}/1-f.pdf`));
    expect(attachments.create).not.toHaveBeenCalled();
  });

  it('removeAttachment con adjunto de otra OC: 404 y no borra nada', async () => {
    prismaService.purchase_order_attachments.findFirst.mockResolvedValue(null);
    await expect(service.removeAttachment(42, 900)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(
      prismaService.purchase_order_attachments.findFirst.mock.calls[0][0].where,
    ).toEqual({ id: 900, purchase_order_id: 42 });
    expect(s3Service.deleteFile).not.toHaveBeenCalled();
    expect(
      prismaService.purchase_order_attachments.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('removeAttachment / getAttachments con OC de otra tienda: 404 PO_FIND_001', async () => {
    prismaService.purchase_orders.findFirst.mockResolvedValue(null);
    await expect(service.removeAttachment(42, 1)).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'PO_FIND_001' }),
    });
    await expect(service.getAttachments(42)).rejects.toBeDefined();
    expect(
      prismaService.purchase_order_attachments.findMany,
    ).not.toHaveBeenCalled();
  });

  it('addAttachment: verifica la OC y sube bajo la ruta de la tienda', async () => {
    prismaService.purchase_order_attachments.create = jest
      .fn()
      .mockResolvedValue({ id: 3 });
    await service.addAttachment(42, file, {} as any);
    expect(s3Service.uploadFile.mock.calls[0][1]).toMatch(
      /^organizations\/acme-1\/stores\/tienda-10\/purchase-orders\/attachments\/42\/\d+-/,
    );
    prismaService.purchase_orders.findFirst.mockResolvedValue(null);
    s3Service.uploadFile.mockClear();
    await expect(
      service.addAttachment(43, file, {} as any),
    ).rejects.toBeDefined();
    expect(s3Service.uploadFile).not.toHaveBeenCalled();
  });
});

describe('InvoiceScannerService.scanInvoice — documento guardado (QUI-855)', () => {
  const build = (upload: jest.Mock, aiOk = true) => {
    const ai = {
      run: jest
        .fn()
        .mockResolvedValue(
          aiOk
            ? { success: true, content: '{}', model: 'm' }
            : { success: false, error: 'boom' },
        ),
    };
    const svc = new InvoiceScannerService(
      ai as any,
      null as any,
      { uploadScanDocument: upload } as any,
      {
        getStoreCurrencyInfo: jest
          .fn()
          .mockResolvedValue({ code: 'COP', decimal_places: 0 }),
      } as any,
      null as any,
      null as any,
    );
    jest
      .spyOn(svc as any, 'preprocessImage')
      .mockResolvedValue({ base64: 'AA', mimeType: 'image/png' });
    jest
      .spyOn(svc as any, 'normalizeOcrResponse')
      .mockReturnValue({ total: 1 });
    return svc;
  };
  const f = {
    buffer: Buffer.from('x'),
    originalname: 'a.png',
    mimetype: 'image/png',
    size: 1,
  } as any;
  const att = {
    key: 'k',
    file_name: 'a.png',
    file_type: 'image/png',
    file_size: 1,
  };

  it('devuelve scan_attachment con la key subida', async () => {
    const svc = build(jest.fn().mockResolvedValue(att));
    const res: any = await svc.scanInvoice(f);
    expect(res.scan_attachment).toEqual(att);
  });

  it('si S3 falla no rompe el escaneo: scan_attachment null', async () => {
    const svc = build(jest.fn().mockRejectedValue(new Error('s3 down')));
    const res: any = await svc.scanInvoice(f);
    expect(res.scan_attachment).toBeNull();
    expect(res.total).toBe(1);
  });

  it('sube ANTES de la IA: si la IA falla, el error se propaga y el archivo ya está guardado', async () => {
    const upload = jest.fn().mockResolvedValue(att);
    const svc = build(upload, false);
    await expect(svc.scanInvoice(f)).rejects.toBeDefined();
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
