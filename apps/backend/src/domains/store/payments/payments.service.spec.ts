import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentGatewayService, PaymentValidatorService } from './services';
import { WebhookHandlerService } from './services/webhook-handler.service';
import { PaymentError, PaymentErrorCodes } from './utils';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  Prisma,
  payment_processing_mode_enum,
  payments_state_enum,
} from '@prisma/client';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { TaxesService } from '../taxes/taxes.service';
import { TaxFiscalType } from '../taxes/dto';
// F-166: `TaxesService.resolveLineTotals` es una fachada delgada que delega
// EXACTO (sin normalizar entradas ni leer estado, ver taxes.service.ts:189-194)
// en esta función pura. El mock del provider delega a la misma función real
// en vez de una constante fija, para que el espía cuente llamadas sin
// congelar la aritmética que B.1/B.3 tienen que instrumentar.
import {
  resolveLineTotals as resolveLineTotalsPure,
  type TaxRateForResolution,
} from '../taxes/utils/tax-inclusive-math.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from '../settings/settings.service';
import { PromotionEngineService } from '../promotions/promotion-engine/promotion-engine.service';
import { CouponsService } from '../coupons/coupons.service';
import { SessionsService } from '../cash-registers/sessions/sessions.service';
import { MovementsService } from '../cash-registers/movements/movements.service';
import { PaymentEncryptionService } from './services/payment-encryption.service';
import { InvoiceDataRequestsService } from '../invoicing/invoice-data-requests/invoice-data-requests.service';
import { WompiClientFactory } from './processors/wompi/wompi.factory';
import { WompiProcessor } from './processors/wompi/wompi.processor';
import { FiscalInvoiceThresholdService } from '@common/services/fiscal-invoice-threshold.service';
import { OrderStockCommitService } from '../inventory/shared/services/order-stock-commit.service';
import { SellableStockAllocator } from '../inventory/shared/services/sellable-stock-allocator.service';
import { PriceResolverService } from '../products/services/price-resolver.service';
import { WithholdingFlowService } from '../withholding-tax/withholding-flow.service';
import { KitchenFireService } from '../kitchen-fire/kitchen-fire.service';
import { TableSessionsService } from '../tables/table-sessions.service';
import { SerialNumberEnforcementService } from '../inventory/serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../inventory/serial-numbers/inventory-serial-numbers.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { AuditService } from '@common/audit/audit.service';
import { mockRequestContext } from 'src/testing/prisma-mock';
import { buildOrder } from 'src/testing/money-fixtures';

/**
 * Tests for PaymentsService focused on the POS sale recalculation flow:
 *  - The backend (not the frontend) is the source of truth for promotional
 *    and coupon discounts.
 *  - `calculatePosPromotionQuote` delegates to `PromotionEngineService.quoteDiscounts`
 *    and returns the persistence-ready snapshots.
 *  - `calculatePosCouponDiscount` delegates to `CouponsService.validate` and
 *    returns the server-recalculated coupon discount (separate from the
 *    promotional discount).
 *  - Any `discount_amount` sent by the frontend in the POS payload is ignored
 *    for final totals.
 */
describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentGateway: PaymentGatewayService;
  let prisma: StorePrismaService;
  let promotionEngine: PromotionEngineService;
  let couponsService: CouponsService;
  let fiscalThreshold: FiscalInvoiceThresholdService;
  let kitchenFire: KitchenFireService;
  // F-157/F-166: handles tipados CONCRETOS del mock de TaxesService,
  // declarados en el ámbito del describe para que los tests los usen
  // DIRECTO por closure — nunca recuperados con `as jest.Mock` (eso
  // borra el tipo, ver F-157) ni desde `(service as any).taxes_service`.
  let calculateProductTaxesMock: jest.MockedFunction<
    TaxesService['calculateProductTaxes']
  >;
  let resolveLineTotalsMock: jest.MockedFunction<
    TaxesService['resolveLineTotals']
  >;
  // Handle tipado del seam canónico de consumo de stock. Mismo patrón F-157:
  // se crea UNA vez y los tests lo usan DIRECTO por closure — nunca
  // `(service as any).orderStockCommit` ni `as jest.Mock`, que borrarían el
  // tipo y dejarían pasar un `CommitResult` inventado.
  let commitOrderDeliveryMock: jest.MockedFunction<
    OrderStockCommitService['commitOrderDelivery']
  >;
  // Mismo patrón F-157: handle tipado concreto del emisor de eventos, creado
  // UNA vez y usado DIRECTO por closure. Los casos de contra entrega assertan
  // sobre la AUSENCIA de `payment.received`, y una aserción negativa recuperada
  // con `as jest.Mock` desde `eventEmitter.emit` pasaría incluso si el handle
  // dejara de ser el que el servicio inyecta.
  let emitMock: jest.MockedFunction<EventEmitter2['emit']>;

  const mockUser = {
    id: 1,
    email: 'test@example.com',
    organization_id: 1,
  };

  const mockPaymentResult = {
    success: true,
    transactionId: 'txn_1234567890_abc123',
    status: payments_state_enum.succeeded,
    message: 'Payment processed successfully',
  };

  const mockOrder = {
    id: 1,
    order_number: 'ORD202511140001',
    state: 'created',
    grand_total: 100.0,
    store_id: 1,
    stores: {
      id: 1,
      name: 'Test Store',
    },
  };

  beforeEach(async () => {
    const mockPrismaService = {
      payments: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      store_users: {
        findMany: jest.fn(),
      },
      stores: {
        findUnique: jest.fn(),
      },
      // QUI-783 round 2 — fallback path of calculatePosCouponDiscount looks up
      // the coupon code by id when the POS only sends `coupon_id`.
      coupons: {
        findFirst: jest.fn(),
      },
      // `processPosPayment` corre todo el cobro dentro de una transacción; el
      // mock ejecuta el callback en línea para poder observar lo que ocurre
      // adentro sin una base de datos.
      $transaction: jest.fn(),
    };

    const mockPaymentGateway = {
      processPayment: jest.fn(),
      processPaymentWithNewOrder: jest.fn(),
      refundPayment: jest.fn(),
      getPaymentStatus: jest.fn(),
    };

    const mockPromotionEngine = {
      quoteDiscounts: jest.fn(),
      applyPromotion: jest.fn(),
      validatePromotion: jest.fn(),
    };

    const mockCouponsService = {
      validate: jest.fn(),
      registerUse: jest.fn(),
    };

    // F-157 (ronda 2, corregido): el retipado anterior NO ataba. Dos borrados
    // encadenados: (a) `Partial<TaxesService>` declaraba la propiedad como el
    // MÉTODO, y los tests recuperaban el mock con
    // `(service as any).taxes_service.calculateProductTaxes as jest.Mock`,
    // que es `Mock<any, any>` — el `as jest.Mock` borra cualquier genérico
    // puesto en `jest.fn<...>()`; (b) el genérico `jest.fn<ReturnType<X>,
    // Parameters<X>>()` es tautológico: se recalcula contra la firma ACTUAL
    // de `X` en cada compilación, así que un ensanche de `X` (ADR-10:
    // `unclosed_residual_cents`, `invalid_inputs`, `resolved_from`) amplía
    // el tipo del mock EN EL MISMO MOVIMIENTO y nunca llega a chocar con
    // nada. Medido con sonda fuera del repo: `mockResolvedValue({
    // campo_inventado: 'basura' })`, `mockResolvedValue(undefined)` y
    // `mockResolvedValue(42)` compilaban los tres — ver
    // docs/critical-plans/CP-pos-exclusive-tax-double-charge/findings/F-157.md.
    //
    // Lo que sí ata: un HANDLE tipado concreto (`jest.MockedFunction<T>`)
    // creado una sola vez y usado DIRECTO por closure en los tests — nunca
    // recuperado desde `Partial<TaxesService>` ni con `as jest.Mock`. Ver los
    // `let calculateProductTaxesMock` / `let resolveLineTotalsMock` a nivel
    // de `describe`. Sonda que reproduce el ensanche de ADR-10 con un tipo
    // propio (+`unclosed_residual_cents`/`invalid_inputs`/`resolved_from`
    // requeridos) confirma que ESTE patrón sí rompe en compilación cuando el
    // fixture no los declara.
    calculateProductTaxesMock = jest.fn() as jest.MockedFunction<
      TaxesService['calculateProductTaxes']
    >;
    // F-166: `resolveLineTotals` delega al kernel puro real
    // (`tax-inclusive-math.util.ts`) en vez de una constante — el espía
    // cuenta llamadas SIN reemplazar la matemática que `invertDeclaredGross`
    // (F-016, antes `rescaleTaxInfo`) instrumenta. Antes, el único provider
    // de este método era un parche local `jest.fn().mockReturnValue({...fijo...})`
    // dentro del test de F-157 que ignoraba sus argumentos: congelaba la
    // aritmética y cualquier test que llegara a `invertDeclaredGross` sin ese
    // parche moría con
    // "resolveLineTotals is not a function" (F-166).
    //
    // F3 (ronda 3, CP-pos-exclusive-tax-double-charge): reenvía por
    // rest/spread (`...args`) y NO con parámetros nombrados. Una flecha de
    // aridad 2 es asignable a `jest.MockedFunction<TaxesService[
    // 'resolveLineTotals']>` aunque el método real gane un tercer parámetro
    // — TypeScript permite pasar una función con MENOS parámetros donde se
    // espera una con más — así que el mock compilaría igual, descartaría el
    // argumento nuevo en silencio, y `resolveLineTotalsPure` se invocaría con
    // `undefined` en su lugar (el mismo mecanismo de F-157, sin curar, en el
    // método hermano). Con `...args: Parameters<TaxesService[
    // 'resolveLineTotals']>` la aridad del mock SIGUE la del método real: si
    // `resolveLineTotalsPure` no acepta el argumento nuevo, la compilación
    // falla ahí — que es justo la señal que se quiere.
    resolveLineTotalsMock = jest.fn(
      (...args: Parameters<TaxesService['resolveLineTotals']>) =>
        resolveLineTotalsPure(...args),
    ) as jest.MockedFunction<TaxesService['resolveLineTotals']>;

    const mockTaxesService: Partial<TaxesService> = {
      calculateProductTaxes: calculateProductTaxesMock,
      resolveLineTotals: resolveLineTotalsMock,
    };

    commitOrderDeliveryMock = jest.fn().mockResolvedValue({
      totalCost: 0,
      committedItemCount: 0,
    }) as jest.MockedFunction<
      OrderStockCommitService['commitOrderDelivery']
    >;

    emitMock = jest.fn() as jest.MockedFunction<EventEmitter2['emit']>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentGatewayService, useValue: mockPaymentGateway },
        { provide: StorePrismaService, useValue: mockPrismaService },
        { provide: PaymentValidatorService, useValue: {} },
        { provide: WebhookHandlerService, useValue: {} },
        {
          provide: StockLevelManager,
          useValue: { updateStock: jest.fn() },
        },
        {
          provide: TaxesService,
          useValue: mockTaxesService,
        },
        { provide: EventEmitter2, useValue: { emit: emitMock } },
        {
          provide: SettingsService,
          useValue: {
            // CP-POS-CREAR-EDITAR-COBRAR-001 — legacy fiscal-threshold tests
            // were authored under the anonymous-allowed assumption
            // (`require_customer_data=false`). Mirror that explicitly so the
            // new customer gate in `processPosPayment` does not fire and
            // re-target these tests' STOP_AFTER_GATE assertion.
            getSettings: jest
              .fn()
              .mockResolvedValue({ checkout: { require_customer_data: false } }),
            getStoreCurrency: jest.fn().mockResolvedValue('COP'),
          },
        },
        { provide: PromotionEngineService, useValue: mockPromotionEngine },
        { provide: CouponsService, useValue: mockCouponsService },
        {
          provide: SessionsService,
          useValue: { getActiveSession: jest.fn() },
        },
        {
          provide: MovementsService,
          useValue: { recordSaleMovement: jest.fn() },
        },
        {
          provide: PaymentEncryptionService,
          useValue: { decryptConfig: jest.fn() },
        },
        {
          provide: InvoiceDataRequestsService,
          useValue: { createRequest: jest.fn() },
        },
        {
          provide: WompiClientFactory,
          useValue: { getClient: jest.fn() },
        },
        {
          provide: WompiProcessor,
          useValue: {},
        },
        {
          provide: FiscalInvoiceThresholdService,
          useValue: { assertInvoiceNotRequired: jest.fn(), evaluate: jest.fn() },
        },
        // The canonical stock-commit seam. Most cases in this suite assert
        // payment behavior, not inventory commitment, so the default is an
        // inert commit — but it resolves a REAL `CommitResult` because the
        // call site reads `.totalCost` off the awaited value, and returning
        // `undefined` turned "the commit ran" into a TypeError instead of an
        // observable call. The handle is typed and declared at describe level
        // (F-157 pattern) so the deferred-digital cases below can assert on it
        // by closure, never via `(service as any).orderStockCommit`.
        {
          provide: OrderStockCommitService,
          useValue: { commitOrderDelivery: commitOrderDeliveryMock },
        },
        // Collaborators the POS sale path injects but this suite does not
        // exercise (stock spreading, restaurant fire, serial pools). Stubbed so
        // the module compiles; a suite that asserts their behavior must widen
        // these instead of relying on the empty shape.
        {
          provide: SellableStockAllocator,
          useValue: { allocateForOrderItem: jest.fn() },
        },
        {
          provide: PriceResolverService,
          useValue: { resolveEffectivePrice: jest.fn() },
        },
        {
          provide: WithholdingFlowService,
          // `resolveSuffered` y `persistWithholdingLines` son los dos métodos
          // que el carril de cobro POS invoca de verdad (payments.service.ts
          // §4/§5). Sin declararlos, cualquier caso que llegue al bloque de
          // eventos moría con "is not a function" — `resolveSuffered` bajo un
          // try/catch que lo disfrazaba de "sin retenciones", y
          // `persistWithholdingLines` sin red, reventando la transacción con un
          // TypeError que no distingue una regresión real de un mock corto.
          useValue: {
            applyToOrder: jest.fn(),
            resolveSuffered: jest.fn().mockResolvedValue({
              lines: [],
              uvt_value_used: 0,
              counterparty_type: null,
            }),
            persistWithholdingLines: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: KitchenFireService, useValue: { fireOrder: jest.fn() } },
        {
          provide: TableSessionsService,
          useValue: {
            emitSessionClosed: jest.fn(),
            projectOrderPaymentToTableSession: jest.fn(),
          },
        },
        {
          provide: SerialNumberEnforcementService,
          useValue: { assertSerialsForSale: jest.fn() },
        },
        {
          provide: InventorySerialNumbersService,
          useValue: { consumeForOrder: jest.fn() },
        },
        // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 añadió `AuditService` al
        // constructor de `PaymentsService`; sin este provider el módulo de
        // test no compila y TODA la suite falla en el `beforeEach`.
        {
          provide: AuditService,
          useValue: {
            logCustom: jest.fn(),
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
            log: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    paymentGateway = module.get<PaymentGatewayService>(PaymentGatewayService);
    prisma = module.get<StorePrismaService>(StorePrismaService);
    promotionEngine = module.get<PromotionEngineService>(PromotionEngineService);
    couponsService = module.get<CouponsService>(CouponsService);
    fiscalThreshold = module.get<FiscalInvoiceThresholdService>(
      FiscalInvoiceThresholdService,
    );
    kitchenFire = module.get<KitchenFireService>(KitchenFireService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('POS table payment previous status (B.5)', () => {
    const dto = { store_id: 1, table_id: 4, currency: 'COP' } as any;
    const user = { id: 7 };

    afterEach(() => jest.restoreAllMocks());

    it.each(['cleaning', 'available', 'occupied'] as const)(
      'carries %s only from a newly opened session through the single payment path',
      async (previousStatus) => {
        const tx = {
          tables: { findFirst: jest.fn().mockResolvedValue({ id: 4, store_id: 1 }) },
          table_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
        };
        const opened = jest.fn().mockResolvedValue({
          id: 107,
          previous_table_status: previousStatus,
        });
        (service as any).tableSessionsService.createOpenSessionInTx = opened;
        const apply = jest
          .spyOn(service as any, 'applyPosPaymentToTableSession')
          .mockResolvedValue({ order: { id: 1124 } });

        const result = await (service as any).createOrUpdateOrderFromPos(tx, dto, user);

        expect(opened).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply.mock.calls[0][1]).toEqual({ ...dto, table_session_id: 107 });
        expect(result).toMatchObject({
          order: { id: 1124 },
          previousTableStatus: previousStatus,
        });
      },
    );

    it('reuses an existing session without opening another or reporting its table status', async () => {
      const tx = {
        tables: { findFirst: jest.fn().mockResolvedValue({ id: 4, store_id: 1 }) },
        table_sessions: { findFirst: jest.fn().mockResolvedValue({ id: 107 }) },
      };
      const opened = jest.fn();
      (service as any).tableSessionsService.createOpenSessionInTx = opened;
      const apply = jest
        .spyOn(service as any, 'applyPosPaymentToTableSession')
        .mockResolvedValue({ order: { id: 1124 } });

      const result = await (service as any).createOrUpdateOrderFromPos(tx, dto, user);

      expect(opened).not.toHaveBeenCalled();
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply.mock.calls[0][1]).toMatchObject({ table_session_id: 107 });
      expect(result.previousTableStatus).toBeUndefined();
    });
  });

  describe('processPayment', () => {
    it('should process payment successfully', async () => {
      const createPaymentDto = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 1,
      };

      const mockStoreUsers = [{ store_id: 1 }];

      jest
        .spyOn(prisma.store_users, 'findMany')
        .mockResolvedValue(mockStoreUsers);
      jest
        .spyOn(paymentGateway, 'processPayment')
        .mockResolvedValue(mockPaymentResult);

      const result = await service.processPayment(createPaymentDto, mockUser);

      const callArg = (paymentGateway.processPayment as jest.Mock).mock
        .calls[0][0];
      Object.entries(createPaymentDto).forEach(([key, value]) => {
        expect(callArg[key]).toEqual(value);
      });
      expect(typeof callArg.idempotencyKey).toBe('string');
      expect(result).toEqual({
        success: true,
        data: mockPaymentResult,
        message: 'Payment processed successfully',
      });
    });

    it('should handle payment errors', async () => {
      const createPaymentDto = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 1,
      };

      const mockStoreUsers = [{ store_id: 1 }];

      const paymentError = new PaymentError(
        PaymentErrorCodes.INVALID_ORDER,
        'Order not found',
      );

      jest
        .spyOn(prisma.store_users, 'findMany')
        .mockResolvedValue(mockStoreUsers);
      jest
        .spyOn(paymentGateway, 'processPayment')
        .mockRejectedValue(paymentError);

      await expect(
        service.processPayment(createPaymentDto, mockUser),
      ).rejects.toBeDefined();
    });

    it('should validate user access to store', async () => {
      const createPaymentDto = {
        orderId: 1,
        customerId: 1,
        amount: 100.0,
        currency: 'USD',
        storePaymentMethodId: 1,
        storeId: 2,
      };

      const mockStoreUsers = [{ store_id: 1 }];

      jest
        .spyOn(prisma.store_users, 'findMany')
        .mockResolvedValue(mockStoreUsers);
      jest
        .spyOn(prisma.stores, 'findUnique')
        .mockResolvedValue({ organization_id: 99 } as any);

      await expect(
        service.processPayment(createPaymentDto, mockUser),
      ).rejects.toBeDefined();
    });
  });

  /**
   * QUI-673 — el gate fiscal se apagaba en silencio en cada cobro POS.
   *
   * `orders` no tiene columna `organization_id` (schema.prisma: sólo `store_id`
   * + la relación `stores`), así que leer `order.organization_id` para el
   * umbral de 5 UVT entregaba SIEMPRE `undefined`. `order` está tipado `any` en
   * las dos ramas que lo producen, de modo que TypeScript no lo veía; y como
   * `FiscalGateService.isAreaEnabled` captura cualquier error y falla cerrado,
   * el `findUnique({ where: { id: undefined } })` resultante se degradaba a un
   * WARN y el cobro seguía respondiendo 201. El umbral no se evaluaba nunca.
   *
   * Por eso estos casos assertan el `organization_id` CONCRETO que recibe
   * `assertInvoiceNotRequired`: un stub que sólo verifica "fue llamado" es
   * exactamente lo que dejó pasar la regresión.
   */
  describe('processPosPayment (5 UVT fiscal threshold arguments)', () => {
    // Corta la ejecución justo después del gate fiscal. Lo que sigue dentro de
    // la transacción (pagos, inventario, COGS, asientos) no es lo que estos
    // casos assertan, y stubearlo entero volvería el test frágil sin añadir
    // cobertura sobre el argumento.
    const STOP_AFTER_GATE = 'stop-after-fiscal-threshold';

    let contextSpy: jest.SpyInstance;

    const CONTEXT_ORGANIZATION_ID = 999;

    const arrangePosSale = (order: any) => {
      contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({
          store_id: 1,
          organization_id: CONTEXT_ORGANIZATION_ID,
        } as any);

      (prisma as any).$transaction = jest.fn(async (cb: any) => cb({}));

      jest
        .spyOn(service as any, 'createOrUpdateOrderFromPos')
        .mockResolvedValue({
          order,
          hasSerialized: false,
          promotionsSnapshot: [],
          appliedPromotions: [],
          couponInfo: {
            coupon_id: null,
            coupon_code: null,
            discount_amount: 0,
          },
          kitchenFire: null,
          closedSessionId: null,
        });

      (fiscalThreshold.assertInvoiceNotRequired as jest.Mock).mockRejectedValue(
        new Error(STOP_AFTER_GATE),
      );
    };

    const buildPosDto = (overrides: any = {}): any => ({
      store_id: 1,
      currency: 'COP',
      items: [],
      payments: [],
      ...overrides,
    });

    // `super_admin` atraviesa `validateUserAccess` sin tocar la base.
    const posUser: any = {
      id: 1,
      email: 'cajero@example.com',
      organization_id: CONTEXT_ORGANIZATION_ID,
      roles: ['super_admin'],
    };

    afterEach(() => {
      contextSpy?.mockRestore();
    });

    it('resolves the organization through order.stores, never through a non-existent orders.organization_id column', async () => {
      // La orden se modela como la devuelve Prisma: SIN `organization_id`, con
      // la organización colgando de la relación `stores`.
      arrangePosSale({
        id: 10,
        store_id: 1,
        grand_total: 400000,
        stores: { id: 1, organization_id: 55 },
      });

      await expect(
        service.processPosPayment(
          buildPosDto({ customer_id: null }),
          posUser,
        ),
      ).rejects.toThrow(STOP_AFTER_GATE);

      expect(fiscalThreshold.assertInvoiceNotRequired).toHaveBeenCalledTimes(1);

      const callArg = (fiscalThreshold.assertInvoiceNotRequired as jest.Mock)
        .mock.calls[0][0];

      // El assert que faltaba: la organización concreta, no "se llamó".
      expect(callArg.organization_id).toBe(55);
      expect(callArg.organization_id).not.toBeUndefined();
      expect(callArg.store_id).toBe(1);
      // El total viene del `grand_total` recalculado por el servidor, no del DTO.
      expect(callArg.total_amount).toBe(400000);
      expect(callArg.has_customer).toBe(false);
      expect(callArg.channel).toBe('pos');
    });

    it('marks the sale as identified when the POS payload carries a customer', async () => {
      arrangePosSale({
        id: 11,
        store_id: 1,
        grand_total: 400000,
        stores: { id: 1, organization_id: 55 },
      });

      await expect(
        service.processPosPayment(buildPosDto({ customer_id: 77 }), posUser),
      ).rejects.toThrow(STOP_AFTER_GATE);

      const callArg = (fiscalThreshold.assertInvoiceNotRequired as jest.Mock)
        .mock.calls[0][0];
      expect(callArg.organization_id).toBe(55);
      expect(callArg.has_customer).toBe(true);
    });

    it('falls back to the request context organization when the order relation is absent', async () => {
      // Red de seguridad: hoy ambas ramas que producen `order` incluyen
      // `stores`, pero si alguna dejara de hacerlo el gate debe seguir
      // recibiendo una organización real en vez de `undefined`.
      arrangePosSale({
        id: 12,
        store_id: 1,
        grand_total: 400000,
      });

      await expect(
        service.processPosPayment(
          buildPosDto({ customer_id: null }),
          posUser,
        ),
      ).rejects.toThrow(STOP_AFTER_GATE);

      const callArg = (fiscalThreshold.assertInvoiceNotRequired as jest.Mock)
        .mock.calls[0][0];
      expect(callArg.organization_id).toBe(CONTEXT_ORGANIZATION_ID);
    });
  });

  describe('refundPayment', () => {
    it('should refund payment successfully', async () => {
      const refundDto = {
        paymentId: 'txn_1234567890_abc123',
        amount: 50.0,
        reason: 'Customer request',
      };

      const mockPayment = {
        transaction_id: 'txn_1234567890_abc123',
        orders: mockOrder,
      };

      const mockStoreUsers = [{ store_id: 1 }];

      const mockRefundResult = {
        success: true,
        refundId: 'refund_1234567890',
        amount: 50.0,
        status: 'succeeded' as const,
        message: 'Payment refunded successfully',
      };

      jest
        .spyOn(prisma.payments, 'findFirst')
        .mockResolvedValue(mockPayment as any);
      jest
        .spyOn(prisma.store_users, 'findMany')
        .mockResolvedValue(mockStoreUsers);
      jest
        .spyOn(paymentGateway, 'refundPayment')
        .mockResolvedValue(mockRefundResult);

      const result = await service.refundPayment(
        'txn_1234567890_abc123',
        refundDto,
        mockUser,
      );

      expect(paymentGateway.refundPayment).toHaveBeenCalledWith(
        'txn_1234567890_abc123',
        50.0,
        'Customer request',
      );
      expect(result).toEqual({
        success: true,
        data: mockRefundResult,
        message: 'Payment refunded successfully',
      });
    });

    it('should throw error if payment not found', async () => {
      const refundDto = {
        paymentId: 'nonexistent_payment',
        amount: 50.0,
      };

      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(null);

      await expect(
        service.refundPayment('nonexistent_payment', refundDto, mockUser),
      ).rejects.toBeDefined();
    });
  });

  describe('findOne', () => {
    it('should return payment by transaction ID', async () => {
      const paymentId = 'txn_1234567890_abc123';

      const mockPayment: any = {
        id: 1,
        transaction_id: paymentId,
        amount: 100.0,
        currency: 'USD',
        state: payments_state_enum.succeeded,
        orders: { ...mockOrder, store_id: 1 },
      };

      const mockStoreUsers = [{ store_id: 1 }];

      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(mockPayment);
      jest
        .spyOn(prisma.store_users, 'findMany')
        .mockResolvedValue(mockStoreUsers);

      const result = await service.findOne(paymentId, mockUser);

      expect(result.data).toEqual(mockPayment);
    });

    it('should throw error if payment not found', async () => {
      const paymentId = 'nonexistent_payment';

      jest.spyOn(prisma.payments, 'findFirst').mockResolvedValue(null);

      await expect(
        service.findOne(paymentId, mockUser),
      ).rejects.toBeDefined();
    });
  });

  /**
   * Server-side recalculation of promotions for POS sales.
   *
   * `calculatePosPromotionQuote` is a thin wrapper that builds a
   * `PromotionQuoteInput` from the POS payload and delegates to
   * `PromotionEngineService.quoteDiscounts`. The tests below assert the
   * mapping is correct and the result is returned verbatim — covering the
   * 4 promotion scopes the plan requires: none, product, category, general.
   */
  describe('calculatePosPromotionQuote (POS server-side recalculation)', () => {
    const buildDto = (overrides: any = {}) => ({
      store_id: 1,
      items: [
        {
          product_id: 10,
          category_id: 5,
          category_ids: [5],
          product_name: 'P1',
          quantity: 2,
          unit_price: 50,
          final_unit_price: 50,
          total_price: 100,
        },
      ],
      subtotal: 100,
      total_amount: 100,
      ...overrides,
    });

    it('returns zero discount when no promotions match (regression: sale without promo unchanged)', async () => {
      const quote = {
        subtotal: 100,
        total_discount: 0,
        promotional_subtotal: 100,
        applied_promotions: [],
        items: [],
        order_promotions_snapshot: [],
      };
      (promotionEngine.quoteDiscounts as jest.Mock).mockResolvedValue(quote);

      const result = await (service as any).calculatePosPromotionQuote(
        buildDto(),
      );

      const callArg = (promotionEngine.quoteDiscounts as jest.Mock).mock
        .calls[0][0];
      expect(callArg.manual_promotion_ids).toEqual([]);
      expect(callArg.items).toHaveLength(1);
      expect(callArg.items[0].product_id).toBe(10);
      expect(result.total_discount).toBe(0);
      expect(result.order_promotions_snapshot).toEqual([]);
    });

    it('returns product-scope promotion discount with snapshot ready to persist', async () => {
      const quote = {
        subtotal: 100,
        total_discount: 10,
        promotional_subtotal: 90,
        applied_promotions: [
          {
            promotion_id: 7,
            name: 'Product promo',
            code: null,
            type: 'percentage',
            scope: 'product',
            value: 10,
            is_auto_apply: false,
            discount_amount: 10,
            applicable_item_ids: [0],
          },
        ],
        items: [],
        order_promotions_snapshot: [{ promotion_id: 7, discount_amount: 10 }],
      };
      (promotionEngine.quoteDiscounts as jest.Mock).mockResolvedValue(quote);

      const result = await (service as any).calculatePosPromotionQuote(
        buildDto({ promotion_ids: [7] }),
      );

      const callArg = (promotionEngine.quoteDiscounts as jest.Mock).mock
        .calls[0][0];
      expect(callArg.manual_promotion_ids).toEqual([7]);
      expect(result.total_discount).toBe(10);
      expect(result.order_promotions_snapshot).toEqual([
        { promotion_id: 7, discount_amount: 10 },
      ]);
    });

    it('returns category-scope promotion discount with snapshot ready to persist', async () => {
      const quote = {
        subtotal: 100,
        total_discount: 15,
        promotional_subtotal: 85,
        applied_promotions: [
          {
            promotion_id: 8,
            name: 'Cat promo',
            code: null,
            type: 'percentage',
            scope: 'category',
            value: 15,
            is_auto_apply: false,
            discount_amount: 15,
            applicable_item_ids: [0],
          },
        ],
        items: [],
        order_promotions_snapshot: [{ promotion_id: 8, discount_amount: 15 }],
      };
      (promotionEngine.quoteDiscounts as jest.Mock).mockResolvedValue(quote);

      const result = await (service as any).calculatePosPromotionQuote(
        buildDto({ promotion_ids: [8] }),
      );

      expect(result.total_discount).toBe(15);
      expect(result.order_promotions_snapshot).toEqual([
        { promotion_id: 8, discount_amount: 15 },
      ]);
    });

    it('returns order/general-scope promotion discount with snapshot ready to persist', async () => {
      const quote = {
        subtotal: 100,
        total_discount: 20,
        promotional_subtotal: 80,
        applied_promotions: [
          {
            promotion_id: 9,
            name: 'Order promo',
            code: null,
            type: 'fixed_amount',
            scope: 'order',
            value: 20,
            is_auto_apply: true,
            discount_amount: 20,
            applicable_item_ids: [0],
          },
        ],
        items: [],
        order_promotions_snapshot: [{ promotion_id: 9, discount_amount: 20 }],
      };
      (promotionEngine.quoteDiscounts as jest.Mock).mockResolvedValue(quote);

      const result = await (service as any).calculatePosPromotionQuote(
        buildDto(),
      );

      expect(result.total_discount).toBe(20);
      expect(result.order_promotions_snapshot).toEqual([
        { promotion_id: 9, discount_amount: 20 },
      ]);
    });
  });

  /**
   * Server-side recalculation of the coupon discount.
   *
   * `calculatePosCouponDiscount` delegates to `CouponsService.validate` and
   * intentionally ignores any `discount_amount` sent by the frontend.
   */
  describe('calculatePosCouponDiscount (POS server-side recalculation)', () => {
    const baseDto: any = {
      items: [
        {
          product_id: 10,
          quantity: 2,
          unit_price: 50,
          final_unit_price: 50,
          product_name: 'P1',
          total_price: 100,
        },
      ],
    };

    it('returns 0 when no coupon code is provided', async () => {
      const res = await (service as any).calculatePosCouponDiscount(
        baseDto,
        100,
        0,
      );
      expect(res).toEqual({
        coupon_id: null,
        coupon_code: null,
        discount_amount: 0,
      });
      expect(couponsService.validate).not.toHaveBeenCalled();
    });

    it('returns the validated coupon discount when only a coupon applies', async () => {
      (couponsService.validate as jest.Mock).mockResolvedValue({
        valid: true,
        coupon_id: 42,
        code: 'OFF10',
        discount_type: 'PERCENTAGE',
        discount_value: 10,
        discount_amount: 10,
      });

      const res = await (service as any).calculatePosCouponDiscount(
        { ...baseDto, coupon_code: 'OFF10' },
        100,
        0,
      );

      expect(couponsService.validate).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'OFF10',
          cart_subtotal: 100,
        }),
      );
      expect(res).toEqual({
        coupon_id: 42,
        coupon_code: 'OFF10',
        discount_amount: 10,
      });
    });

    it('passes remaining subtotal (after promotions) to coupon validation when both are stacked', async () => {
      (couponsService.validate as jest.Mock).mockResolvedValue({
        valid: true,
        coupon_id: 42,
        code: 'OFF10',
        discount_type: 'PERCENTAGE',
        discount_value: 10,
        discount_amount: 9,
      });

      const res = await (service as any).calculatePosCouponDiscount(
        { ...baseDto, coupon_code: 'OFF10' },
        100,
        10, // promotions already discounted 10 — remaining = 90
      );

      expect(couponsService.validate).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'OFF10',
          cart_subtotal: 90,
        }),
      );
      expect(res.discount_amount).toBe(9);
    });

    it('rethrows the coupon validation error (no silent swallow — QUI-783)', async () => {
      // QUI-783 — silently swallowing the coupon validation error made the
      // backend charge the full subtotal even though the UI showed a
      // discounted total, overcharging the customer. The cashier now gets
      // the precise CPN_* error so they can fix or remove the coupon.
      (couponsService.validate as jest.Mock).mockRejectedValue(
        new BadRequestException('Coupon expired'),
      );

      await expect(
        (service as any).calculatePosCouponDiscount(
          { ...baseDto, coupon_code: 'EXPIRED' },
          100,
          0,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rethrows a CPN_* VendixHttpException with its error_code intact', async () => {
      // The cashier-facing message must round-trip the original error_code so
      // the frontend's `parseApiError` can pick the right user-friendly copy
      // from `ERROR_MESSAGES`.
      (couponsService.validate as jest.Mock).mockRejectedValue(
        new VendixHttpException(ErrorCodes.CPN_EXPIRED_001),
      );

      let caught: any;
      try {
        await (service as any).calculatePosCouponDiscount(
          { ...baseDto, coupon_code: 'OFF10' },
          100,
          0,
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(VendixHttpException);
      expect(caught.errorCode).toBe('CPN_EXPIRED_001');
    });

    it('wraps unexpected non-CPN errors as BadRequest (does not silently swallow)', async () => {
      // Non-domain errors (e.g., DB outage, programmer mistake) must still
      // fail loud rather than silently returning discount_amount=0.
      (couponsService.validate as jest.Mock).mockRejectedValue(
        new Error('connection reset'),
      );

      await expect(
        (service as any).calculatePosCouponDiscount(
          { ...baseDto, coupon_code: 'OFF10' },
          100,
          0,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('falls back to coupon_id lookup when coupon_code is missing (QUI-783 round 2)', async () => {
      // The POS frontend sends `coupon_id` but the cart state never
      // populates `coupon_code`. Without this fallback the server
      // returned discount_amount=0 and the cash validation rejected the
      // cashier's amountReceived even though the UI showed the discount.
      (prisma.coupons.findFirst as jest.Mock).mockResolvedValue({
        code: 'OFF10',
      });
      (couponsService.validate as jest.Mock).mockResolvedValue({
        valid: true,
        coupon_id: 42,
        code: 'OFF10',
        discount_type: 'PERCENTAGE',
        discount_value: 10,
        discount_amount: 10,
      });

      const res = await (service as any).calculatePosCouponDiscount(
        { ...baseDto, coupon_id: 42 }, // NO coupon_code
        100,
        0,
      );

      expect(prisma.coupons.findFirst).toHaveBeenCalledWith({
        where: { id: 42, is_active: true },
        select: { code: true },
      });
      expect(couponsService.validate).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'OFF10' }),
      );
      expect(res.discount_amount).toBe(10);
    });

    it('returns 0 when only an inactive coupon_id is provided', async () => {
      // The id resolves to nothing (deleted / inactive) → fall through to
      // the no-coupon path, NOT throw. The cashier's UI showed a discount
      // for a coupon that no longer exists; the safe behavior is to charge
      // full price rather than error out.
      (prisma.coupons.findFirst as jest.Mock).mockResolvedValue(null);

      const res = await (service as any).calculatePosCouponDiscount(
        { ...baseDto, coupon_id: 9999 },
        100,
        0,
      );

      expect(res).toEqual({
        coupon_id: null,
        coupon_code: null,
        discount_amount: 0,
      });
      expect(couponsService.validate).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // CP-POS-CREAR-EDITAR-COBRAR-001 — G.1
  //
  // Invariantes B.1 (customer gate) y B.2 (draft ≠ payment). Ambos gates
  // corren ANTES de `$transaction`, así que la prueba de "cero escrituras"
  // es exactamente: `prisma.$transaction` nunca fue invocada. No hay orden,
  // ni pago, ni fila de cupón, ni evento, porque nada de eso ocurre fuera
  // de la transacción.
  //
  // El caso positivo no simula la venta entera (eso sería un test frágil de
  // 300 líneas de mocks): corta con un sentinel justo después de los gates y
  // asserta que (a) el gate NO disparó, (b) se consultó la membresía del
  // cliente en ESTE store y (c) ni el gateway de pago ni el registro de uso
  // del cupón fueron llamados en el camino de draft.
  // ------------------------------------------------------------------
  describe('processPosPayment — customer gate y draft/payment invariant (B.1/B.2)', () => {
    const STOP_AFTER_GATES = 'stop-after-pos-gates';
    const CONTEXT_STORE_ID = 1;

    let contextSpy: jest.SpyInstance;

    const posUser: any = {
      id: 1,
      email: 'cajero@example.com',
      organization_id: 1,
      roles: ['super_admin'],
    };

    const buildDto = (overrides: any = {}): any => ({
      store_id: CONTEXT_STORE_ID,
      currency: 'COP',
      items: [{ product_id: 1, quantity: 1, unit_price: 1000 }],
      payments: [],
      total_amount: 1000,
      ...overrides,
    });

    const arrange = (settings: any) => {
      contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({
          store_id: CONTEXT_STORE_ID,
          organization_id: 1,
        } as any);

      (
        module_settings_getSettings() as jest.Mock
      ).mockResolvedValue(settings);

      // Si algún gate dejara pasar la petición, la transacción se abriría.
      // El sentinel hace visible ese cruce en lugar de fallar en un mock
      // profundo e inescrutable.
      (prisma as any).$transaction = jest.fn(async () => {
        throw new Error(STOP_AFTER_GATES);
      });
    };

    // `settingsService` no está expuesto como variable del suite; se resuelve
    // desde la instancia del servicio para no reestructurar el módulo de test.
    const module_settings_getSettings = () =>
      (service as any).settingsService.getSettings;

    afterEach(() => {
      contextSpy?.mockRestore();
    });

    it.each([
      { delivery_type: 'home_delivery' },
      { shipping_address_snapshot: { city: 'Bogotá' } },
      { delivery_type: 'direct_delivery', shipping_address_id: 88 },
    ])('rechaza envío declarado sin método antes de crear orden o pago: %j', async (shippingFields) => {
      arrange({ checkout: { require_customer_data: false } });
      const error = await service.processPosPayment(
        buildDto({ ...shippingFields, is_draft: true }), posUser,
      ).catch((failure) => failure);

      expect(error).toBeInstanceOf(VendixHttpException);
      expect(error.errorCode).toBe(ErrorCodes.ORD_SHIP_REQUIRED_FOR_FLOW_001.code);
      expect((prisma as any).$transaction).not.toHaveBeenCalled();
    });

    it.each([
      {},
      { delivery_type: 'direct_delivery' },
      { delivery_type: 'pickup', shipping_address_id: 88 },
      { delivery_type: 'dine_in' },
      { delivery_type: 'home_delivery', shipping_method_id: 12 },
    ])('conserva el carril válido sin bloquearlo: %j', async (shippingFields) => {
      arrange({ checkout: { require_customer_data: false } });
      await expect(service.processPosPayment(
        buildDto({ ...shippingFields, is_draft: true }), posUser,
      )).rejects.toThrow(STOP_AFTER_GATES);
      expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
    });

    it('acepta la creación con cliente válido: pasa los gates, no cobra y no consume cupón', async () => {
      arrange({ checkout: { require_customer_data: true } });
      (prisma.store_users.findFirst as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ user_id: 77 });

      await expect(
        service.processPosPayment(
          buildDto({
            customer_id: 77,
            coupon_code: 'DESCUENTO10',
            is_draft: true,
            requires_payment: false,
          }),
          posUser,
        ),
      ).rejects.toThrow(STOP_AFTER_GATES);

      // El gate consultó la membresía del cliente EN ESTE STORE.
      expect(prisma.store_users.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { store_id: CONTEXT_STORE_ID, user_id: 77 },
        }),
      );

      // Ni cobro ni consumo de cupón en el camino de draft.
      expect(paymentGateway.processPayment).not.toHaveBeenCalled();
      expect((couponsService as any).registerUse).not.toHaveBeenCalled();
    });

    it('rechaza con POS_CUSTOMER_REQUIRED_001 y no abre transacción cuando falta el cliente', async () => {
      arrange({ checkout: { require_customer_data: true } });

      let caught: any = null;
      try {
        await service.processPosPayment(
          buildDto({ is_draft: true, requires_payment: false }),
          posUser,
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(VendixHttpException);
      expect(caught.errorCode).toBe(
        ErrorCodes.POS_CUSTOMER_REQUIRED_001.code,
      );
      // Cero escrituras: sin transacción no hay orden, ni pago, ni cupón.
      expect((prisma as any).$transaction).not.toHaveBeenCalled();
      expect(paymentGateway.processPayment).not.toHaveBeenCalled();
    });

    it('rechaza con POS_CUSTOMER_REQUIRED_001 cuando el cliente no pertenece al store', async () => {
      arrange({ checkout: { require_customer_data: true } });
      (prisma.store_users.findFirst as jest.Mock) = jest
        .fn()
        .mockResolvedValue(null);

      let caught: any = null;
      try {
        await service.processPosPayment(
          buildDto({ customer_id: 4242, is_draft: true, requires_payment: false }),
          posUser,
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(VendixHttpException);
      expect(caught.errorCode).toBe(
        ErrorCodes.POS_CUSTOMER_REQUIRED_001.code,
      );
      expect((prisma as any).$transaction).not.toHaveBeenCalled();
    });

    it('rechaza con POS_DRAFT_REQUIRES_PAYMENT_001 la combinación is_draft + requires_payment', async () => {
      arrange({ checkout: { require_customer_data: true } });
      (prisma.store_users.findFirst as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ user_id: 77 });

      let caught: any = null;
      try {
        await service.processPosPayment(
          buildDto({ customer_id: 77, is_draft: true, requires_payment: true }),
          posUser,
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(VendixHttpException);
      expect(caught.errorCode).toBe(
        ErrorCodes.POS_DRAFT_REQUIRES_PAYMENT_001.code,
      );
      // El conflicto se detecta ANTES del gate de cliente y de la transacción.
      expect((prisma as any).$transaction).not.toHaveBeenCalled();
      expect(paymentGateway.processPayment).not.toHaveBeenCalled();
    });

    it('un draft con cupón válido no registra uso ni incrementa el contador', async () => {
      arrange({ checkout: { require_customer_data: true } });
      (prisma.store_users.findFirst as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ user_id: 77 });
      (couponsService.validate as jest.Mock).mockResolvedValue({
        valid: true,
        coupon_id: 9,
        code: 'DESCUENTO10',
        discount_amount: 100,
      });

      await expect(
        service.processPosPayment(
          buildDto({
            customer_id: 77,
            coupon_code: 'DESCUENTO10',
            is_draft: true,
            requires_payment: false,
          }),
          posUser,
        ),
      ).rejects.toThrow(STOP_AFTER_GATES);

      // `coupon_uses` / `coupons.current_uses` sólo se tocan dentro de la
      // transacción de cobro; el draft no llega allí y no registra uso.
      expect((couponsService as any).registerUse).not.toHaveBeenCalled();
    });
  });

  describe('createOrUpdateOrderFromPos — adopted order', () => {
    const user = { id: 1, roles: ['super_admin'] };
    const item = {
      item_type: 'custom', product_name: 'Artículo', quantity: 1,
      unit_price: 1000, total_price: 1000,
    };
    const dto = (overrides: Record<string, unknown> = {}) => ({
      store_id: 1, order_id: 41, currency: 'COP', items: [item],
      requires_payment: true, ...overrides,
    });
    const order = {
      id: 41, order_number: 'POS-41', state: 'draft',
      subtotal_amount: 1000, tax_amount: 0,
    };
    const tx = (found: any = order, paid: any = null) => ({
      orders: {
        findFirst: jest.fn().mockResolvedValue(found),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({
          ...order, state: 'created', store_id: 1, grand_total: 1000,
          order_items: [], stores: { id: 1 },
        }),
        create: jest.fn(),
      },
      payments: { findFirst: jest.fn().mockResolvedValue(paid) },
      bookings: { updateMany: jest.fn() },
    });

    afterEach(() => jest.restoreAllMocks());

    it('rejects another store as not found without probing payments or creating an order', async () => {
      const client = tx(null);
      let caught: any;
      try {
        await (service as any).createOrUpdateOrderFromPos(client, dto(), user);
      } catch (error) { caught = error; }

      expect(caught).toBeInstanceOf(VendixHttpException);
      expect(caught.errorCode).toBe(ErrorCodes.ORD_FIND_001.code);
      expect(client.orders.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 41, store_id: 1 },
      }));
      expect(client.payments.findFirst).not.toHaveBeenCalled();
      expect(client.orders.create).not.toHaveBeenCalled();
    });

    it.each(['succeeded', 'captured'])('rejects an already %s payment with typed 409 and order number', async (state) => {
      const client = tx(order, { id: 9, state });
      let caught: any;
      try {
        await (service as any).createOrUpdateOrderFromPos(client, dto(), user);
      } catch (error) { caught = error; }

      expect(caught).toBeInstanceOf(VendixHttpException);
      expect(caught.errorCode).toBe(ErrorCodes.POS_DRAFT_DUPLICATE_ORDER_001.code);
      expect(caught.getStatus()).toBe(409);
      expect(caught.message).toContain('POS-41');
      expect(client.payments.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { order_id: 41, state: { in: ['succeeded', 'captured'] } },
      }));
      expect(client.orders.create).not.toHaveBeenCalled();
    });

    it('rejects a non-chargeable order state before writing a payment', async () => {
      const client = tx({ ...order, state: 'finished' });
      let caught: any;
      try {
        await (service as any).createOrUpdateOrderFromPos(client, dto(), user);
      } catch (error) { caught = error; }

      expect(caught.errorCode).toBe(ErrorCodes.POS_DRAFT_DUPLICATE_ORDER_001.code);
      expect(caught.message).toContain('POS-41');
      expect(client.orders.updateMany).not.toHaveBeenCalled();
      expect(client.payments.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a stale row claim instead of creating a second order', async () => {
      const client = tx();
      client.orders.updateMany.mockResolvedValue({ count: 0 });
      let caught: any;
      try {
        await (service as any).createOrUpdateOrderFromPos(client, dto(), user);
      } catch (error) { caught = error; }

      expect(caught.errorCode).toBe(ErrorCodes.POS_DRAFT_DUPLICATE_ORDER_001.code);
      expect(client.payments.findFirst).not.toHaveBeenCalled();
      expect(client.orders.create).not.toHaveBeenCalled();
    });

    it('updates the adopted order header and never creates another order', async () => {
      const client = tx();
      jest.spyOn(service as any, 'orderHasSerializedItems').mockResolvedValue(false);
      jest.spyOn(service as any, 'buildPosOrderItem').mockResolvedValue({
        // Stale checkout snapshot must not replace persisted adopted items.
        product_name: 'Artículo', quantity: 1, total_price: 2000,
        tax_amount_item: 0,
      });
      jest.spyOn(service as any, 'calculatePosPromotionQuote').mockResolvedValue({
        total_discount: 0, order_promotions_snapshot: [], applied_promotions: [],
      });
      jest.spyOn(service as any, 'calculatePosCouponDiscount').mockResolvedValue({
        coupon_id: null, coupon_code: null, discount_amount: 0,
      });

      const result = await (service as any).createOrUpdateOrderFromPos(
        client, dto({ shipping_cost: 500 }), user,
      );

      expect(result.order.id).toBe(41);
      expect(client.orders.create).not.toHaveBeenCalled();
      expect(client.orders.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 41, store_id: 1 },
        data: expect.objectContaining({
          state: 'created', subtotal_amount: 1000,
          shipping_cost: 500, grand_total: 1500,
        }),
      }));
      expect(client.orders.update.mock.calls[0][0].data.order_items).toBeUndefined();
    });
  });

  describe('createOrderInstallments — projected persisted POS credit total', () => {
    it('records free-credit balance from projected result.order.total_amount', async () => {
      const update = jest.fn().mockResolvedValue({});
      (prisma as any).orders = { update };

      await (service as any).createOrderInstallments(
        { credit_type: 'free', installment_terms: { interest_rate: 0 } },
        { id: 41, total_amount: new Prisma.Decimal('1500.01') },
      );

      const write = update.mock.calls[0][0];
      expect(write.where).toEqual({ id: 41 });
      expect(write.data).toEqual(expect.objectContaining({
        credit_type: 'free', total_paid: 0,
      }));
      expect(write.data.remaining_balance).toBeInstanceOf(Prisma.Decimal);
      expect(write.data.remaining_balance.equals('1500.01')).toBe(true);
    });

    it('finances installments from projected result.order.total_amount', async () => {
      const update = jest.fn().mockResolvedValue({});
      const create = jest.fn().mockResolvedValue({});
      (prisma as any).orders = { update };
      (prisma as any).order_installments = { create };

      await (service as any).createOrderInstallments(
        { credit_type: 'installments', installment_terms: {
          num_installments: 2, frequency: 'monthly',
          first_installment_date: '2026-10-23', interest_rate: 0,
          initial_payment: 0,
        } },
        { id: 42, total_amount: new Prisma.Decimal(1500) },
      );

      expect(create).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 42 },
        data: expect.objectContaining({
          credit_type: 'installments', remaining_balance: 1500,
        }),
      }));
    });
  });

  // ---------------------------------------------------------------------------
  // Table lifecycle contract: a POS sale (deferred or not) MUST NOT close the
  // table session or flip `tables.status` to 'cleaning'. Only the canonical
  // `TableSessionsService.closeSession` owns those transitions. If someone
  // re-introduces the auto-close here, this test fails before the regression
  // reaches production. See PR #698 review note.
  // ---------------------------------------------------------------------------
  describe('applyPosPaymentToTableSession — table lifecycle contract', () => {
    const CONTEXT_STORE_ID = 1;
    let contextSpy: jest.SpyInstance;

    /**
     * Bare `tx` shim. Every Prisma call the private method makes is replaced
     * with a `jest.fn()` so we can assert exactly which writes the path emits
     * and which it never does. Default returns are "empty / ok" so the chain
     * doesn't throw on its way to the close-out block.
     */
    const buildTx = (session: any) => {
      const tx: any = {
        table_sessions: {
          findUnique: jest.fn().mockResolvedValue(session),
          update: jest.fn().mockResolvedValue({}),
        },
        tables: {
          update: jest.fn().mockResolvedValue({}),
        },
        order_items: {
          findMany: jest.fn().mockResolvedValue([]), // existing draft items
          findFirst: jest.fn().mockResolvedValue(null), // KDS candidate scan (line ~3033)
        },
        // Guard de re-entrada del cierre de mesa: busca un pago ya
        // `succeeded` sobre la misma orden antes de re-cobrar. Sin este mock
        // el arrange muere con "Cannot read properties of undefined" antes de
        // llegar al contrato que el test bloquea.
        payments: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        orders: {
          update: jest.fn().mockImplementation((args: any) =>
            Promise.resolve({
              id: args.where.id,
              order_items: [],
              stores: { id: CONTEXT_STORE_ID, organization_id: 1 },
            }),
          ),
        },
      };
      return tx;
    };

    const arrangeCashSale = () => {
      contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({
          store_id: CONTEXT_STORE_ID,
          organization_id: 1,
        } as any);

      const posUser: any = {
        id: 7,
        email: 'cajero@example.com',
        organization_id: 1,
        roles: ['super_admin'],
      };

      const session = {
        id: 99,
        store_id: CONTEXT_STORE_ID,
        table_id: 5,
        order_id: 1001,
        closed_at: null,
        order: { id: 1001, store_id: CONTEXT_STORE_ID },
      };

      const tx = buildTx(session);

      // Promotion/coupon re-evaluation helpers are stubs because the contract
      // we are locking here is the table lifecycle, not the discount engine.
      jest
        .spyOn(service as any, 'calculatePosPromotionQuote')
        .mockResolvedValue({ total_discount: 0, applied: [] });
      jest
        .spyOn(service as any, 'calculatePosCouponDiscount')
        .mockResolvedValue({
          coupon_id: null,
          coupon_code: null,
          discount_amount: 0,
        });

      // The private method pokes `prepareFireContext` and `fireOrderItemsInTx`;
      // their side-effects are out of scope. Returning `null`/`{ firedItemIds: [] }`
      // makes the fire branch a no-op so execution reaches the close-out block.
      (kitchenFire as any).prepareFireContext = jest.fn().mockResolvedValue(null);
      (kitchenFire as any).fireOrderItemsInTx = jest.fn().mockResolvedValue(null);

      return { tx, session, posUser };
    };

    const buildDto = (overrides: any = {}): any => ({
      table_session_id: 99,
      store_id: CONTEXT_STORE_ID,
      currency: 'COP',
      items: [],
      payments: [
        { method: 'cash', amount: 10000, status: 'completed' },
      ],
      ...overrides,
    });

    afterEach(() => {
      contextSpy?.mockRestore();
      jest.restoreAllMocks();
    });

    it('POS cash sale keeps the table session OPEN and the table `occupied`', async () => {
      const { tx, posUser } = arrangeCashSale();

      const result = await (
        service as any
      ).applyPosPaymentToTableSession(
        tx,
        buildDto(),
        posUser,
        CONTEXT_STORE_ID,
      );

      // Contract — locked by review on PR #698:
      //   1. `tx.table_sessions.update` MUST NEVER close the session here;
      //      the canonical `TableSessionsService.closeSession` owns that
      //      transition. Using `not.toHaveBeenCalledWith(...)` instead of
      //      a flat `not.toHaveBeenCalled()` so the test only breaks if a
      //      future change reintroduces the forbidden mutation, not for
      //      legitimate (e.g. `updated_at`) writes.
      //   2. `tx.tables.update` MUST NEVER flip the table to `cleaning`
      //      here; that flip belongs to `closeSession` too.
      //   3. `result.closedSessionId` MUST be null so the post-commit
      //      `session_closed` SSE emission stays gated on the canonical
      //      close path.
      expect(tx.table_sessions.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ closed_at: expect.anything() }),
        }),
      );
      expect(tx.tables.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'cleaning' }),
        }),
      );
      expect(result.closedSessionId).toBeNull();
      expect(
        (service as any).tableSessionsService.projectOrderPaymentToTableSession,
      ).not.toHaveBeenCalled();
    });

    it('cancelled items do NOT resurrect into the close-out totals', async () => {
      const { tx, posUser } = arrangeCashSale();

      // Pre-existing shim gap (QUI-704): `buildTx` predates the
      // second-charge guard (`tx.payments.findFirst`), so the shim has
      // no `payments` client. Scoped to THIS test only (contract:
      // solo el test nuevo) — no `succeeded` payment, close-out proceeds.
      tx.payments = { findFirst: jest.fn().mockResolvedValue(null) };
      // The draft order holds one active line ($10.000) and one line the
      // waiter cancelled earlier. Prisma scoping means `findMany` only
      // resolves what the `where` allows — the cancelled row must never
      // reach the mock, mirroring `cancelled_at IS NULL` at the DB level.
      tx.order_items.findMany.mockResolvedValue([
        {
          id: 1,
          quantity: 1,
          total_price: 10000,
          tax_amount_item: 0,
          order_item_taxes: [],
        },
      ]);

      const result = await (
        service as any
      ).applyPosPaymentToTableSession(
        tx,
        buildDto(),
        posUser,
        CONTEXT_STORE_ID,
      );

      // 1. The re-derive query itself must exclude cancelled rows, or a
      //    cancelled item resurrects into the amount the customer pays.
      expect(tx.order_items.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            order_id: 1001,
            cancelled_at: null,
          }),
        }),
      );
      // 2. Persisted totals reflect only the active line: the $5.000
      //    cancelled line is nowhere in subtotal / grand_total.
      expect(tx.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subtotal_amount: 10000,
            grand_total: 10000,
          }),
        }),
      );
      expect(result.order).toBeDefined();
    });

    it('conserva el impuesto persistido de una línea antigua aunque el catálogo actual no tenga asignación', async () => {
      const { tx, posUser } = arrangeCashSale();
      const oldTaxSnapshot = {
        tax_rate_id: 501, tax_type: TaxFiscalType.IVA,
        tax_rate: 0.19, tax_amount: 1900,
      };
      const existingLine = {
        id: 17, product_id: 425, quantity: 1, total_price: 10000,
        tax_amount_item: 1900, order_item_taxes: [oldTaxSnapshot],
      };
      tx.order_items.findMany.mockResolvedValue([existingLine]);
      const taxResolver = jest.spyOn(service as any, 'buildPosOrderItem');

      await (service as any).applyPosPaymentToTableSession(
        tx, buildDto({ items: [] }), posUser, CONTEXT_STORE_ID,
      );

      expect(taxResolver).not.toHaveBeenCalled();
      expect(tx.orders.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          subtotal_amount: 10000,
          tax_amount: 1900,
          grand_total: 11900,
        }),
      }));
      expect(existingLine.order_item_taxes).toEqual([oldTaxSnapshot]);
      expect(tx.order_items.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { order_id: 1001, cancelled_at: null },
      }));
    });
  });

  // QUI-783 — the `orders` table has `grand_total` but NO `total_amount`
  // column, so `result.order.total_amount` is always undefined. Both
  // post-commit `grand_total` reads must use the persisted
  // `result.order.grand_total`, never the frontend's `dto.total_amount`
  // estimate (which still carries the pre-coupon subtotal).
  //
  // `$transaction` is stubbed to resolve the canned post-commit result
  // directly: the in-transaction sale is not what these cases assert, and
  // running it would need hundreds of lines of unrelated mocks.
  describe('processPosPayment post-commit grand_total (QUI-783)', () => {
    const CONTEXT_STORE_ID = 1;
    let contextSpy: jest.SpyInstance;

    const posUser: any = {
      id: 1,
      email: 'cajero@example.com',
      organization_id: 1,
      roles: ['super_admin'],
    };

    // Persisted order shape, as Prisma returns it: HAS `grand_total`,
    // NEVER `total_amount`. `total_amount` only exists on the DTO.
    const PERSISTED_GRAND_TOTAL = 90;
    const DTO_TOTAL_ESTIMATE = 100;

    const arrange = () => {
      contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({
          store_id: CONTEXT_STORE_ID,
          organization_id: 1,
        } as any);
    };

    afterEach(() => {
      contextSpy?.mockRestore();
      jest.restoreAllMocks();
    });

    it('digital-payment site forwards the persisted grand_total, not the DTO estimate', async () => {
      arrange();
      (prisma as any).$transaction = jest.fn(async () => ({
        success: true,
        order: {
          id: 55,
          order_number: 'ORD Test 001',
          grand_total: PERSISTED_GRAND_TOTAL,
          currency: 'COP',
        },
        _digitalPaymentPending: true,
      }));

      const processTx = jest
        .spyOn(service as any, 'processPosPaymentTransaction')
        .mockResolvedValue({
          id: 7,
          amount: PERSISTED_GRAND_TOTAL,
          store_payment_method: { display_name: 'Wompi' },
          state: 'pending',
          transaction_id: 'txn_123',
          nextAction: { type: 'redirect', url: 'https://pay.test' },
        });

      const result = await service.processPosPayment(
        {
          store_id: CONTEXT_STORE_ID,
          currency: 'COP',
          customer_id: 77,
          items: [],
          payments: [],
          total_amount: DTO_TOTAL_ESTIMATE,
          requires_payment: true,
        } as any,
        posUser,
      );

      expect(processTx).toHaveBeenCalledTimes(1);
      const orderArg = processTx.mock.calls[0][1] as any;
      expect(orderArg.grand_total).toBe(PERSISTED_GRAND_TOTAL);
      expect(orderArg.grand_total).not.toBe(DTO_TOTAL_ESTIMATE);
      expect(result.payment).toMatchObject({ id: 7 });
    });

    it('draft audit site snapshots the persisted grand_total, not total_amount', async () => {
      arrange();
      (prisma as any).$transaction = jest.fn(async () => ({
        success: true,
        order: {
          id: 56,
          order_number: 'ORD Test 002',
          grand_total: PERSISTED_GRAND_TOTAL,
          currency: 'COP',
        },
      }));

      const result = await service.processPosPayment(
        {
          store_id: CONTEXT_STORE_ID,
          currency: 'COP',
          items: [],
          payments: [],
          total_amount: DTO_TOTAL_ESTIMATE,
          is_draft: true,
        } as any,
        posUser,
      );

      expect((result as any)._isDraft).toBe(true);
      const audit = (service as any).auditService.logCustom as jest.Mock;
      expect(audit).toHaveBeenCalledTimes(1);
      const details = audit.mock.calls[0][3];
      expect(details.grand_total).toBe(PERSISTED_GRAND_TOTAL);
      expect(details.grand_total).not.toBe(DTO_TOTAL_ESTIMATE);
    });
  });

  describe('buildPosOrderItem — TaxesService.calculateProductTaxes contract (F-157/F-166)', () => {
    // F-157/F-166: la forma completa del contrato real
    // (`taxes.service.ts:174-179`: total_rate, total_tax_amount, base, total,
    // taxes[] con tax_rate_id/name/rate/tax_type/is_inclusive/amount/base por
    // tasa) sólo se transforma cuando HAY bruto declarado que difiere del
    // catálogo (`isPriceOverridden`, B.1/QUI-832): ahí `invertDeclaredGross`
    // (`payments.service.ts:2810-2882`, antes `rescaleTaxInfo`) toma
    // total_rate/total_tax_amount/base/total y sobrescribe base/amount POR
    // TASA desde el retorno de `resolveLineTotals`. Desde B.2/ADR-03,
    // `is_inclusive` YA NO se sobrescribe con el eco del solver: sobrevive el
    // flag DEL CATÁLOGO vía el spread `...tax`, así que de los 11 campos del
    // contrato ahora 5 sobreviven intactos hasta `order_item_taxes`:
    // `tax_rate_id`, `name` (-> `tax_name`), `rate` (-> `tax_rate`),
    // `tax_type` e `is_inclusive`.
    //
    // Los dos tests de abajo cubren el camino SIN bruto declarado (el `item`
    // no manda `final_unit_price` ni `total_price`): ahí `resolveLineTotals`
    // no se llama en absoluto (B.1 mata la rama que promovía `total_price` a
    // bruto) y `taxInfo` es `catalogTaxInfo` VERBATIM, así que los 11 campos
    // sobreviven intactos — incluido `tax_amount`, que es un eco directo de
    // `total_tax_amount`/`taxes[].amount` de `calculateProductTaxes`, no un
    // recompute del kernel. La aserción que de verdad importa en ambos tests
    // es `resolveLineTotalsMock` en cero llamadas: es la que impide que
    // QUI-832 (la tasa exclusiva re-liquidada sobre un total que ya la
    // incluye) reaparezca.
    const dtoStoreId = 1;

    const product = {
      id: 10,
      name: 'Producto con IVA exclusivo',
      sku: 'SKU-10',
      base_price: 10000,
      is_on_sale: false,
      sale_price: null,
      product_type: 'simple',
      allow_pos_price_override: true,
      cost_price: 6000,
      price_unit_quantity: null,
    };

    const posUser: any = {
      id: 1,
      email: 'cajero@example.com',
      organization_id: 1,
      roles: ['super_admin'],
    };

    // Tipo del contrato real anotado explícito (no inferido): es la pieza que
    // realmente ata el ensanche de ADR-10. Un fixture escrito a mano contra
    // este alias deja de compilar el día que `unclosed_residual_cents`/
    // `invalid_inputs`/`resolved_from` se vuelvan campos requeridos del
    // retorno real, sin que nadie tenga que acordarse de tocar este archivo.
    type CalcProductTaxesResult = Awaited<
      ReturnType<TaxesService['calculateProductTaxes']>
    >;

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('propaga tax_rate_id/name/rate/tax_type hasta order_item_taxes; total/rate/is_inclusive recomputan vía el kernel real de resolveLineTotals (F-157/F-166)', async () => {
      const tx = {
        products: { findFirst: jest.fn().mockResolvedValue(product) },
      };
      const item = { product_id: product.id, quantity: 1, unit_price: 0 };

      const catalogTaxes: CalcProductTaxesResult = {
        total_rate: 0.19,
        total_tax_amount: 1900,
        base: 10000,
        total: 11900,
        taxes: [
          {
            tax_rate_id: 501,
            name: 'INC 19%',
            rate: 0.19,
            tax_type: TaxFiscalType.INC,
            is_inclusive: false,
            amount: 1900,
            base: 10000,
          },
        ],
        // B.3/ADR-10: campos que el ensanche de `calculateProductTaxes`
        // agrega al contrato real — un catálogo sin residuo ni entradas
        // inválidas es el caso normal.
        unclosed_residual_cents: 0,
        invalid_inputs: [],
        resolved_from: 'catalog',
      };
      calculateProductTaxesMock.mockResolvedValue(catalogTaxes);

      // B.1/QUI-832: el `item` no declara `final_unit_price` (y el móvil
      // tampoco manda `total_price` aquí), así que `resolveDeclaredGrossUnitPrice`
      // devuelve `null` → `isPriceOverridden = false` → `buildPosOrderItem`
      // usa `catalogTaxInfo` VERBATIM, sin volver a pasarlo por el kernel.
      const result = await (service as any).buildPosOrderItem(
        tx,
        item,
        dtoStoreId,
        posUser,
        undefined,
      );

      expect(calculateProductTaxesMock).toHaveBeenCalledWith(
        product.id,
        10000,
        expect.objectContaining({ client: tx, store_id: dtoStoreId }),
      );

      // B.1: sin bruto declarado no hay nada que re-despejar — el guard de
      // línea 0 llamadas es la aserción que de verdad impide la reincidencia
      // de QUI-832 (una tasa exclusiva NUNCA se re-liquida sobre un total que
      // ya la incluye). Las de dinero de abajo son consecuencia de ésta.
      expect(resolveLineTotalsMock).toHaveBeenCalledTimes(0);

      // `catalogTaxInfo` pasa intacto: `unit_price` (= `taxInfo.base`) es el
      // NETO del catálogo (10000), no el bruto (11900) — antes del fix
      // `invertDeclaredGross` (entonces `rescaleTaxInfo`) recibía ese bruto
      // como si NINGUNA tasa fuera inclusiva y el kernel volvía a sumar la
      // tasa exclusiva encima
      // (QUI-832: 11900 × 0,19 = 2261). `final_unit_price`/`catalog_final_price`
      // siguen en 11900 porque siguen siendo el precio con impuesto del
      // catálogo (10000 + 1900), que el fix no toca.
      expect(result.unit_price).toBe(10000);
      expect(result.final_unit_price).toBe(11900);
      expect(result.catalog_final_price).toBe(11900);
      // Sin override, `tax_amount_item`/`tax_rate` SON el passthrough directo
      // de `total_tax_amount`/`total_rate` de `calculateProductTaxes` — no hay
      // recompute porque no hay resolve.
      expect(result.tax_amount_item).toBe(1900);
      expect(result.tax_rate).toBeCloseTo(0.19);
      expect(result.order_item_taxes.create).toHaveLength(1);
      expect(result.order_item_taxes.create[0]).toMatchObject({
        // Los 4 campos que SÍ sobreviven intactos desde calculateProductTaxes:
        tax_rate_id: 501,
        tax_name: 'INC 19%',
        tax_rate: 0.19,
        tax_type: TaxFiscalType.INC,
        // Eco directo del `amount` del catálogo (1900) — ya no hay recompute
        // del kernel que lo duplique (QUI-832 corregido):
        tax_amount: 1900,
        is_inclusive: false,
      });
    });

    it('sin bruto declarado, tax_amount_item es el passthrough real de calculateProductTaxes para una tasa distinta — no hay constante congelada detrás (F-166/B.1)', async () => {
      // Antes del fix de F-166, `resolveLineTotals` era un
      // `jest.fn().mockReturnValue({...fijo...})`: cualquier tasa que se le
      // pasara devolvía SIEMPRE 1900/19%. Este caso usa una tasa distinta
      // (10% en vez de 19%) para demostrar que el resultado depende de
      // verdad de lo que devuelve `calculateProductTaxes`, no de una
      // constante congelada. Tras B.1, sin bruto declarado el guard de
      // catálogo ni siquiera llama a `resolveLineTotals` (ver aserción de
      // abajo): `tax_amount_item` es el eco directo de `total_tax_amount`
      // (1000 = 11000 × 0,10), no un recompute del kernel.
      const tx = {
        products: { findFirst: jest.fn().mockResolvedValue(product) },
      };
      const item = { product_id: product.id, quantity: 1, unit_price: 0 };

      const catalogTaxes: CalcProductTaxesResult = {
        total_rate: 0.1,
        total_tax_amount: 1000,
        base: 10000,
        total: 11000,
        taxes: [
          {
            tax_rate_id: 777,
            name: 'IVA 10%',
            rate: 0.1,
            tax_type: TaxFiscalType.IVA,
            is_inclusive: false,
            amount: 1000,
            base: 10000,
          },
        ],
        unclosed_residual_cents: 0,
        invalid_inputs: [],
        resolved_from: 'catalog',
      };
      calculateProductTaxesMock.mockResolvedValue(catalogTaxes);

      const result = await (service as any).buildPosOrderItem(
        tx,
        item,
        dtoStoreId,
        posUser,
        undefined,
      );

      expect(resolveLineTotalsMock).toHaveBeenCalledTimes(0);
      expect(result.tax_amount_item).toBe(1000);
      expect(result.order_item_taxes.create[0]).toMatchObject({
        tax_rate_id: 777,
        tax_name: 'IVA 10%',
        tax_rate: 0.1,
        tax_type: TaxFiscalType.IVA,
        tax_amount: 1000,
      });
    });

    it('V-2/B.4 — número de producción: base 5.200.000 con IVA 19% exclusivo persiste 6.188.000 (no la reincidencia 7.363.720 de la orden 5928), y G-1 no registra mismatch', async () => {
      // Mismo catálogo que la orden 5928 (B.1/B.3), llevado hasta el snapshot
      // completo vía `buildPosOrderItem` en vez de sólo `TaxesService` en
      // aislado (eso ya lo cubre
      // `taxes-calculate-product-taxes.regression.spec.ts`). Sin bruto
      // declarado (`item` no manda `final_unit_price`), B.1 impide que este
      // camino llegue a `invertDeclaredGross` — la aserción en cero llamadas
      // es la que de verdad impide la reincidencia de QUI-832.
      const tx = {
        products: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ ...product, base_price: 5200000 }),
        },
      };
      const item = { product_id: product.id, quantity: 1, unit_price: 0 };

      const catalogTaxes: CalcProductTaxesResult = {
        total_rate: 0.19,
        total_tax_amount: 988000,
        base: 5200000,
        total: 6188000,
        taxes: [
          {
            tax_rate_id: 900,
            name: 'IVA 19%',
            rate: 0.19,
            tax_type: TaxFiscalType.IVA,
            is_inclusive: false,
            amount: 988000,
            base: 5200000,
          },
        ],
        unclosed_residual_cents: 0,
        invalid_inputs: [],
        resolved_from: 'catalog',
      };
      calculateProductTaxesMock.mockResolvedValue(catalogTaxes);

      const errorSpy = jest.spyOn((service as any).logger, 'error');

      const result = await (service as any).buildPosOrderItem(
        tx,
        item,
        dtoStoreId,
        posUser,
        undefined,
      );

      expect(resolveLineTotalsMock).toHaveBeenCalledTimes(0);
      expect(result.unit_price).toBe(5200000);
      expect(result.total_price).toBe(5200000);
      expect(result.tax_amount_item).toBe(988000);
      expect(result.final_unit_price).toBe(6188000);
      expect(result.catalog_final_price).toBe(6188000);

      // G-1 (ADR-11): con la línea sana, la compuerta de escritura no debe
      // registrar `pos.line_gross_mismatch`.
      const mismatchCalls = errorSpy.mock.calls.filter(
        ([payload]) =>
          (payload as any)?.event === 'pos.line_gross_mismatch',
      );
      expect(mismatchCalls).toHaveLength(0);
    });

    /** ADR-10: la asignación fiscal actual no es una compuerta de cobro. */
    describe('buildPosOrderItem — línea nueva sin impuesto en POS mesa', () => {
      const tx = {
        products: { findFirst: jest.fn().mockResolvedValue(product) },
      };
      const item = { product_id: product.id, quantity: 1, unit_price: 0 };
      const taxless: CalcProductTaxesResult = {
        total_rate: 0,
        total_tax_amount: 0,
        base: 10000,
        total: 10000,
        taxes: [],
        unclosed_residual_cents: 0,
        invalid_inputs: [],
        resolved_from: 'catalog',
        has_tax_assignment: false,
      };

      it.each([false, true, undefined])(
        'cobra con impuesto cero cuando has_tax_assignment=%s',
        async (has_tax_assignment) => {
          calculateProductTaxesMock.mockResolvedValue({
            ...taxless,
            has_tax_assignment,
          });
          const result = await (service as any).buildPosOrderItem(
            tx, item, dtoStoreId, posUser, undefined, 123,
          );
          expect(result.tax_amount_item).toBe(0);
          expect(result.final_unit_price).toBe(10000);
          expect(result.order_item_taxes).toBeUndefined();
        },
      );

      it.each(['block', 'warn', 'off', undefined] as const)(
        'ignora la configuración legada tax_line_gate=%s para la línea sin impuesto',
        async (severity) => {
          const settingsRead = jest.spyOn(
            (service as any).settingsService,
            'getSettings',
          ).mockResolvedValue({ pos: { tax_line_gate: severity } });
          const falseWarning = jest.spyOn((service as any).logger, 'warn');
          calculateProductTaxesMock.mockResolvedValue(taxless);

          const result = await (service as any).buildPosOrderItem(
            tx, item, dtoStoreId, posUser, undefined, 123,
          );

          expect(result.tax_amount_item).toBe(0);
          expect(result.final_unit_price).toBe(10000);
          expect(result.order_item_taxes).toBeUndefined();
          expect(settingsRead).not.toHaveBeenCalled();
          expect(falseWarning.mock.calls.some(([message]) =>
            String(message).includes('pos_table_line_tax_unresolvable'),
          )).toBe(false);
        },
      );
    });

    /**
     * F-013 — el espejo de la compuerta G-1 en la rama custom usaba
     * `taxInfo.base`, un campo que `calculateTaxCategoryTaxes` nunca
     * devuelve (`undefined + monto = NaN`, y `roundMoney` colapsa `NaN` a
     * `0` en silencio): cualquier ítem personalizado con categoría de
     * impuesto disparaba un 409 falso. G-1 vive hoy en el punto común
     * (`buildOrderItemSnapshot`) y sólo lee valores YA REDONDEADOS del
     * `orderItem` a punto de persistirse — nunca `taxInfo.base` — así que
     * el escenario que originaba el `NaN` ya no es alcanzable. Este test
     * prueba el camino custom END TO END (no aislado) para que una
     * regresión futura que reintroduzca `taxInfo.base` en la rama custom
     * se vea aquí.
     */
    describe('buildPosOrderItem — ítem custom no dispara G-1 en falso (F-013)', () => {
      afterEach(() => {
        jest.restoreAllMocks();
      });

      it('ítem personalizado con categoría IVA 19% no registra pos.line_gross_mismatch', async () => {
        const tx = {
          stores: {
            findUnique: jest.fn().mockResolvedValue({ organization_id: 1 }),
          },
          tax_categories: {
            findFirst: jest.fn().mockResolvedValue({
              id: 9,
              is_inclusive: false,
              tax_rates: [{ id: 91, name: 'IVA 19%', rate: 0.19 }],
            }),
          },
        };
        const item = {
          item_type: 'custom',
          product_name: 'Instalación',
          quantity: 1,
          unit_price: 150000,
          tax_category_id: 9,
        };

        const errorSpy = jest.spyOn((service as any).logger, 'error');

        const result = await (service as any).buildPosOrderItem(
          tx,
          item,
          dtoStoreId,
          posUser,
          undefined,
        );

        const mismatchCalls = errorSpy.mock.calls.filter(
          ([payload]) => (payload as any)?.event === 'pos.line_gross_mismatch',
        );
        expect(mismatchCalls).toHaveLength(0);
        expect(result.final_unit_price).toBeCloseTo(178500, 2);
      });
    });

    /**
     * F-052 — la rama custom no tiene `product_tax_assignments` (no hay
     * producto): el único sitio con el flag INCLUIDO/AGREGADO para su
     * categoría es `tax_categories.is_inclusive`. Antes se hardcodeaba
     * `false`: una categoría inclusiva usada en un ítem custom persistía
     * `order_item_taxes.is_inclusive = false` y `needsOrderLineTaxSplit`
     * (invoicing) partía el XML DIAN al revés con los importes cuadrando
     * igual — el modo de falla que ADR-03 llama "el único real" del diseño.
     */
    /**
     * P2-3 — la base del ítem personalizado sale del kernel: truncada a
     * centavos y con base + cuota = bruto persistido. Antes `final / 1.19`
     * persistía 840.3361344… y el bruto `unit_price × 1.19` sin truncar.
     */
    describe('buildPosOrderItem — ítem custom con base del kernel (P2-3)', () => {
      afterEach(() => jest.restoreAllMocks());
      const txFor = () => ({
        stores: { findUnique: jest.fn().mockResolvedValue({ organization_id: 1 }) },
        tax_categories: {
          findFirst: jest.fn().mockResolvedValue({
            id: 9, is_inclusive: true,
            tax_rates: [{ id: 91, name: 'IVA 19%', rate: 0.19 }],
          }),
        },
      });

      it('bruto declarado 1000 IVA 19%: base 840.34, cuota 159.66, bruto 1000', async () => {
        const result = await (service as any).buildPosOrderItem(
          txFor(),
          { item_type: 'custom', product_name: 'Servicio', quantity: 1, unit_price: 0, final_unit_price: 1000, tax_category_id: 9 },
          dtoStoreId, posUser, undefined,
        );
        expect(result.unit_price).toBe(840.34);
        expect(result.tax_amount_item).toBe(159.66);
        expect(result.final_unit_price).toBe(1000);
        expect(Math.round(result.unit_price * 100) + Math.round(result.tax_amount_item * 100))
          .toBe(Math.round(result.final_unit_price * 100));
      });

      it('precio base 999.99 IVA 19%: base exacta, cuota truncada, bruto = base + cuota', async () => {
        const result = await (service as any).buildPosOrderItem(
          txFor(),
          { item_type: 'custom', product_name: 'Servicio', quantity: 1, unit_price: 999.99, tax_category_id: 9 },
          dtoStoreId, posUser, undefined,
        );
        expect(result.unit_price).toBe(999.99);
        expect(result.tax_amount_item).toBe(189.99);
        expect(result.final_unit_price).toBe(1189.98);
      });
    });

    describe('buildPosOrderItem — ítem custom persiste is_inclusive de la categoría (F-052)', () => {
      afterEach(() => {
        jest.restoreAllMocks();
      });

      it('categoría marcada is_inclusive=true se persiste en order_item_taxes, no hardcodeada a false', async () => {
        const tx = {
          stores: {
            findUnique: jest.fn().mockResolvedValue({ organization_id: 1 }),
          },
          tax_categories: {
            findFirst: jest.fn().mockResolvedValue({
              id: 9,
              is_inclusive: true,
              tax_rates: [{ id: 91, name: 'IVA 19% incluido', rate: 0.19 }],
            }),
          },
        };
        const item = {
          item_type: 'custom',
          product_name: 'Servicio con IVA incluido',
          quantity: 1,
          unit_price: 0,
          final_unit_price: 119000,
          tax_category_id: 9,
        };

        const result = await (service as any).buildPosOrderItem(
          tx,
          item,
          dtoStoreId,
          posUser,
          undefined,
        );

        expect(result.order_item_taxes.create).toHaveLength(1);
        expect(result.order_item_taxes.create[0]).toMatchObject({
          tax_rate_id: 91,
          is_inclusive: true,
        });
      });

      it('categoría sin is_inclusive (default false) sigue persistiendo false — sin regresión', async () => {
        const tx = {
          stores: {
            findUnique: jest.fn().mockResolvedValue({ organization_id: 1 }),
          },
          tax_categories: {
            findFirst: jest.fn().mockResolvedValue({
              id: 9,
              tax_rates: [{ id: 91, name: 'IVA 19%', rate: 0.19 }],
            }),
          },
        };
        const item = {
          item_type: 'custom',
          product_name: 'Instalación',
          quantity: 1,
          unit_price: 150000,
          tax_category_id: 9,
        };

        const result = await (service as any).buildPosOrderItem(
          tx,
          item,
          dtoStoreId,
          posUser,
          undefined,
        );

        expect(result.order_item_taxes.create[0]).toMatchObject({
          is_inclusive: false,
        });
      });
    });

    /**
     * QUI-INC — la línea AD-HOC (`product_id = NULL`, `item_type='custom'`)
     * persistía el `tax_rate_id`/`tax_name`/`tax_rate` REALES de la categoría
     * y fabricaba `tax_type='iva'`, porque `calculateTaxCategoryTaxes` nunca
     * devolvía el tipo y `buildOrderItemSnapshot` lo completaba con
     * `?? 'iva'`. Evidencia de producción (tienda 105, Pollo Árabe, sólo
     * recauda INC): `order_item_taxes.id=130`, `tax_rate_id=68`,
     * `tax_name='INC'`, `tax_rate=0.08000`, `tax_type='iva'` — mientras la
     * fila hermana del MISMO `tax_rate_id` nacida del catálogo (`id=111`)
     * decía `tax_type='inc'`. El XML DIAN transmitió lo persistido y la DIAN
     * aceptó un "IVA del 8 %" que no existe en Colombia (0/5/19).
     *
     * El test fija los CUATRO campos juntos: el defecto no era que faltara
     * uno, era que unos salían de la fila 68 y otro de un default local.
     */
    describe('buildPosOrderItem — la línea ad-hoc hereda el tipo fiscal de su categoría (QUI-INC)', () => {
      afterEach(() => {
        jest.restoreAllMocks();
      });

      // Réplica de `tax_categories.id=96` de la tienda 105: INC, inclusivo
      // por mandato legal (Art. 512-9 ET: el INC va incluido en el precio al
      // público), con su única tasa `tax_rates.id=68` al 8 %.
      const incCategoryTx = () => ({
        stores: {
          findUnique: jest.fn().mockResolvedValue({ organization_id: 1 }),
        },
        tax_categories: {
          findFirst: jest.fn().mockResolvedValue({
            id: 96,
            name: 'INC',
            tax_type: 'inc',
            is_inclusive: true,
            tax_rates: [{ id: 68, name: 'INC', rate: 0.08 }],
          }),
        },
      });

      it('persiste tax_type="inc" e is_inclusive=true (no "iva"/false) para un ítem sin product_id', async () => {
        const item = {
          item_type: 'custom',
          // El defecto vivía justo acá: sin `product_id` no hay
          // `product_tax_assignments` y la categoría es la única fuente.
          product_id: null,
          product_name: 'Test sin factura',
          quantity: 1,
          unit_price: 0,
          final_unit_price: 10800,
          tax_category_id: 96,
        };

        const result = await (service as any).buildPosOrderItem(
          incCategoryTx(),
          item,
          dtoStoreId,
          posUser,
          undefined,
        );

        expect(result.products).toBeUndefined();
        expect(result.order_item_taxes.create).toHaveLength(1);
        // Los cuatro campos de la MISMA fila 68 — ninguno inventado.
        expect(result.order_item_taxes.create[0]).toMatchObject({
          tax_rate_id: 68,
          tax_name: 'INC',
          tax_type: 'inc',
          is_inclusive: true,
        });
        expect(Number(result.order_item_taxes.create[0].tax_rate)).toBeCloseTo(
          0.08,
          5,
        );
      });

      it('categoría sin tax_type sigue cayendo a "iva" — el default canónico, resuelto en la categoría', async () => {
        const tx = {
          stores: {
            findUnique: jest.fn().mockResolvedValue({ organization_id: 1 }),
          },
          tax_categories: {
            findFirst: jest.fn().mockResolvedValue({
              id: 9,
              tax_rates: [{ id: 91, name: 'IVA 19%', rate: 0.19 }],
            }),
          },
        };
        const item = {
          item_type: 'custom',
          product_id: null,
          product_name: 'Instalación',
          quantity: 1,
          unit_price: 150000,
          tax_category_id: 9,
        };

        const result = await (service as any).buildPosOrderItem(
          tx,
          item,
          dtoStoreId,
          posUser,
          undefined,
        );

        expect(result.order_item_taxes.create[0]).toMatchObject({
          tax_rate_id: 91,
          tax_type: 'iva',
        });
      });

      it('categoría no resoluble rechaza con POS_CUSTOM_ITEM_TAX_CATEGORY_UNRESOLVABLE_001 en vez de inventar el tributo', async () => {
        const tx = {
          stores: {
            findUnique: jest.fn().mockResolvedValue({ organization_id: 1 }),
          },
          tax_categories: { findFirst: jest.fn().mockResolvedValue(null) },
        };
        const item = {
          item_type: 'custom',
          product_id: null,
          product_name: 'Ítem sin categoría válida',
          quantity: 1,
          unit_price: 1000,
          tax_category_id: 4242,
        };

        // Se afirma el `errorCode` exacto: un `toBeInstanceOf` pasaría con
        // cualquier guarda anterior y no fijaría esta compuerta.
        await expect(
          (service as any).buildPosOrderItem(
            tx,
            item,
            dtoStoreId,
            posUser,
            undefined,
          ),
        ).rejects.toMatchObject({
          errorCode:
            ErrorCodes.POS_CUSTOM_ITEM_TAX_CATEGORY_UNRESOLVABLE_001.code,
        });
      });

      it('sin tax_category_id NO escribe fila alguna — ausencia de impuesto, no un IVA inventado', async () => {
        const tx = {
          stores: {
            findUnique: jest.fn().mockResolvedValue({ organization_id: 1 }),
          },
          tax_categories: { findFirst: jest.fn() },
        };
        const item = {
          item_type: 'custom',
          product_id: null,
          product_name: 'Propina',
          quantity: 1,
          unit_price: 5000,
        };

        const result = await (service as any).buildPosOrderItem(
          tx,
          item,
          dtoStoreId,
          posUser,
          undefined,
        );

        expect(result.order_item_taxes).toBeUndefined();
        expect(tx.tax_categories.findFirst).not.toHaveBeenCalled();
      });
    });

    describe('buildOrderItemSnapshot — G-1 gate (ADR-11/B.4): registra, no lanza', () => {
      // G-1 evaluado directo sobre `buildOrderItemSnapshot`, sin pasar por
      // `buildPosOrderItem`: aísla la compuerta del resto del pipeline (el
      // camino sano hasta aquí ya lo cubre el test de arriba). Los valores
      // reproducen LITERAL el ejemplo de ADR-11/design-P1-code.md §6 para la
      // orden 5928: el bruto reconstruido (`unit_price + tax_amount_item`)
      // da `6.188.000 + 1.175.720 = 7.363.720`, que diverge de
      // `final_unit_price` (`6.188.000`) con delta `1.175.720` — el defecto
      // que el predicado viejo (`|unit_price × tax_rate − tax_amount_item| ≤
      // 0,02`) no podía ver porque era internamente consistente.
      const baseParams = {
        item: {},
        productName: 'Producto con IVA exclusivo',
        itemType: 'physical',
        quantity: 1,
        lineUnits: 1,
        catalogUnitPrice: 5200000,
        catalogFinalPrice: 6188000,
        costPrice: null,
      };

      it('registra pos.line_gross_mismatch con los diez campos y NO lanza', () => {
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        let result: any;
        expect(() => {
          result = (service as any).buildOrderItemSnapshot({
            ...baseParams,
            unitBasePrice: 6188000,
            finalUnitPrice: 6188000,
            isPriceOverridden: true,
            productId: 10,
            storeId: 3,
            userId: 42,
            taxInfo: {
              total_rate: 0.19,
              total_tax_amount: 1175720,
              taxes: [
                {
                  tax_rate_id: 900,
                  name: 'IVA 19%',
                  rate: 0.19,
                  tax_type: TaxFiscalType.IVA,
                  is_inclusive: false,
                  amount: 1175720,
                },
              ],
            },
          });
        }).not.toThrow();

        // La compuerta REGISTRA, no bloquea (ADR-11): el snapshot se
        // construye y se devuelve igual, con los valores tal como se iban a
        // persistir.
        expect(result.final_unit_price).toBe(6188000);

        expect(errorSpy).toHaveBeenCalledWith({
          event: 'pos.line_gross_mismatch',
          store_id: 3,
          user_id: 42,
          product_id: 10,
          resolved_from: 'custom',
          unit_price: 6188000,
          tax_amount_item: 1175720,
          weight: 0,
          final_unit_price: 6188000,
          computed_gross_unit_price: 7363720,
          delta: 1175720,
        });
      });

      it('con la línea sana (bruto reconstruido == final_unit_price) no registra nada', () => {
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        (service as any).buildOrderItemSnapshot({
          ...baseParams,
          unitBasePrice: 5200000,
          finalUnitPrice: 6188000,
          isPriceOverridden: false,
          productId: 10,
          storeId: 3,
          userId: 42,
          taxInfo: {
            total_rate: 0.19,
            total_tax_amount: 988000,
            taxes: [
              {
                tax_rate_id: 900,
                name: 'IVA 19%',
                rate: 0.19,
                tax_type: TaxFiscalType.IVA,
                is_inclusive: false,
                amount: 988000,
              },
            ],
          },
        });

        const mismatchCalls = errorSpy.mock.calls.filter(
          ([payload]) =>
            (payload as any)?.event === 'pos.line_gross_mismatch',
        );
        expect(mismatchCalls).toHaveLength(0);
      });

      // P2-3 — umbral alineado con la compuerta de dinero (1 ¢, en centavos
      // enteros). Antes toleraba 2 ¢ (`>= 3`, herencia del `> 0.02` en
      // floats). El residuo closest-below que el kernel ya reportó no se
      // duplica como error.
      it('P2-4: la línea del POS pasa por la compuerta I-1 sin violación (base de la métrica)', () => {
        const warnSpy = jest.spyOn(Logger.prototype, 'warn');
        (service as any).buildOrderItemSnapshot({
          ...baseParams,
          quantity: 3,
          lineUnits: 3,
          unitBasePrice: 925.93,
          finalUnitPrice: 1000,
          isPriceOverridden: false,
          productId: 10,
          storeId: 3,
          userId: 42,
          taxInfo: { total_rate: 0.08, total_tax_amount: 74.07, taxes: [] },
        });
        const violations = warnSpy.mock.calls.filter(
          ([payload]) => (payload as any)?.event === 'orders.line_total_invariant_violation',
        );
        expect(violations).toHaveLength(0);
      });

      it('P2-3: delta de 0¢ no registra', () => {
        const errorSpy = jest.spyOn((service as any).logger, 'error');
        (service as any).buildOrderItemSnapshot({
          ...baseParams,
          unitBasePrice: 13603.12,
          finalUnitPrice: 13603.12,
          isPriceOverridden: false,
          productId: 10,
          storeId: 3,
          userId: 42,
          taxInfo: { total_rate: 0, total_tax_amount: 0, taxes: [] },
        });
        const mismatchCalls = errorSpy.mock.calls.filter(
          ([payload]) => (payload as any)?.event === 'pos.line_gross_mismatch',
        );
        expect(mismatchCalls).toHaveLength(0);
      });

      it('P2-3: delta de 1¢ (13603.13 vs 13603.12) SÍ registra — antes se toleraba', () => {
        const errorSpy = jest.spyOn((service as any).logger, 'error');
        (service as any).buildOrderItemSnapshot({
          ...baseParams,
          unitBasePrice: 13603.13,
          finalUnitPrice: 13603.12,
          isPriceOverridden: false,
          productId: 10,
          storeId: 3,
          userId: 42,
          taxInfo: { total_rate: 0, total_tax_amount: 0, taxes: [] },
        });
        const mismatchCalls = errorSpy.mock.calls.filter(
          ([payload]) => (payload as any)?.event === 'pos.line_gross_mismatch',
        );
        expect(mismatchCalls).toHaveLength(1);
        expect(mismatchCalls[0][0]).toMatchObject({ delta: 0.01 });
      });

      it('P2-3: 1¢ explicado por el residuo closest-below ya reportado no se duplica', () => {
        const errorSpy = jest.spyOn((service as any).logger, 'error');
        (service as any).buildOrderItemSnapshot({
          ...baseParams,
          unitBasePrice: 13603.11,
          finalUnitPrice: 13603.12,
          isPriceOverridden: false,
          productId: 10,
          storeId: 3,
          userId: 42,
          taxInfo: {
            total_rate: 0, total_tax_amount: 0, taxes: [], unclosed_residual_cents: 1,
          },
        });
        const mismatchCalls = errorSpy.mock.calls.filter(
          ([payload]) => (payload as any)?.event === 'pos.line_gross_mismatch',
        );
        expect(mismatchCalls).toHaveLength(0);
      });
    });
  });

  /**
   * F-196 (B.2) — el camino de override de `invertDeclaredGross` por fin
   * tiene tests. Es el cambio de comportamiento más delicado de B.2 (fuerza
   * `is_inclusive: true` en TODAS las tasas al invertir un bruto declarado,
   * ADR-01) y se desplegaba sin una sola aserción sobre su aritmética.
   */
  describe('buildPosOrderItem — camino override con bruto declarado (F-196)', () => {
    const dtoStoreId = 1;

    const product = {
      id: 10,
      name: 'Producto con IVA exclusivo',
      sku: 'SKU-10',
      base_price: 10000,
      is_on_sale: false,
      sale_price: null,
      product_type: 'simple',
      allow_pos_price_override: true,
      cost_price: 6000,
      price_unit_quantity: null,
    };

    const posUser: any = {
      id: 1,
      email: 'cajero@example.com',
      organization_id: 1,
      roles: ['super_admin'],
    };

    type CalcProductTaxesResult = Awaited<
      ReturnType<TaxesService['calculateProductTaxes']>
    >;

    const catalogExclusive = (): CalcProductTaxesResult => ({
      total_rate: 0.19,
      total_tax_amount: 1900,
      base: 10000,
      total: 11900,
      taxes: [
        {
          tax_rate_id: 501,
          name: 'IVA 19%',
          rate: 0.19,
          tax_type: TaxFiscalType.IVA,
          is_inclusive: false,
          amount: 1900,
          base: 10000,
        },
      ],
      unclosed_residual_cents: 0,
      invalid_inputs: [],
      resolved_from: 'catalog',
    });

    const txFor = (p: any) => ({
      products: { findFirst: jest.fn().mockResolvedValue(p) },
    });

    it('bruto declarado con tasa exclusiva: UNA llamada al solver, tasas forzadas a inclusivas, se cobra el bruto declarado', async () => {
      calculateProductTaxesMock.mockResolvedValue(catalogExclusive());
      // Bruto declarado 13.000 ≠ catálogo 11.900 ⇒ override, con permiso.
      const item = {
        product_id: product.id,
        quantity: 1,
        final_unit_price: 13000,
      };

      const result = await (service as any).buildPosOrderItem(
        txFor(product),
        item,
        dtoStoreId,
        posUser,
        undefined,
      );

      // (1) El kernel corre exactamente UNA vez — nunca dos (el doble
      // resolve era QUI-832).
      expect(resolveLineTotalsMock).toHaveBeenCalledTimes(1);
      // (2) El solver recibe TODAS las tasas como inclusivas: describe el
      // INPUT (bruto declarado), no el catálogo (ADR-01).
      const ratesArg = resolveLineTotalsMock.mock.calls[0][1] as any[];
      expect(ratesArg).toHaveLength(1);
      expect(ratesArg.every((r) => r.is_inclusive === true)).toBe(true);
      // (3) El total cobrado es EL BRUTO DECLARADO, no el bruto × (1+r).
      expect(result.final_unit_price).toBe(13000);
      expect(result.is_price_overridden).toBe(true);
      // Y el flag persistido sigue siendo el del catálogo (ADR-03).
      expect(result.order_item_taxes.create[0].is_inclusive).toBe(false);
    });

    it('mixto (una inclusiva + una exclusiva): el forzado a true también cubre la exclusiva', async () => {
      const mixed: CalcProductTaxesResult = {
        total_rate: 0.24,
        total_tax_amount: 2400,
        base: 10000,
        total: 12400,
        taxes: [
          {
            tax_rate_id: 501,
            name: 'IVA 19%',
            rate: 0.19,
            tax_type: TaxFiscalType.IVA,
            is_inclusive: false,
            amount: 1900,
            base: 10000,
          },
          {
            tax_rate_id: 502,
            name: 'INC 5%',
            rate: 0.05,
            tax_type: TaxFiscalType.INC,
            is_inclusive: true,
            amount: 500,
            base: 10000,
          },
        ],
        unclosed_residual_cents: 0,
        invalid_inputs: [],
        resolved_from: 'catalog',
      };
      calculateProductTaxesMock.mockResolvedValue(mixed);
      const item = {
        product_id: product.id,
        quantity: 1,
        final_unit_price: 13000,
      };

      const result = await (service as any).buildPosOrderItem(
        txFor(product),
        item,
        dtoStoreId,
        posUser,
        undefined,
      );

      expect(resolveLineTotalsMock).toHaveBeenCalledTimes(1);
      const ratesArg = resolveLineTotalsMock.mock.calls[0][1] as any[];
      expect(ratesArg).toHaveLength(2);
      expect(ratesArg.every((r) => r.is_inclusive === true)).toBe(true);
      expect(result.final_unit_price).toBe(13000);
    });

    it('F-070: sin permiso de override el rechazo trae error_code tipado', async () => {
      calculateProductTaxesMock.mockResolvedValue(catalogExclusive());
      const item = {
        product_id: product.id,
        quantity: 1,
        final_unit_price: 13000,
      };
      const tx = txFor({ ...product, allow_pos_price_override: false });

      let caught: any;
      try {
        await (service as any).buildPosOrderItem(
          tx,
          item,
          dtoStoreId,
          posUser,
          undefined,
        );
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      expect(caught.errorCode).toBe('POS_PRICE_OVERRIDE_NOT_ALLOWED_001');
    });

    it('F-222: 1¢ real (declarado 13603.13 vs catálogo 13603.12) SÍ es override aunque el float diga que no', async () => {
      // El par canónico: Math.abs(13603.13-13603.12) = 0.00999999999839...,
      // así que el `>= 0.01` viejo NO armaba el guard y la venta pasaba como
      // precio de catálogo. En centavos enteros difieren en 1¢: es override.
      calculateProductTaxesMock.mockResolvedValue({
        ...catalogExclusive(),
        total: 13603.12,
      });
      const item = {
        product_id: product.id,
        quantity: 1,
        final_unit_price: 13603.13,
      };
      const tx = txFor({ ...product, allow_pos_price_override: false });

      let caught: any;
      try {
        await (service as any).buildPosOrderItem(
          tx,
          item,
          dtoStoreId,
          posUser,
          undefined,
        );
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      expect(caught.errorCode).toBe('POS_PRICE_OVERRIDE_NOT_ALLOWED_001');
    });
  });

  /**
   * Hallazgo 4 (CP-post-QUI-832, paso 6) — la compuerta `fixed_base` de
   * `invertDeclaredGross` es código defensivo sin productor real hoy
   * (`calculateProductTaxes` nunca emite `fixed_base`), así que se fija por
   * código de error: una tasa con base propia rechaza con
   * `POS_DECLARED_GROSS_FIXED_BASE_001` en vez de repartirse en silencio
   * como tasa ordinaria. Se afirma el `errorCode` exacto — un
   * `toBeInstanceOf(VendixHttpException)` pasaría con cualquier guarda
   * anterior y no fijaría esta compuerta.
   */
  describe('invertDeclaredGross — compuerta fixed_base (hallazgo 4)', () => {
    it('tasa con base propia rechaza con POS_DECLARED_GROSS_FIXED_BASE_001', async () => {
      // Literal casteado, no derivado del tipo de `calculateProductTaxes`:
      // el productor real nunca trae `fixed_base` y el test debe seguir
      // describiendo el contrato aunque su firma cambie.
      const source = {
        total_rate: 0.19,
        total_tax_amount: 19000,
        base: 100000,
        total: 119000,
        taxes: [
          {
            tax_rate_id: 501,
            name: 'AIU-test',
            rate: 0.19,
            tax_type: TaxFiscalType.IVA,
            is_inclusive: true,
            amount: 19000,
            base: 100000,
            fixed_base: 100000,
          },
        ],
        unclosed_residual_cents: 0,
        invalid_inputs: [],
        resolved_from: 'catalog',
      } as any;
      // `invertDeclaredGross` es privado y síncrono: se invoca por índice y
      // se envuelve en una promesa inmediata para afirmar el rechazo con el
      // código exacto.
      await expect(
        (async () => (service as any).invertDeclaredGross(source, 119000))(),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.POS_DECLARED_GROSS_FIXED_BASE_001.code,
      });
    });
  });

  /**
   * F-014 (B.2) — las dos tuberías de redondeo divergen 1¢ con `lineUnits`
   * fraccionario y más de una tasa. No se afirma una igualdad que no existe:
   * se fija la tolerancia `|Σ OIT − TAI × L| ≤ 0,01 × n_tasas`, ejercitada
   * con el caso calculado del hallazgo (base 10,06; 19% + 8%; L = 2,5).
   */
  describe('buildPosOrderItem — tolerancia de redondeo multi-tasa (F-014)', () => {
    it('|Σ order_item_taxes − tax_amount_item × lineUnits| ≤ 0,01 × n_tasas', async () => {
      const dtoStoreId = 1;
      const product: any = {
        id: 11,
        name: 'Mixto 19+8',
        sku: 'SKU-11',
        base_price: 10.06,
        is_on_sale: false,
        sale_price: null,
        product_type: 'simple',
        allow_pos_price_override: true,
        cost_price: 6,
        price_unit_quantity: null,
      };
      const posUser: any = {
        id: 1,
        email: 'cajero@example.com',
        organization_id: 1,
        roles: ['super_admin'],
      };
      // Cuotas del hallazgo: [1,91 ; 0,80], total 2,71.
      calculateProductTaxesMock.mockResolvedValue({
        total_rate: 0.27,
        total_tax_amount: 2.71,
        base: 10.06,
        total: 12.77,
        taxes: [
          {
            tax_rate_id: 501,
            name: 'IVA 19%',
            rate: 0.19,
            tax_type: TaxFiscalType.IVA,
            is_inclusive: false,
            amount: 1.91,
            base: 10.06,
          },
          {
            tax_rate_id: 502,
            name: 'IVA 8%',
            rate: 0.08,
            tax_type: TaxFiscalType.IVA,
            is_inclusive: false,
            amount: 0.8,
            base: 10.06,
          },
        ],
        unclosed_residual_cents: 0,
        invalid_inputs: [],
        resolved_from: 'catalog',
      });
      const tx = {
        products: { findFirst: jest.fn().mockResolvedValue(product) },
      };
      const item = { product_id: product.id, quantity: 2.5, unit_price: 0 };

      const result = await (service as any).buildPosOrderItem(
        tx,
        item,
        dtoStoreId,
        posUser,
        undefined,
      );

      const rows = result.order_item_taxes.create as any[];
      expect(rows).toHaveLength(2);
      const sumOit = rows.reduce((s, r) => s + Number(r.tax_amount), 0);
      const bound = 0.01 * rows.length;
      expect(Math.abs(sumOit - result.tax_amount_item * 2.5)).toBeLessThanOrEqual(
        bound + 1e-9,
      );
    });
  });

  /**
   * F-018 (B.2) — la rama custom truncaba en float y ADR-04 asciende esas
   * filas a autoritativas. Cada cuota pasa por `truncMoney` (DIAN Anexo 1.9
   * §11.2) y el total es la suma de cuotas truncadas.
   */
  describe('calculateTaxCategoryTaxes — truncado DIAN (F-018)', () => {
    it('trunca cada cuota y suma truncados, no el float', async () => {
      const tx = {
        stores: {
          findUnique: jest.fn().mockResolvedValue({ organization_id: 1 }),
        },
        tax_categories: {
          findFirst: jest.fn().mockResolvedValue({
            id: 9,
            tax_rates: [
              { id: 91, name: 'IVA 19%', rate: 0.19 },
              { id: 92, name: 'IVA 5%', rate: 0.05 },
            ],
          }),
        },
      };

      const out = await (service as any).calculateTaxCategoryTaxes(
        tx,
        9,
        10.06,
        1,
      );

      // Float: 1,9114 + 0,503 = 2,4144. Truncado DIAN: 1,91 + 0,50 = 2,41.
      expect(out.taxes[0].amount).toBe(1.91);
      expect(out.taxes[1].amount).toBe(0.5);
      expect(out.total_tax_amount).toBe(2.41);
    });
  });

  /**
   * F-085 (B.2) — el peso se redondea a 3 decimales antes de multiplicar,
   * igual que la columna `numeric(10,3)`. La 4ª cifra sólo vivía en memoria
   * y la relectura de I-1 derivaba.
   */
  describe('getPosLineUnits — redondeo de peso F-085', () => {
    const units = (item: any) => (service as any).getPosLineUnits(item);

    it('redondea el peso a 3 decimales', () => {
      expect(units({ weight: 1.23456, quantity: 1 })).toBe(1.235);
    });

    it('sin peso usa la cantidad intacta', () => {
      expect(units({ quantity: 3 })).toBe(3);
    });
  });

  /**
   * El inventario sale cuando el dinero ENTRA, no cuando se promete.
   *
   * `isDirectDeliveryFinished` (payments.service.ts) decidía el consumo de
   * stock mirando solo `requires_payment` + `delivery_type` + `hasSerialized`,
   * y se evaluaba FUERA de las tres ramas que distinguen el tipo de pago. Un
   * cobro con Wompi en mostrador caía por esa puerta: el pago quedaba
   * `pending_payment` esperando el webhook, pero el stock ya había salido de
   * `on_hand` — y `commitOrderDelivery` remata barriendo las reservas como
   * `consumed`, así que no quedaba nada que expirara ni que `cancelOrder`
   * pudiera devolver (solo restaura `available` desde `reserved`). Si el
   * cliente abandonaba el widget, la pérdida era permanente.
   *
   * La aserción es sobre el SEAM real (`OrderStockCommitService.
   * commitOrderDelivery`), no sobre un predicado extraído: un predicado puro
   * puede estar correcto y no estar cableado al sitio de llamada.
   */
  describe('processPosPayment — el pago digital diferido NO consume stock al cobrar', () => {
    // Corta la ejecución JUSTO DESPUÉS del punto de decisión de inventario
    // (payments.service.ts §3). `tx.order_items.findMany` es la primera
    // llamada posterior a esa rama y, con tienda no-restaurante, no se
    // invoca antes (el bloque de auto-fire queda excluido). Lo que sigue
    // —breakdown de impuestos, retenciones, asientos, eventos— no es lo que
    // estos casos assertan.
    const STOP_AFTER_INVENTORY = 'stop-after-inventory-decision';

    const posUser: any = {
      id: 1,
      email: 'cajero@example.com',
      organization_id: 1,
      roles: ['super_admin'],
    };

    /**
     * @param methodType tipo de `system_payment_methods` que resuelve
     *   `isDeferredDigitalMethod`: `wompi`/`wallet` difieren al webhook,
     *   `cash`/`card`/`bank_transfer` liquidan en banda.
     */
    const arrangePosSale = (methodType: string) => {
      // `RequestContextService.getContext` es estático: el espía que instala
      // este helper lo retira el `jest.restoreAllMocks()` del afterEach.
      mockRequestContext({ store_id: 1, organization_id: 1 });

      const order = buildOrder({
        id: 4242,
        store_id: 1,
        // Venta de mostrador: el cliente se lleva la mercancía en el acto.
        // Es EXACTAMENTE el caso que el predicado viejo daba por entregado.
        delivery_type: 'direct_delivery',
        stores: { id: 1, organization_id: 1 },
        // Sin líneas: los bucles de validación/reserva de stock quedan en
        // no-op y el caso se concentra en la decisión de consumo.
        order_items: [],
      });

      const tx: any = {
        kitchen_tickets: { findMany: jest.fn().mockResolvedValue([]) },
        // Tienda NO restaurante → el bloque de auto-fire (B5) no corre y
        // `tx.order_items.findMany` queda libre como punto de corte.
        stores: {
          findUnique: jest.fn().mockResolvedValue({ industries: ['retail'] }),
        },
        store_payment_methods: {
          findUnique: jest.fn().mockResolvedValue({
            id: 9,
            system_payment_method: { type: methodType },
          }),
        },
        orders: { update: jest.fn().mockResolvedValue({ id: 4242 }) },
        order_items: {
          findMany: jest
            .fn()
            .mockRejectedValue(new Error(STOP_AFTER_INVENTORY)),
        },
      };

      (prisma as any).$transaction = jest.fn(async (cb: any) => cb(tx));

      jest
        .spyOn(service as any, 'createOrUpdateOrderFromPos')
        .mockResolvedValue({
          order,
          hasSerialized: false,
          promotionsSnapshot: [],
          appliedPromotions: [],
          couponInfo: {
            coupon_id: null,
            coupon_code: null,
            discount_amount: 0,
          },
          kitchenFire: null,
          closedSessionId: null,
        });

      (
        fiscalThreshold.assertInvoiceNotRequired as jest.Mock
      ).mockResolvedValue(undefined);

      return { order, tx };
    };

    const buildPosDto = (overrides: any = {}): any => ({
      store_id: 1,
      currency: 'COP',
      customer_id: 77,
      items: [],
      payments: [],
      requires_payment: true,
      store_payment_method_id: 9,
      ...overrides,
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('un cobro Wompi en mostrador deja el stock quieto: el pago está prometido, no cobrado', async () => {
      arrangePosSale('wompi');

      await expect(
        service.processPosPayment(buildPosDto(), posUser),
      ).rejects.toThrow(STOP_AFTER_INVENTORY);

      // El seam canónico de consumo NO se tocó. Con la reserva intacta, el
      // abandono del widget deja de ser una pérdida permanente.
      expect(commitOrderDeliveryMock).not.toHaveBeenCalled();
    });

    it('lo mismo para wallet, el otro método que solo liquida por webhook', async () => {
      arrangePosSale('wallet');

      await expect(
        service.processPosPayment(buildPosDto(), posUser),
      ).rejects.toThrow(STOP_AFTER_INVENTORY);

      expect(commitOrderDeliveryMock).not.toHaveBeenCalled();
    });

    it('el efectivo SÍ consume en el acto: el dinero ya entró (no-regresión)', async () => {
      const { order } = arrangePosSale('cash');

      // El cobro en banda crea el `payments` row dentro de la transacción;
      // se stubea para aislar la decisión de inventario del procesador.
      jest
        .spyOn(service as any, 'processPosPaymentTransaction')
        .mockResolvedValue({ id: 7, state: 'succeeded' });
      // Backstop F2 (`updateOrderPaymentStatus`): sin cocina pendiente la
      // venta directa termina en `finished`.
      jest
        .spyOn(service as any, 'hasPendingKitchenItemsTx')
        .mockResolvedValue(false);

      await expect(
        service.processPosPayment(buildPosDto(), posUser),
      ).rejects.toThrow(STOP_AFTER_INVENTORY);

      expect(commitOrderDeliveryMock).toHaveBeenCalledTimes(1);
      // Y contra la orden real, con las opciones del carril POS.
      expect(commitOrderDeliveryMock).toHaveBeenCalledWith(
        order.id,
        expect.objectContaining({
          movementType: 'sale',
          blockOnInsufficient: true,
          consumeSerials: true,
        }),
        expect.anything(),
      );
    });
  });

  /**
   * El dinero de una contra entrega entra cuando el repartidor lo recauda, no
   * cuando el POS emite la orden.
   *
   * `processPosPaymentTransaction` clasificaba el método con una lista literal
   * (`['wompi','wallet']`): todo lo que no fuera pasarela caía por la rama
   * "directa" y nacía `succeeded`. Una venta contra entrega cobrada desde /pos
   * reconocía caja en el acto — asiento DR caja / CR ingreso emitido con
   * `payment.received`, `remaining_balance` saneado a 0 — y con el saldo en 0
   * `resolveIsPrepaid` (route-stop-calc.ts:277) daba la remisión por PREPAGADA,
   * así que la parada de la ruta nacía con `expected = 0` y el repartidor salía
   * a entregar sin nada que recaudar.
   *
   * El discriminador correcto es `system_payment_methods.processing_mode`
   * (`ON_DELIVERY`), la MISMA columna que ya gobierna el carril de ecommerce
   * (`checkout.service.ts:455`), no el nombre del método: un tipo nuevo de
   * contra entrega entra por la columna sin tocar este archivo.
   *
   * Las aserciones son sobre los efectos REALES del cobro (la fila de
   * `payments`, el evento emitido, el saldo escrito en `orders`), no sobre un
   * predicado extraído: un predicado puede estar correcto y no estar cableado.
   */
  describe('processPosPayment — la contra entrega no reconoce caja en el POS', () => {
    // Corta la ejecución en el refresco de estado de la respuesta
    // (payments.service.ts, `const refreshed = await tx.orders.findUnique`),
    // que es la PRIMERA lectura posterior a todo el bloque de eventos §4/§5.
    // Así el caso observa la emisión completa sin arrastrar el post-commit
    // (caja registradora, umbral fiscal, evento fiscal del POS).
    const STOP_AFTER_EVENTS = 'stop-after-pos-events';

    const posUser: any = {
      id: 1,
      email: 'cajero@example.com',
      organization_id: 1,
      roles: ['super_admin'],
    };

    /**
     * @param systemMethod fila de `system_payment_methods` que resuelve el
     *   discriminador. `processing_mode` es el eje bajo prueba; `type` sólo
     *   alimenta las ramas preexistentes (vuelto de efectivo, gateway).
     */
    const arrangePosSale = (
      systemMethod: {
        type: string;
        processing_mode?: payment_processing_mode_enum | null;
      },
      tableSessionOrderId: number | null = null,
      deliveryType: 'home_delivery' | 'direct_delivery' = 'home_delivery',
    ) => {
      mockRequestContext({ store_id: 1, organization_id: 1 });

      const order = buildOrder({
        id: 4242,
        store_id: 1,
        order_number: 'POS-COD-1',
        // Contra entrega real: la mercancía viaja y el dinero se recauda en
        // destino. `home_delivery` mantiene el consumo de stock diferido a
        // fulfillment, así que el caso aísla el reconocimiento del dinero.
        delivery_type: deliveryType,
        grand_total: new Prisma.Decimal(100),
        total_paid: new Prisma.Decimal(0),
        remaining_balance: new Prisma.Decimal(100),
        stores: { id: 1, organization_id: 1 },
        order_items: [],
      });

      const storePaymentMethodRow = {
        id: 9,
        display_name: 'Pago Contra Entrega',
        custom_config: {},
        system_payment_method: systemMethod,
      };

      const tx: any = {
        kitchen_tickets: { findMany: jest.fn().mockResolvedValue([]) },
        // Tienda NO restaurante → el auto-fire (B5) no corre.
        stores: {
          findUnique: jest.fn().mockResolvedValue({ industries: ['retail'] }),
        },
        store_payment_methods: {
          findUnique: jest.fn().mockResolvedValue(storePaymentMethodRow),
          findFirst: jest.fn().mockResolvedValue(storePaymentMethodRow),
        },
        payments: {
          // Devuelve lo que se le pidió escribir: el caso asserta sobre el
          // `state` REAL con el que nace la fila, no sobre una constante.
          create: jest.fn(async ({ data }: any) => ({
            id: 7,
            ...data,
            store_payment_method: storePaymentMethodRow,
          })),
        },
        orders: {
          update: jest.fn().mockResolvedValue({ id: 4242 }),
          findUnique: jest
            .fn()
            // 1.ª lectura: `applyOrderBalanceOnPayment` (grand_total/total_paid).
            .mockResolvedValueOnce({
              grand_total: new Prisma.Decimal(100),
              total_paid: new Prisma.Decimal(0),
            })
            // 2.ª lectura: el refresco de estado, ya emitidos los eventos.
            .mockRejectedValue(new Error(STOP_AFTER_EVENTS)),
        },
        order_items: { findMany: jest.fn().mockResolvedValue([]) },
      };

      (prisma as any).$transaction = jest.fn(async (cb: any) => cb(tx));

      jest
        .spyOn(service as any, 'createOrUpdateOrderFromPos')
        .mockResolvedValue({
          order,
          hasSerialized: false,
          promotionsSnapshot: [],
          appliedPromotions: [],
          couponInfo: {
            coupon_id: null,
            coupon_code: null,
            discount_amount: 0,
          },
          kitchenFire: null,
          closedSessionId: null,
          tableSessionOrderId,
        });

      (fiscalThreshold.assertInvoiceNotRequired as jest.Mock).mockResolvedValue(
        undefined,
      );

      return { order, tx };
    };

    const buildPosDto = (overrides: any = {}): any => ({
      store_id: 1,
      currency: 'COP',
      customer_id: 77,
      items: [],
      payments: [],
      requires_payment: true,
      store_payment_method_id: 9,
      ...overrides,
    });

    /** Nombres de los eventos emitidos, en orden. */
    const emittedEventNames = (): unknown[] =>
      emitMock.mock.calls.map((call) => call[0]);

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('el pago nace pending y NO emite el evento de caja: el dinero todavía no entró', async () => {
      const { tx } = arrangePosSale({
        type: 'cash_on_delivery',
        processing_mode: payment_processing_mode_enum.ON_DELIVERY,
      });

      await expect(
        service.processPosPayment(buildPosDto(), posUser),
      ).rejects.toThrow(STOP_AFTER_EVENTS);

      expect(tx.payments.create).toHaveBeenCalledTimes(1);
      expect(tx.payments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            order_id: 4242,
            amount: 100,
            state: 'pending',
          }),
        }),
      );

      // La venta SÍ se registra (la orden existe), pero el reconocimiento de
      // caja — asiento contable incluido — no se dispara.
      expect(emittedEventNames()).toContain('order.created');
      expect(emittedEventNames()).not.toContain('payment.received');
    });

    it('conserva el saldo completo de la orden: la parada de ruta nace con expected > 0', async () => {
      const { tx } = arrangePosSale({
        type: 'cash_on_delivery',
        processing_mode: payment_processing_mode_enum.ON_DELIVERY,
      });

      await expect(
        service.processPosPayment(buildPosDto(), posUser),
      ).rejects.toThrow(STOP_AFTER_EVENTS);

      // `resolveIsPrepaid` deriva el prepago del saldo VIVO de la orden
      // (`remaining_balance <= 0.01`). Con el saldo íntegro devuelve false y
      // la remisión sigue siendo contra entrega.
      expect(tx.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            total_paid: 0,
            remaining_balance: 100,
          }),
        }),
      );
    });

    it.each(['home_delivery', 'direct_delivery'] as const)(
      'ON_DELIVERY %s deja pago y orden pendientes sin consumir stock',
      async (deliveryType) => {
        // El nombre NO es el discriminador: cualquier tipo ON_DELIVERY
        // debe seguir la misma rama de estado y saldo.
        const { tx } = arrangePosSale(
          {
            type: 'card_at_door',
            processing_mode: payment_processing_mode_enum.ON_DELIVERY,
          },
          null,
          deliveryType,
        );

        await expect(
          service.processPosPayment(buildPosDto(), posUser),
        ).rejects.toThrow(STOP_AFTER_EVENTS);

        expect(tx.payments.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ state: 'pending' }),
          }),
        );
        expect(tx.orders.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ state: 'pending_payment' }),
          }),
        );
        expect(tx.orders.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              total_paid: 0,
              remaining_balance: 100,
            }),
          }),
        );
        expect(commitOrderDeliveryMock).not.toHaveBeenCalled();
        expect(emittedEventNames()).not.toContain('payment.received');
      },
    );

    it.each(['cash', 'card'])(
      '%s DIRECT conserva pago succeeded y estado de orden existente',
      async (type) => {
        const { tx } = arrangePosSale(
          { type, processing_mode: payment_processing_mode_enum.DIRECT },
          null,
          'direct_delivery',
        );
        jest
          .spyOn(service as any, 'hasPendingKitchenItemsTx')
          .mockResolvedValue(false);

        await expect(
          service.processPosPayment(buildPosDto(), posUser),
        ).rejects.toThrow(STOP_AFTER_EVENTS);

        expect(tx.payments.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ state: 'succeeded' }),
          }),
        );
        expect(tx.orders.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ state: 'finished' }),
          }),
        );
      },
    );

    it('Wompi sigue en pending_payment para procesar tras el commit', async () => {
      const { tx } = arrangePosSale({
        type: 'wompi',
        processing_mode: payment_processing_mode_enum.DIRECT,
      });
      // La pasarela no escribe saldo dentro de esta transacción; la primera
      // lectura de orden ya es el refresh posterior a eventos.
      tx.orders.findUnique.mockReset().mockRejectedValue(new Error(STOP_AFTER_EVENTS));

      await expect(
        service.processPosPayment(buildPosDto(), posUser),
      ).rejects.toThrow(STOP_AFTER_EVENTS);

      expect(tx.payments.create).not.toHaveBeenCalled();
      expect(tx.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: 'pending_payment' }),
        }),
      );
      expect(commitOrderDeliveryMock).not.toHaveBeenCalled();
    });

    it('el efectivo normal sigue reconociendo caja y emitiendo su evento (no-regresión)', async () => {
      const { tx } = arrangePosSale({
        type: 'cash',
        processing_mode: payment_processing_mode_enum.DIRECT,
      });

      await expect(
        service.processPosPayment(buildPosDto(), posUser),
      ).rejects.toThrow(STOP_AFTER_EVENTS);

      expect(tx.payments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: 'succeeded' }),
        }),
      );
      expect(emittedEventNames()).toContain('payment.received');
      expect(tx.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            total_paid: 100,
            remaining_balance: 0,
          }),
        }),
      );
    });

    it('proyecta el cobro de mesa con el pago real en la transacción y emite solo después del commit', async () => {
      const { tx, order } = arrangePosSale(
        { type: 'cash', processing_mode: payment_processing_mode_enum.DIRECT },
        4242,
      );
      let insideTransaction = false;
      (prisma as any).$transaction = jest.fn(async (callback: any) => {
        insideTransaction = true;
        try {
          return await callback(tx);
        } finally {
          insideTransaction = false;
        }
      });
      const emitAfterCommit = jest.fn(() => {
        expect(insideTransaction).toBe(false);
      });
      const project = (service as any).tableSessionsService
        .projectOrderPaymentToTableSession as jest.Mock;
      project.mockImplementation(
        async (_orderId: number, _paymentId: number, client: any) => {
          expect(insideTransaction).toBe(true);
          expect(client).toBe(tx);
          return { sessionId: 99, emitAfterCommit };
        },
      );
      tx.orders.findUnique
        .mockReset()
        .mockResolvedValueOnce({
          grand_total: new Prisma.Decimal(100),
          total_paid: new Prisma.Decimal(0),
        })
        .mockResolvedValueOnce({
          id: order.id,
          order_number: order.order_number,
          state: 'finished',
        });
      jest
        .spyOn(service as any, 'recordCashRegisterMovement')
        .mockResolvedValue(undefined);

      const result = await service.processPosPayment(buildPosDto(), posUser);

      expect(project).toHaveBeenCalledTimes(1);
      expect(project).toHaveBeenCalledWith(order.id, 7, tx);
      expect(emitAfterCommit).toHaveBeenCalledTimes(1);
      expect((result as any).paid_session_id).toBe(99);
      expect(tx.table_sessions?.update).toBeUndefined();
      expect(tx.tables?.update).toBeUndefined();
    });

    it('no emite session_paid si la transacción del cobro revierte', async () => {
      const { tx, order } = arrangePosSale(
        { type: 'cash', processing_mode: payment_processing_mode_enum.DIRECT },
        4242,
      );
      const emitAfterCommit = jest.fn();
      const project = (service as any).tableSessionsService
        .projectOrderPaymentToTableSession as jest.Mock;
      project.mockResolvedValue({ sessionId: 99, emitAfterCommit });

      await expect(
        service.processPosPayment(buildPosDto(), posUser),
      ).rejects.toThrow(STOP_AFTER_EVENTS);

      expect(project).toHaveBeenCalledWith(order.id, 7, tx);
      expect(emitAfterCommit).not.toHaveBeenCalled();
    });

    it('no proyecta una venta de mesa a crédito antes de recibir el dinero', async () => {
      arrangePosSale(
        {
          type: 'cash_on_delivery',
          processing_mode: payment_processing_mode_enum.ON_DELIVERY,
        },
        4242,
      );
      const project = (service as any).tableSessionsService
        .projectOrderPaymentToTableSession as jest.Mock;

      await expect(
        service.processPosPayment(buildPosDto(), posUser),
      ).rejects.toThrow(STOP_AFTER_EVENTS);

      expect(project).not.toHaveBeenCalled();
    });

    it('fila de método sin processing_mode (tienda antigua): degrada al carril directo y lo deja en el log', async () => {
      // El seed de `system_payment_methods` es CREATE-ONLY: una tienda
      // anterior a la columna puede tener la fila sin `processing_mode`. No se
      // inventa el modo por el nombre del método — se degrada al
      // comportamiento de hoy y se deja rastro para el backfill pendiente.
      const { tx } = arrangePosSale({ type: 'cash_on_delivery' });
      const warn = jest.spyOn((service as any).logger, 'warn');

      await expect(
        service.processPosPayment(buildPosDto(), posUser),
      ).rejects.toThrow(STOP_AFTER_EVENTS);

      expect(tx.payments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: 'succeeded' }),
        }),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('processing_mode'),
      );
    });
  });
});

