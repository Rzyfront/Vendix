import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getQueueToken } from '@nestjs/bullmq';
// `import * as request` y no un default import: `esModuleInterop` está APAGADO
// en `apps/backend/tsconfig.json` (solo hay `allowSyntheticDefaultImports`, que
// contenta al compilador pero no reescribe el `require` en tiempo de
// ejecución). Con el default, ts-jest emite `supertest_1.default(...)` y la
// suite entera muere con «is not a function». Es la misma forma que usan los
// 6 specs de integración que ya existen en este backend.
import * as request from 'supertest';

import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { InvoiceScannerService } from './invoice-scanner.service';
import { ResponseService } from '@common/responses/response.service';
import { AllExceptionsFilter } from '@common/filters/http-exception.filter';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
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
 * CP-PURCHASE-TRANSPARENCY R2 — contrato de TRANSPORTE de compras, medido
 * sobre la pila HTTP real.
 *
 * ### Por qué esta suite existe y no basta con los unit tests
 *
 * Los dos defectos que este plan persigue no viven en la lógica de negocio:
 * viven en la LÍNEA DE ESTADO de la respuesta. Un spec de servicio prueba que
 * se lanza una excepción; no prueba con qué status sale, ni si el
 * `ValidationPipe` global la habría atajado antes de llegar al handler. Esas
 * dos cosas las deciden piezas que solo existen ensambladas: el pipe global de
 * `main.ts`, el `AllExceptionsFilter` global y el router de Nest.
 *
 * Por eso aquí se levanta la aplicación de verdad (`app.init()`, sin escuchar
 * en ningún puerto) con **el mismo pipe y el mismo filtro que `main.ts`**, y se
 * miden los status con `supertest`. Lo único simulado es la frontera de datos
 * (`StorePrismaService`) y el guard de permisos; el controller, el servicio, el
 * pipe y el filtro son los de producción.
 *
 * ### Los dos defectos que fija
 *
 * 1. `POST /:id/payments` con `amount:-5000` respondía **201 «Pago registrado
 *    exitosamente»** y persistía la fila (`purchase_order_payments` id 104,
 *    espejada en `ap_payments` id 88). Arreglado en 2762dd995 con
 *    `@Min(0.01)`; aquí se mide el 400 resultante — incluida la variante en
 *    CADENA, que el `enableImplicitConversion: true` del pipe convierte a
 *    número ANTES de validar.
 * 2. `GET /:id` de una orden inexistente respondía **200
 *    `{"success":true,…,"data":null}`**, con lo que el detalle del frontend
 *    pintaba «OC #undefined» y un botón Imprimir operativo. Aquí se mide el
 *    404 con `PO_FIND_001`.
 */
