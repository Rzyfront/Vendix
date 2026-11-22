import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ResponseService } from '@common/responses/response.service';
import { AccessAuditLogger } from '../../../common/access/access-audit.logger';
import { AccessGateModeService } from '../../../common/access/access-gate-mode.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RecordDocumentsController } from './record-documents.controller';
import { RecordDocumentsService } from './record-documents.service';
import { DocumentSearchController } from './search/document-search.controller';
import { DocumentSearchService } from './search/document-search.service';

/**
 * B1 (auditoría F6 r1): en una tienda RETAIL la ficha de la orden y la del
 * cliente abren sus documentos. HTTP real con los guards reales
 * (`PermissionsGuard`, `IndustryModuleGuard` con `documents` siempre
 * aplicado): la biblioteca sigue cerrada a esa industria, el endpoint del
 * registro no, y solo lo abre quien tiene el permiso de lectura del registro.
 */

type User = {
  id: number;
  store_id: number;
  organization_id: number;
  roles: string[];
  permissions: Array<{ name: string; status: string; path: string; method: string }>;
};

const perm = (name: string) => ({ name, status: 'active', path: '', method: 'GET' });

const OWNER: User = {
  id: 1,
  store_id: 7,
  organization_id: 3,
  roles: ['owner'],
  permissions: [perm('store:orders:read'), perm('store:customers:read'), perm('store:documents:read')],
};
const ORDERS_ONLY: User = { ...OWNER, id: 2, roles: ['cashier'], permissions: [perm('store:orders:read')] };
const NO_READ: User = { ...OWNER, id: 3, roles: ['cashier'], permissions: [perm('store:orders:create')] };

const FILE = { id: 31, original_name: 'factura.pdf', mime_type: 'application/pdf', size_bytes: 2048 };

describe('documentos del registro en una tienda retail (B1)', () => {
  let app: INestApplication;
  let user: User;
  const records = {
    list: jest.fn(async () => ({ data: [FILE], total: 1, page: 1, limit: 50 })),
    download: jest.fn(async () => ({ url: 'https://s3/factura.pdf?sig', expires_in: 300 })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RecordDocumentsController, DocumentSearchController],
      providers: [
        ResponseService,
        { provide: RecordDocumentsService, useValue: records },
        { provide: DocumentSearchService, useValue: { folderFiles: jest.fn(async () => ({ data: [FILE] })) } },
        // Real IndustryModuleGuard dependencies: the store is retail.
        {
          provide: GlobalPrismaService,
          useValue: { stores: { findUnique: jest.fn(async () => ({ industries: ['retail'] })) } },
        },
        { provide: AccessGateModeService, useValue: { modeForStore: jest.fn(async () => 'audit') } },
        { provide: AccessAuditLogger, useValue: { record: jest.fn() } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => {
      req.user = user;
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    user = OWNER;
  });

  it('control: la biblioteca documental sigue bloqueada para retail (403 de industria)', async () => {
    const res = await request(app.getHttpServer()).get('/store/documents/folders/order/900');
    expect(res.status).toBe(403);
  });

  it('la ficha de la orden lista sus documentos (200) en retail', async () => {
    const res = await request(app.getHttpServer()).get('/store/record-documents/order/900?limit=50');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([FILE]);
    expect(records.list).toHaveBeenCalledWith('order', 900, expect.objectContaining({ limit: '50' }));
  });

  it('la URL firmada de un documento de la orden (200) en retail', async () => {
    const res = await request(app.getHttpServer()).get('/store/record-documents/order/900/files/31/download');
    expect(res.status).toBe(200);
    expect(res.body.data.url).toContain('factura.pdf');
    expect(records.download).toHaveBeenCalledWith('order', 900, 31);
  });

  it('la ficha del cliente lista sus documentos (200) en retail', async () => {
    const res = await request(app.getHttpServer()).get('/store/record-documents/customer/55');
    expect(res.status).toBe(200);
    expect(records.list).toHaveBeenCalledWith('customer', 55, expect.anything());
  });

  it('con store:orders:read pero sin store:customers:read: orden sí, cliente no', async () => {
    user = ORDERS_ONLY;
    const order = await request(app.getHttpServer()).get('/store/record-documents/order/900');
    const customer = await request(app.getHttpServer()).get('/store/record-documents/customer/55');
    expect(order.status).toBe(200);
    expect(customer.status).toBe(403);
  });

  it('sin el permiso de lectura del registro: 403 y el servicio no se toca', async () => {
    user = NO_READ;
    const list = await request(app.getHttpServer()).get('/store/record-documents/order/900');
    const download = await request(app.getHttpServer()).get('/store/record-documents/order/900/files/31/download');
    expect(list.status).toBe(403);
    expect(download.status).toBe(403);
    expect(records.list).not.toHaveBeenCalled();
    expect(records.download).not.toHaveBeenCalled();
  });

  it('cada ruta del controlador declara el permiso de lectura de su registro', () => {
    const expected: Record<string, string> = {
      order: 'store:orders:read',
      customer: 'store:customers:read',
      purchase_order: 'store:orders:purchase_orders:read',
      supplier: 'store:inventory:suppliers:read',
      expense: 'store:expenses:read',
      product: 'store:products:read',
    };
    const proto = RecordDocumentsController.prototype as unknown as Record<string, object>;
    const routes = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .map((name) => proto[name])
      .filter((fn) => typeof fn === 'function' && Reflect.getMetadata('path', fn) !== undefined);
    expect(routes).toHaveLength(12);
    for (const fn of routes) {
      const type = String(Reflect.getMetadata('path', fn)).split('/')[0];
      expect(Reflect.getMetadata('permissions', fn)).toEqual([expected[type]]);
    }
    expect(Reflect.getMetadata('__guards__', RecordDocumentsController)).toHaveLength(1);
  });
});