/**
 * B.1/F-186 + F-088 — contrato de `resolveDeclaredGrossUnitPrice`, la puerta
 * de entrada del bruto declarado en el cobro POS. Decidido por escrito:
 * ausente (`undefined`/`null`) y cadena vacía son AUSENCIA (`null`); el 0
 * numérico explícito se honra como bruto 0 (con permiso de override aguas
 * abajo). La cadena vacía ya no se convierte en 0 (F-088: cobraba 0).
 */
describe('PaymentsService — resolveDeclaredGrossUnitPrice (B.1/F-186)', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentGatewayService, useValue: {} },
        { provide: PaymentValidatorService, useValue: {} },
        { provide: WebhookHandlerService, useValue: {} },
        { provide: StorePrismaService, useValue: {} },
        { provide: StockLevelManager, useValue: {} },
        { provide: TaxesService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: SettingsService, useValue: {} },
        { provide: PromotionEngineService, useValue: {} },
        { provide: CouponsService, useValue: {} },
        { provide: SessionsService, useValue: {} },
        { provide: MovementsService, useValue: {} },
        { provide: PaymentEncryptionService, useValue: {} },
        { provide: InvoiceDataRequestsService, useValue: {} },
        { provide: WompiClientFactory, useValue: {} },
        { provide: WompiProcessor, useValue: {} },
        { provide: FiscalInvoiceThresholdService, useValue: {} },
        { provide: OrderStockCommitService, useValue: {} },
        { provide: SellableStockAllocator, useValue: {} },
        { provide: PriceResolverService, useValue: {} },
        { provide: WithholdingFlowService, useValue: {} },
        { provide: KitchenFireService, useValue: {} },
        { provide: TableSessionsService, useValue: {} },
        { provide: SerialNumberEnforcementService, useValue: {} },
        { provide: InventorySerialNumbersService, useValue: {} },
        { provide: RequestContextService, useValue: {} },
        { provide: AuditService, useValue: {} },
      ],
    }).compile();
    service = module.get<PaymentsService>(PaymentsService);
  });

  const read = (item: any): number | null =>
    (service as any).resolveDeclaredGrossUnitPrice(item);

  it('bruto definido pasa por roundMoney', () => {
    expect(read({ final_unit_price: 11900 })).toBe(11900);
    expect(read({ final_unit_price: 11900.005 })).toBe(11900.01);
  });

  it('ausente, nulo o indefinido es null', () => {
    expect(read({})).toBeNull();
    expect(read({ final_unit_price: null })).toBeNull();
    expect(read({ final_unit_price: undefined })).toBeNull();
  });

  it('cadena vacía o en blanco es ausencia, no precio 0 (F-088)', () => {
    expect(read({ final_unit_price: '' })).toBeNull();
    expect(read({ final_unit_price: '   ' })).toBeNull();
  });

  it('cero numérico explícito se honra como bruto 0 (decidido por escrito)', () => {
    expect(read({ final_unit_price: 0 })).toBe(0);
  });
});