describe('purchase-orders — contrato HTTP (pipe + filtro globales reales)', () => {
  let app: INestApplication;
  let prisma: any;

  const ORG_ID = 1;
  const STORE_ID = 10;
  const PO_ID = 215;

  beforeAll(async () => {
    prisma = {
      purchase_orders: { findUnique: jest.fn() },
      purchase_order_payments: { aggregate: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseOrdersController],
      providers: [
        PurchaseOrdersService,
        ResponseService,
        VatResponsibilityService,
        { provide: InvoiceScannerService, useValue: {} },
        { provide: getQueueToken('payment-receipt-scan'), useValue: {} },
        { provide: StorePrismaService, useValue: prisma },
        { provide: StockLevelManager, useValue: {} },
        { provide: CostingService, useValue: {} },
        { provide: CostingMethodResolverService, useValue: {} },
        { provide: InventorySerialNumbersService, useValue: {} },
        { provide: SerialNumberEnforcementService, useValue: {} },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: S3Service, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: FiscalScopeService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: AccountsPayableService, useValue: {} },
      ],
    })
      // El guard de permisos no es lo que se mide aquí; su ausencia dejaría
      // 401/403 tapando los status que sí interesan.
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();

    // COPIA LITERAL de `main.ts` (useGlobalPipes / useGlobalFilters). Si
    // divergen, esta suite deja de medir la aplicación real: cualquier cambio
    // en el pipe global tiene que replicarse aquí.
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.setGlobalPrefix('api');

    await app.init();

    jest
      .spyOn(RequestContextService, 'getOrganizationId')
      .mockReturnValue(ORG_ID);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(7);
  });

  afterAll(async () => {
    await app?.close();
  });

  const PAGOS = `/api/store/orders/purchase-orders/${PO_ID}/payments`;
  const pagoBase = { payment_date: '2026-08-22', payment_method: 'cash' };

  describe(`POST ${PAGOS} — el piso del monto`, () => {
    beforeEach(() => {
      // La orden existe y tiene saldo de sobra: si el pago se colara, el techo
      // de la guarda de sobrepago NO lo pararía. El único freno es el DTO.
      prisma.purchase_orders.findUnique.mockResolvedValue({
        id: PO_ID,
        total_amount: 100436.18,
        organization_id: ORG_ID,
        suppliers: { id: 122 },
        location: { id: 50, store_id: STORE_ID },
      });
      prisma.$transaction.mockImplementation(async () => {
        throw new Error(
          'La transacción NO debía abrirse: el DTO tenía que rechazar antes',
        );
      });
    });

    it('amount: -5000 → 400, no el 201 que persistía la fila', async () => {
      const res = await request(app.getHttpServer())
        .post(PAGOS)
        .send({ ...pagoBase, amount: -5000 });

      expect(res.status).toBe(400);
      expect(res.body.error_code).toBe('SYS_VALIDATION_001');
      expect(res.body.details.validationErrors).toContain(
        'amount must not be less than 0.01',
      );
    });

    it('amount: 0 → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(PAGOS)
        .send({ ...pagoBase, amount: 0 });

      expect(res.status).toBe(400);
      expect(res.body.details.validationErrors).toContain(
        'amount must not be less than 0.01',
      );
    });

    /**
     * La trampa: `enableImplicitConversion` corre ANTES que los validadores, de
     * modo que `"-5000"` ya es un número cuando lo mira `@IsNumber()`. Quien lo
     * ataja es el piso — sin él, la cadena habría entrado igual que el número.
     */
    it('amount: "-5000" (CADENA) → 400 por el piso, no por @IsNumber', async () => {
      const res = await request(app.getHttpServer())
        .post(PAGOS)
        .send({ ...pagoBase, amount: '-5000' });

      expect(res.status).toBe(400);
      const errores: string[] = res.body.details.validationErrors;
      expect(errores).toContain('amount must not be less than 0.01');
      expect(errores.join(' ')).not.toContain('must be a number');
    });

    it('amount: 0.01 → el DTO lo deja pasar y la petición llega al servicio', async () => {
      const res = await request(app.getHttpServer())
        .post(PAGOS)
        .send({ ...pagoBase, amount: 0.01 });

      // El `$transaction` simulado lanza a propósito, así que un 500 aquí
      // demuestra justo lo que se quiere demostrar: el DTO NO rechazó y el
      // handler llegó a ejecutarse. Lo que no puede aparecer es el 400 de
      // validación.
      expect(res.status).not.toBe(400);
      expect(res.body.error_code).not.toBe('SYS_VALIDATION_001');
    });

    it('amount: 150000.50 (monto normal) → tampoco lo frena la validación', async () => {
      const res = await request(app.getHttpServer())
        .post(PAGOS)
        .send({ ...pagoBase, amount: 150000.5 });

      expect(res.status).not.toBe(400);
      expect(res.body.error_code).not.toBe('SYS_VALIDATION_001');
    });
  });

  describe('GET /api/store/orders/purchase-orders/:id — el recurso ausente', () => {
    it('una orden inexistente → 404 PO_FIND_001, no 200 con data:null', async () => {
      prisma.purchase_orders.findUnique.mockResolvedValue(null);

      const res = await request(app.getHttpServer()).get(
        '/api/store/orders/purchase-orders/999999',
      );

      expect(res.status).toBe(404);
      expect(res.body.error_code).toBe('PO_FIND_001');
      // Y sobre todo: ya NO viaja el sobre de éxito.
      expect(res.body.success).not.toBe(true);
      expect(res.body).not.toHaveProperty(
        'message',
        'Orden de compra obtenida exitosamente',
      );
    });

    /**
     * Una orden de OTRA tienda: el `StorePrismaService` la filtra por
     * `{ location: { store_id } }` y devuelve `null`, indistinguible de «no
     * existe». Tiene que salir 404 y NUNCA 403 — un 403 le confirmaría la
     * existencia del recurso a quien no debe saber ni que existe.
     */
    it('una orden de otra tienda → 404, nunca 403', async () => {
      prisma.purchase_orders.findUnique.mockResolvedValue(null);

      const res = await request(app.getHttpServer()).get(
        `/api/store/orders/purchase-orders/${PO_ID}`,
      );

      expect(res.status).toBe(404);
      expect(res.status).not.toBe(403);
      expect(res.body.error_code).toBe('PO_FIND_001');
    });

    it('una orden propia → 200 con el mismo sobre de éxito de siempre', async () => {
      prisma.purchase_orders.findUnique.mockResolvedValue({
        id: PO_ID,
        order_number: 'PO-20260822-668',
        suppliers: { id: 122, name: 'Debug Test Supplier' },
        location: { id: 50, store_id: STORE_ID },
        purchase_order_items: [],
        payment_schedules: [],
      });

      const res = await request(app.getHttpServer()).get(
        `/api/store/orders/purchase-orders/${PO_ID}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Orden de compra obtenida exitosamente');
      expect(res.body.data.id).toBe(PO_ID);
    });
  });
});
