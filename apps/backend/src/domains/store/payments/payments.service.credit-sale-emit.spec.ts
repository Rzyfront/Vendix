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
import { StockValidatorService } from '../inventory/shared/services/stock-validator.service';
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
import * as tipUtil from '../../../common/utils/tip.util';
// Plan order-truth-and-invoice-tz (Step 6) — writer único de order_events.
import { OrderHistoryService } from '../orders/order-history/order-history.service';


/**
 * QUI-540 — `credit_sale.created` se emite DESPUÉS del commit y lleva el
 * `due_date` de la 1ª cuota en el payload: `createOrderInstallments` corre
 * post-commit sin `await`, así que el listener de CxC no puede leer
 * `order_installments` al recibir el evento.
 */
describe('PaymentsService credit_sale.created emission (QUI-540)', () => {
  let service: PaymentsService;
  let prisma: StorePrismaService;
  let emitMock: jest.MockedFunction<EventEmitter2['emit']>;
  let contextSpy: jest.SpyInstance;
  // Handles tipados concretos del setup copiado de `payments.service.spec.ts`
  // (patrón F-157): se crean en `beforeEach` y se usan por closure.
  let paymentGateway: PaymentGatewayService;
  let promotionEngine: PromotionEngineService;
  let couponsService: CouponsService;
  let fiscalThreshold: FiscalInvoiceThresholdService;
  let kitchenFire: KitchenFireService;
  let settingsService: SettingsService;
  let sessionsService: SessionsService;
  let movementsService: MovementsService;
  let orderHistory: { record: jest.Mock };
  let calculateProductTaxesMock: jest.MockedFunction<
    TaxesService['calculateProductTaxes']
  >;
  let resolveLineTotalsMock: jest.MockedFunction<
    TaxesService['resolveLineTotals']
  >;
  let commitOrderDeliveryMock: jest.MockedFunction<
    OrderStockCommitService['commitOrderDelivery']
  >;
  let assertLinesAvailableMock: jest.MockedFunction<
    StockValidatorService['assertLinesAvailable']
  >;
  let resolveInventoryPolicyMock: jest.MockedFunction<
    StockValidatorService['resolveInventoryPolicy']
  >;
  let reserveStockMock: jest.MockedFunction<StockLevelManager['reserveStock']>;
  let allocateForLineMock: jest.MockedFunction<
    SellableStockAllocator['allocateForLine']
  >;

  const posUser: any = {
    id: 1,
    email: 'cajero@example.com',
    organization_id: 1,
    roles: ['super_admin'],
  };

  const creditOrder = {
    id: 10,
    order_number: 'ORD-10',
    store_id: 1,
    customer_id: null,
    grand_total: 100000,
    subtotal_amount: 100000,
    tip_amount: 0,
    order_items: [],
    stores: { id: 1, organization_id: 55, industries: [] },
  };

  // `tx` permisivo: cualquier `tx.<modelo>.<método>()` resuelve a un valor
  // vacío inerte (`findMany` -> [], el resto -> null). El caso sólo observa la
  // emisión, no lo que ocurre dentro de la transacción.
  const makeTx = (): any =>
    new Proxy(
      {},
      {
        get: () =>
          new Proxy(
            {},
            {
              get: (_t, method) =>
                jest
                  .fn()
                  .mockResolvedValue(method === 'findMany' ? [] : null),
            },
          ),
      },
    );

  const buildDto = (overrides: any = {}): any => ({
    store_id: 1,
    currency: 'COP',
    items: [],
    payments: [],
    customer_id: null,
    requires_payment: false,
    is_draft: false,
    ...overrides,
  });

  const creditSaleCalls = () =>
    emitMock.mock.calls
      .map((call, i) => ({ call, order: emitMock.mock.invocationCallOrder[i] }))
      .filter(({ call }) => call[0] === 'credit_sale.created');

  const arrange = (transaction: jest.Mock) => {
    contextSpy = jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 55 } as any);
    (prisma as any).$transaction = transaction;
    jest.spyOn(service as any, 'createOrUpdateOrderFromPos').mockResolvedValue({
      order: creditOrder,
      hasSerialized: false,
      promotionsSnapshot: [],
      appliedPromotions: [],
      couponInfo: { coupon_id: null, coupon_code: null, discount_amount: 0 },
      kitchenFire: null,
      closedSessionId: null,
    });
    // Lo post-commit no es el objeto de estos casos.
    jest
      .spyOn(service as any, 'createOrderInstallments')
      .mockResolvedValue(undefined);
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

    // Default: no shortage (resolves) so the rest of this large suite is
    // unaffected. Tests exercising the no-overselling guard itself override
    // this per-case with `.mockRejectedValueOnce(...)`.
    assertLinesAvailableMock = jest
      .fn()
      .mockResolvedValue([]) as jest.MockedFunction<
      StockValidatorService['assertLinesAvailable']
    >;
    resolveInventoryPolicyMock = jest
      .fn()
      .mockResolvedValue({
        allowOversell: false,
        allowIngredientOveruse: true,
      }) as jest.MockedFunction<StockValidatorService['resolveInventoryPolicy']>;
    reserveStockMock = jest.fn().mockResolvedValue(undefined) as jest.MockedFunction<
      StockLevelManager['reserveStock']
    >;
    allocateForLineMock = jest.fn() as jest.MockedFunction<
      SellableStockAllocator['allocateForLine']
    >;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentGatewayService, useValue: mockPaymentGateway },
        { provide: StorePrismaService, useValue: mockPrismaService },
        { provide: PaymentValidatorService, useValue: {} },
        { provide: WebhookHandlerService, useValue: {} },
        {
          provide: StockLevelManager,
          useValue: { updateStock: jest.fn(), reserveStock: reserveStockMock },
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
          useValue: {
            getActiveSession: jest.fn(),
            assertSessionForSales: jest.fn(),
          },
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
          useValue: { allocateForOrderItem: jest.fn(), allocateForLine: allocateForLineMock },
        },
        // No-overselling guard (docs/plans/no-overselling-stock-guard-plan.md,
        // step 4) — see `assertLinesAvailableMock` declared at describe level.
        {
          provide: StockValidatorService,
          useValue: {
            assertLinesAvailable: assertLinesAvailableMock,
            assertIngredientsAvailable: jest.fn().mockResolvedValue(undefined),
            resolveInventoryPolicy: resolveInventoryPolicyMock,
          },
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
            // El cobro POS ahora agrupa por bien/servicio y llama a este
            // método (Step 1, plan pago-multimetodo-pendientes) en vez de
            // `resolveSuffered` directo. Mismo motivo que arriba: sin este
            // stub, cualquier caso que llegue al bloque de retenciones muere
            // con "is not a function" bajo el try/catch.
            resolveSufferedByOperation: jest.fn().mockResolvedValue({
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
        // Plan order-truth-and-invoice-tz (Step 6) — writer único de
        // order_events. Requerido (no @Optional en PaymentsService): sin
        // este provider el módulo de test no compila.
        {
          provide: OrderHistoryService,
          useValue: { record: jest.fn().mockResolvedValue(null) },
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
    settingsService = module.get<SettingsService>(SettingsService);
    sessionsService = module.get<SessionsService>(SessionsService);
    movementsService = module.get<MovementsService>(MovementsService);
    orderHistory = module.get<any>(OrderHistoryService);
  });


  afterEach(() => {
    contextSpy?.mockRestore();
    jest.restoreAllMocks();
  });

  it('emite credit_sale.created con due_date de la 1ª cuota, DESPUÉS de resolver el $transaction', async () => {
    const transaction = jest.fn(async (cb: any) => cb(makeTx()));
    arrange(transaction);

    await service.processPosPayment(
      buildDto({
        credit_type: 'installments',
        installment_terms: {
          num_installments: 3,
          frequency: 'monthly',
          first_installment_date: '2026-11-15',
        },
      }),
      posUser,
    );

    const calls = creditSaleCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].call[1]).toMatchObject({
      order_id: 10,
      due_date: new Date('2026-11-15'),
    });
    expect((calls[0].call[1] as any).due_date.getTime()).toBe(
      new Date('2026-11-15').getTime(),
    );
    // El emit ocurre después de que el $transaction fue invocado y resolvió.
    const txOrder = transaction.mock.invocationCallOrder[0];
    expect(calls[0].order).toBeGreaterThan(txOrder);
    await expect(transaction.mock.results[0].value).resolves.toBeDefined();
  });

  it('no emite credit_sale.created si el $transaction rechaza', async () => {
    const boom = new Error('tx-rolled-back-QUI-540');
    const transaction = jest.fn(async (cb: any) => {
      await cb(makeTx());
      throw boom;
    });
    arrange(transaction);

    const error = await service
      .processPosPayment(
        buildDto({
          credit_type: 'installments',
          installment_terms: {
            num_installments: 3,
            frequency: 'monthly',
            first_installment_date: '2026-11-15',
          },
        }),
        posUser,
      )
      .catch((failure) => failure);

    expect(error).toBe(boom);
    expect(error.message).toBe('tx-rolled-back-QUI-540');
    expect(creditSaleCalls()).toHaveLength(0);
  });

  it.each([
    { label: "credit_type 'free'", dto: { credit_type: 'free' } },
    {
      label: 'sin installment_terms',
      dto: { credit_type: 'installments' },
    },
    {
      label: "'free' aunque traiga first_installment_date",
      dto: {
        credit_type: 'free',
        installment_terms: { first_installment_date: '2026-11-15' },
      },
    },
  ])('due_date es undefined con $label', async ({ dto }) => {
    arrange(jest.fn(async (cb: any) => cb(makeTx())));

    await service.processPosPayment(buildDto(dto), posUser);

    const calls = creditSaleCalls();
    expect(calls).toHaveLength(1);
    expect((calls[0].call[1] as any).due_date).toBeUndefined();
  });
});
