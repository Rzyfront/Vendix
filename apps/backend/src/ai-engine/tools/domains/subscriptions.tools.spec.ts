import {
  createSubscriptionTools,
  SubscriptionToolDeps,
} from './subscriptions.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * F-71..F-81 — Spec de contrato de la familia subscriptions (patrón
 * canónico T4; P0 escrita en el paso 7, writes + P1/P2 en el paso 12).
 *
 * (a) validación happy/sad — el sad no toca las deps mockeadas;
 * (b) snapshot JSON exacto de la salida happy (literales con `toEqual`);
 * (c) forma `{error, next_step}` en español en los fallos guiados;
 * (d) permiso declarado por tool;
 * (e) writes con `requiresConfirmation: true` + `preview` con sujeto humano
 *     y re-verificación en `handler`; reads puras con `readOnly: true`.
 *
 * Reglas blindadas:
 * - `subscriptions:read` en F-71..F-75 (verificado en GET current,
 *   current/dunning-state, current/invoices y POST checkout/preview).
 * - `subscriptions:write` en F-76..F-79 (verificado en POST retry-payment,
 *   subscribe, cancel y checkout/pay-due).
 * - F-80/F-81 SIN `requiredPermissions`: espejo del HTTP, que solo exige
 *   auth (`subscription-access.controller.ts` no declara `@Permissions`).
 * - `@Roles(OWNER, SUPER_ADMIN)` replicado contra `context.roles`
 *   (fail-closed) en F-73..F-79.
 */
describe('subscriptions.tools · contrato canónico T4', () => {
  const STORE_ID = 7;
  const ORG_ID = 3;

  function baseDeps() {
    return {
      subscriptionAccessService: {
        getCurrentSubscriptionSnapshot: jest.fn(),
        getDunningStateForCurrentStore: jest.fn(),
        getAIUsageSnapshot: jest.fn(),
        invalidateCache: jest.fn(),
      },
      subscriptionBillingService: {
        listStoreInvoices: jest.fn(),
        getStoreInvoice: jest.fn(),
        previewNewSubscription: jest.fn(),
        createStoreSubscription: jest.fn(),
      },
      subscriptionPaymentService: {
        charge: jest.fn(),
        prepareWidgetCharge: jest.fn(),
      },
      subscriptionStateService: {
        transition: jest.fn(),
        scheduleCancel: jest.fn(),
      },
      subscriptionProrationService: {
        previewUpgrade: jest.fn(),
      },
      subscriptionResolverService: {
        resolveSubscription: jest.fn(),
      },
    } as any satisfies SubscriptionToolDeps;
  }

  function buildTools(deps = baseDeps()) {
    return { deps, tools: createSubscriptionTools(deps) };
  }

  function getTool(tools: RegisteredTool[], name: string) {
    const tool = tools.find((registered) => registered.name === name);
    if (!tool) throw new Error(`${name} no registrado`);
    return tool;
  }

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = {
      store_id: STORE_ID,
      organization_id: ORG_ID,
      roles: ['owner'],
    },
  ) => {
    const tool = getTool(tools, name);
    if (!tool.handler) throw new Error(`${name} sin handler`);
    return JSON.parse(await tool.handler(args, context as any));
  };

  const preview = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = {
      store_id: STORE_ID,
      organization_id: ORG_ID,
      roles: ['owner'],
    },
  ) => {
    const tool = getTool(tools, name);
    if (!tool.preview) throw new Error(`${name} sin preview`);
    return tool.preview(args, context as any);
  };

  const WRITE_TOOLS = [
    'retry_subscription_payment',
    'pay_subscription_due',
    'subscribe_plan',
    'cancel_subscription',
  ];

  const READ_TOOLS = [
    'get_subscription_status',
    'get_dunning_state',
    'list_subscription_invoices',
    'get_subscription_invoice',
    'preview_subscription_checkout',
    'get_subscription_access',
    'get_ai_usage',
  ];

  // ─── (d)+(e) Registro: permisos, categoría y forma ────────────────────
  describe('registro', () => {
    it('expone exactamente las 11 tools F-71..F-81 de suscripciones', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'get_subscription_status',
        'get_dunning_state',
        'list_subscription_invoices',
        'get_subscription_invoice',
        'preview_subscription_checkout',
        'retry_subscription_payment',
        'pay_subscription_due',
        'subscribe_plan',
        'cancel_subscription',
        'get_subscription_access',
        'get_ai_usage',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('subscriptions');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('cada tool declara su permiso verificado (F-80/F-81 sin permiso, espejo HTTP)', () => {
      const { tools } = buildTools();
      const expected: Record<string, string[] | undefined> = {
        get_subscription_status: ['subscriptions:read'],
        get_dunning_state: ['subscriptions:read'],
        list_subscription_invoices: ['subscriptions:read'],
        get_subscription_invoice: ['subscriptions:read'],
        preview_subscription_checkout: ['subscriptions:read'],
        retry_subscription_payment: ['subscriptions:write'],
        pay_subscription_due: ['subscriptions:write'],
        subscribe_plan: ['subscriptions:write'],
        cancel_subscription: ['subscriptions:write'],
        get_subscription_access: undefined,
        get_ai_usage: undefined,
      };
      for (const tool of tools) {
        expect(tool.requiredPermissions).toEqual(expected[tool.name]);
      }
    });

    it('los 7 reads son puros sin circuito de escritura', () => {
      const { tools } = buildTools();
      expect(READ_TOOLS).toHaveLength(7);
      for (const name of READ_TOOLS) {
        const tool = getTool(tools, name);
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation ?? false).toBe(false);
        expect(tool.preview).toBeUndefined();
        expect(tool.clientSide ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('los 4 writes exigen confirmación con preview real', () => {
      const { tools } = buildTools();
      expect(WRITE_TOOLS).toHaveLength(4);
      for (const name of WRITE_TOOLS) {
        const tool = getTool(tools, name);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
        expect(tool.readOnly ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('status y dunning no reciben args; invoices solo paginación', () => {
      const { tools } = buildTools();
      expect(
        getTool(tools, 'get_subscription_status').parameters.required,
      ).toEqual([]);
      expect(getTool(tools, 'get_dunning_state').parameters.required).toEqual(
        [],
      );
      expect(
        getTool(tools, 'list_subscription_invoices').parameters.required,
      ).toEqual([]);
      expect(
        Object.keys(
          getTool(tools, 'list_subscription_invoices').parameters.properties,
        ).sort(),
      ).toEqual(['limit', 'page']);
      expect(
        getTool(tools, 'get_subscription_invoice').parameters.required,
      ).toEqual(['invoice_id']);
      expect(
        getTool(tools, 'preview_subscription_checkout').parameters.required,
      ).toEqual(['plan_id']);
      expect(
        getTool(tools, 'retry_subscription_payment').parameters.required,
      ).toEqual([]);
      expect(
        getTool(tools, 'pay_subscription_due').parameters.required,
      ).toEqual([]);
      expect(getTool(tools, 'subscribe_plan').parameters.required).toEqual([
        'plan_id',
      ]);
      expect(getTool(tools, 'cancel_subscription').parameters.required).toEqual(
        [],
      );
      expect(
        getTool(tools, 'get_subscription_access').parameters.required,
      ).toEqual([]);
      expect(getTool(tools, 'get_ai_usage').parameters.required).toEqual([]);
    });
  });

  // ─── F-71: get_subscription_status ─────────────────────────────────────
  describe('get_subscription_status (F-71)', () => {
    const snapshot = {
      found: true,
      subscription: {
        id: 9,
        state: 'grace_soft',
        current_period_end: '2026-10-01T00:00:00.000Z',
      },
      resolved_features: { text_generation: true },
      auto_renew_warning_type: null,
      auto_renew_warning_notification_id: null,
      auto_renew_last_retry_at: null,
      payable_invoice: {
        id: 31,
        total: 99000,
        currency: 'COP',
        due_at: '2026-09-15T00:00:00.000Z',
        period_start: '2026-09-01T00:00:00.000Z',
        period_end: '2026-10-01T00:00:00.000Z',
        state: 'overdue',
      },
    };

    it('(b) happy: transporta el snapshot del access service', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        snapshot,
      );

      const out = await run(tools, 'get_subscription_status', {});

      expect(
        deps.subscriptionAccessService.getCurrentSubscriptionSnapshot,
      ).toHaveBeenCalledWith(STORE_ID);
      expect(out).toEqual(snapshot);
    });

    it('(b) sin suscripción: found=false, no error', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        {
          found: false,
          subscription: null,
          resolved_features: null,
          auto_renew_warning_type: null,
          auto_renew_warning_notification_id: null,
          auto_renew_last_retry_at: null,
          payable_invoice: null,
        },
      );

      const out = await run(tools, 'get_subscription_status', {});

      expect(out.found).toBe(false);
      expect(out.error).toBeUndefined();
    });

    it('(a) sad: sin tienda en contexto no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(
        tools,
        'get_subscription_status',
        {},
        { organization_id: ORG_ID, roles: ['owner'] },
      );

      expect(
        deps.subscriptionAccessService.getCurrentSubscriptionSnapshot,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/Sin tienda en contexto/);
      expect(typeof out.next_step).toBe('string');
    });

    it('(c) service caído → {error, next_step} guiado', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockRejectedValue(
        new Error('redis down'),
      );

      const out = await run(tools, 'get_subscription_status', {});

      expect(out.error).toMatch(/No pude leer la suscripción/);
      expect(typeof out.next_step).toBe('string');
    });
  });

  // ─── F-72: get_dunning_state ───────────────────────────────────────────
  describe('get_dunning_state (F-72)', () => {
    const dunning = {
      state: 'grace_hard',
      deadlines: {
        grace_hard_at: '2026-09-20T00:00:00.000Z',
        suspend_at: '2026-09-27T00:00:00.000Z',
        cancel_at: '2026-10-11T00:00:00.000Z',
      },
      invoices_overdue: [
        {
          id: 31,
          invoice_number: 'SAAS-20260901-00001',
          amount_due: 99000,
          issued_at: '2026-09-01T00:00:00.000Z',
          period_start: '2026-09-01T00:00:00.000Z',
          period_end: '2026-10-01T00:00:00.000Z',
        },
      ],
      total_due: 99000,
      features_lost: ['streaming_chat'],
      features_kept: ['text_generation'],
      payment_method_invalid: true,
    };

    it('(b) happy: deuda + deadlines + features perdidas/conservadas', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getDunningStateForCurrentStore.mockResolvedValue(
        dunning,
      );

      const out = await run(tools, 'get_dunning_state', {});

      expect(
        deps.subscriptionAccessService.getDunningStateForCurrentStore,
      ).toHaveBeenCalledWith(STORE_ID);
      expect(out).toEqual(dunning);
    });

    it('(a) sad: sin tienda en contexto no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(
        tools,
        'get_dunning_state',
        {},
        { organization_id: ORG_ID, roles: ['owner'] },
      );

      expect(
        deps.subscriptionAccessService.getDunningStateForCurrentStore,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/Sin tienda en contexto/);
      expect(typeof out.next_step).toBe('string');
    });

    it('(c) service caído → {error, next_step} guiado', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getDunningStateForCurrentStore.mockRejectedValue(
        new Error('db down'),
      );

      const out = await run(tools, 'get_dunning_state', {});

      expect(out.error).toMatch(/dunning/);
      expect(typeof out.next_step).toBe('string');
    });
  });

  // ─── F-73: list_subscription_invoices ──────────────────────────────────
  describe('list_subscription_invoices (F-73)', () => {
    const page = {
      data: [
        {
          id: 31,
          invoice_number: 'SAAS-20260901-00001',
          state: 'overdue',
          total: '99000.00',
          currency: 'COP',
        },
      ],
      meta: { total: 1, page: 1, limit: 20, total_pages: 1 },
    };

    it.each([['owner'], ['super_admin']])(
      '(b) happy con rol %s: facturas + meta paginada',
      async (role) => {
        const { deps, tools } = buildTools();
        deps.subscriptionBillingService.listStoreInvoices.mockResolvedValue(
          page,
        );

        const out = await run(
          tools,
          'list_subscription_invoices',
          { page: 1, limit: 20 },
          { store_id: STORE_ID, organization_id: ORG_ID, roles: [role] },
        );

        expect(
          deps.subscriptionBillingService.listStoreInvoices,
        ).toHaveBeenCalledTimes(1);
        expect(out).toEqual(page);
      },
    );

    it('(a) sad: rol no owner (manager) no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(
        tools,
        'list_subscription_invoices',
        {},
        { store_id: STORE_ID, organization_id: ORG_ID, roles: ['manager'] },
      );

      expect(
        deps.subscriptionBillingService.listStoreInvoices,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/owner o un super_admin/);
      expect(out.next_step).toMatch(/owner/);
    });

    it('(a) sad: sin roles en contexto → fail-closed', async () => {
      const { deps, tools } = buildTools();

      const out = await run(
        tools,
        'list_subscription_invoices',
        {},
        { store_id: STORE_ID, organization_id: ORG_ID },
      );

      expect(
        deps.subscriptionBillingService.listStoreInvoices,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/owner o un super_admin/);
    });

    it('(a) sad: paginación inválida no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(tools, 'list_subscription_invoices', {
        page: 'uno',
      });

      expect(
        deps.subscriptionBillingService.listStoreInvoices,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/validación/i);
      expect(out.next_step).toMatch(/page, limit/);
    });

    it('(c) sin suscripción (SUBSCRIPTION_001) → {error, next_step} guiado', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionBillingService.listStoreInvoices.mockRejectedValue(
        new Error('Subscription not found'),
      );

      const out = await run(tools, 'list_subscription_invoices', {});

      expect(out.error).toMatch(/No pude listar las facturas/);
      expect(out.next_step).toMatch(/suscripción/);
    });
  });

  // ─── Helpers del paso 12 ───────────────────────────────────────────────
  const dunningWithDebt = {
    state: 'grace_hard',
    deadlines: {
      grace_hard_at: '2026-09-20T00:00:00.000Z',
      suspend_at: '2026-09-27T00:00:00.000Z',
      cancel_at: '2026-10-11T00:00:00.000Z',
    },
    invoices_overdue: [
      {
        id: 30,
        invoice_number: 'SAAS-20260801-00001',
        amount_due: 99000,
        issued_at: '2026-08-01T00:00:00.000Z',
        period_start: '2026-08-01T00:00:00.000Z',
        period_end: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 31,
        invoice_number: 'SAAS-20260901-00001',
        amount_due: 99000,
        issued_at: '2026-09-01T00:00:00.000Z',
        period_start: '2026-09-01T00:00:00.000Z',
        period_end: '2026-10-01T00:00:00.000Z',
      },
    ],
    total_due: 198000,
    features_lost: ['streaming_chat'],
    features_kept: ['text_generation'],
    payment_method_invalid: false,
  };

  const activeSnapshot = {
    found: true,
    subscription: {
      id: 9,
      state: 'active',
      plan_id: 2,
      pending_plan_id: null,
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
      plan: { id: 2, code: 'core', name: 'Core' },
    },
    resolved_features: { text_generation: true },
  };

  const noPlanSnapshot = {
    found: false,
    subscription: null,
    resolved_features: null,
  };

  // ─── F-74: get_subscription_invoice ────────────────────────────────────
  describe('get_subscription_invoice (F-74)', () => {
    const invoiceRow = {
      id: 31,
      invoice_number: 'SAAS-20260901-00001',
      state: 'overdue',
      total: '99000.00',
      amount_paid: '0.00',
      currency: 'COP',
      issued_at: '2026-09-01T00:00:00.000Z',
      due_at: '2026-09-15T00:00:00.000Z',
      paid_at: null,
      period_start: '2026-09-01T00:00:00.000Z',
      period_end: '2026-10-01T00:00:00.000Z',
      line_items: [{ description: 'Plan Core (monthly)', total: '99000.00' }],
      split_breakdown: { vendix_share: '99000.00', partner_share: '0.00' },
      store_subscription: {
        plan: { code: 'core', name: 'Core', billing_cycle: 'monthly' },
      },
    };

    it('(b) happy: detalle proyectado con plan y split', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionBillingService.getStoreInvoice.mockResolvedValue(
        invoiceRow,
      );

      const out = await run(tools, 'get_subscription_invoice', {
        invoice_id: 31,
      });

      expect(
        deps.subscriptionBillingService.getStoreInvoice,
      ).toHaveBeenCalledWith(STORE_ID, 31);
      expect(out).toEqual({
        id: 31,
        invoice_number: 'SAAS-20260901-00001',
        state: 'overdue',
        total: '99000.00',
        amount_paid: '0.00',
        currency: 'COP',
        issued_at: '2026-09-01T00:00:00.000Z',
        due_at: '2026-09-15T00:00:00.000Z',
        paid_at: null,
        period_start: '2026-09-01T00:00:00.000Z',
        period_end: '2026-10-01T00:00:00.000Z',
        line_items: [
          { description: 'Plan Core (monthly)', total: '99000.00' },
        ],
        split_breakdown: { vendix_share: '99000.00', partner_share: '0.00' },
        plan: { code: 'core', name: 'Core', billing_cycle: 'monthly' },
      });
    });

    it('(a) sad: rol no owner no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(
        tools,
        'get_subscription_invoice',
        { invoice_id: 31 },
        { store_id: STORE_ID, organization_id: ORG_ID, roles: ['cashier'] },
      );

      expect(
        deps.subscriptionBillingService.getStoreInvoice,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/owner o un super_admin/);
    });

    it('(c) factura inexistente → {error, next_step} a F-73', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionBillingService.getStoreInvoice.mockRejectedValue(
        new Error('Invoice not found'),
      );

      const out = await run(tools, 'get_subscription_invoice', {
        invoice_id: 999,
      });

      expect(out.error).toMatch(/#999/);
      expect(out.next_step).toMatch(/F-73/);
    });
  });

  // ─── F-75: preview_subscription_checkout ───────────────────────────────
  describe('preview_subscription_checkout (F-75)', () => {
    const proration = {
      kind: 'upgrade',
      days_remaining: 20,
      cycle_days: 30,
      old_effective_price: '99000.00',
      new_effective_price: '149000.00',
      proration_amount: '33333.33',
      applies_immediately: true,
      invoice_to_issue: null,
      credit_to_apply_next_cycle: '0.00',
    };

    it('(b) happy: prorrata del service dueño sin persistir', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        activeSnapshot,
      );
      deps.subscriptionProrationService.previewUpgrade.mockResolvedValue(
        proration,
      );

      const out = await run(tools, 'preview_subscription_checkout', {
        plan_id: 3,
      });

      expect(
        deps.subscriptionProrationService.previewUpgrade,
      ).toHaveBeenCalledWith(9, 3);
      expect(out).toEqual(proration);
    });

    it('(c) tienda sin suscripción → {error, next_step} a F-78', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        noPlanSnapshot,
      );

      const out = await run(tools, 'preview_subscription_checkout', {
        plan_id: 3,
      });

      expect(
        deps.subscriptionProrationService.previewUpgrade,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/no tiene suscripción/);
      expect(out.next_step).toMatch(/F-78/);
    });

    it('(a) sad: rol no owner no toca services', async () => {
      const { deps, tools } = buildTools();

      const out = await run(
        tools,
        'preview_subscription_checkout',
        { plan_id: 3 },
        { store_id: STORE_ID, organization_id: ORG_ID, roles: ['manager'] },
      );

      expect(
        deps.subscriptionAccessService.getCurrentSubscriptionSnapshot,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/owner o un super_admin/);
    });
  });

  // ─── F-76: retry_subscription_payment ──────────────────────────────────
  describe('retry_subscription_payment (F-76)', () => {
    it('(e) preview ok: última factura con deuda, cadena F-72', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getDunningStateForCurrentStore.mockResolvedValue(
        dunningWithDebt,
      );

      const card = await preview(tools, 'retry_subscription_payment', {});

      expect(deps.subscriptionPaymentService.charge).not.toHaveBeenCalled();
      expect(card.status).toBe('ok');
      expect(card.target).toContain('SAAS-20260901-00001');
      expect(card.changes).toEqual([
        {
          field: 'cobro',
          label: 'Cobro',
          from: 'pendiente',
          to: 'charge a la factura #31 (medio guardado)',
        },
      ]);
      expect(card.message).toMatch(/F-72/);
      expect(card.domain).toBe('subscriptions');
    });

    it('(b) happy: cobra tras re-verificar deuda', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getDunningStateForCurrentStore.mockResolvedValue(
        dunningWithDebt,
      );
      deps.subscriptionPaymentService.charge.mockResolvedValue({
        id: 55,
        state: 'succeeded',
      });

      const out = await run(tools, 'retry_subscription_payment', {});

      expect(deps.subscriptionPaymentService.charge).toHaveBeenCalledWith(31);
      expect(out).toEqual({
        payment_id: 55,
        invoice_id: 31,
        state: 'succeeded',
      });
    });

    it('(c) sin deuda → {error, next_step} sin cobrar', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getDunningStateForCurrentStore.mockResolvedValue(
        { ...dunningWithDebt, invoices_overdue: [], total_due: 0 },
      );

      const out = await run(tools, 'retry_subscription_payment', {});

      expect(deps.subscriptionPaymentService.charge).not.toHaveBeenCalled();
      expect(out.error).toMatch(/no tiene facturas pendientes/);
      expect(out.next_step).toMatch(/F-71/);
    });

    it('(a) sad: rol no owner bloquea preview y handler', async () => {
      const { deps, tools } = buildTools();
      const ctx = {
        store_id: STORE_ID,
        organization_id: ORG_ID,
        roles: ['manager'],
      };

      const card = await preview(tools, 'retry_subscription_payment', {}, ctx);
      expect(card.status).toBe('error');
      expect(card.message).toMatch(/owner o un super_admin/);

      const out = await run(tools, 'retry_subscription_payment', {}, ctx);
      expect(
        deps.subscriptionAccessService.getDunningStateForCurrentStore,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/owner o un super_admin/);
    });
  });

  // ─── F-77: pay_subscription_due ────────────────────────────────────────
  describe('pay_subscription_due (F-77)', () => {
    it('(e) preview ok: factura más antigua + widget, cadena F-72', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getDunningStateForCurrentStore.mockResolvedValue(
        dunningWithDebt,
      );
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        activeSnapshot,
      );

      const card = await preview(tools, 'pay_subscription_due', {});

      expect(card.status).toBe('ok');
      expect(card.target).toContain('SAAS-20260801-00001');
      expect(card.changes).toEqual([
        {
          field: 'pago',
          label: 'Pago',
          from: 'deuda pendiente',
          to: 'widget Wompi para la factura #30',
        },
      ]);
      expect(card.message).toMatch(/F-72/);
    });

    it('(e) preview incluye F-75 cuando hay cambio de plan pendiente', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getDunningStateForCurrentStore.mockResolvedValue(
        dunningWithDebt,
      );
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        {
          ...activeSnapshot,
          subscription: {
            ...(activeSnapshot.subscription as any),
            pending_plan_id: 3,
          },
        },
      );
      deps.subscriptionProrationService.previewUpgrade.mockResolvedValue({
        kind: 'upgrade',
        proration_amount: '33333.33',
      });

      const card = await preview(tools, 'pay_subscription_due', {});

      expect(
        deps.subscriptionProrationService.previewUpgrade,
      ).toHaveBeenCalledWith(9, 3);
      expect(card.message).toMatch(/F-75/);
      expect(card.message).toMatch(/33333\.33/);
    });

    it('(b) happy: prepara widget tras re-verificar', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getDunningStateForCurrentStore.mockResolvedValue(
        dunningWithDebt,
      );
      deps.subscriptionPaymentService.prepareWidgetCharge.mockResolvedValue({
        payment: { id: 56, state: 'pending' },
        widget: { reference: 'vendix_saas_9_30_123', amountInCents: 9900000 },
      });

      const out = await run(tools, 'pay_subscription_due', {
        customer_email: 'owner@tienda.co',
      });

      expect(
        deps.subscriptionPaymentService.prepareWidgetCharge,
      ).toHaveBeenCalledWith(30, {
        customerEmail: 'owner@tienda.co',
        redirectUrl: undefined,
      });
      expect(out.invoice).toEqual({
        id: 30,
        invoice_number: 'SAAS-20260801-00001',
        amount_due: 99000,
      });
      expect(out.widget.reference).toBe('vendix_saas_9_30_123');
    });

    it('(c) factura indicada sin saldo → {error, next_step} a F-72', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getDunningStateForCurrentStore.mockResolvedValue(
        dunningWithDebt,
      );

      const out = await run(tools, 'pay_subscription_due', {
        invoice_id: 999,
      });

      expect(
        deps.subscriptionPaymentService.prepareWidgetCharge,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/#999/);
      expect(out.next_step).toMatch(/F-72/);
    });
  });

  // ─── F-78: subscribe_plan ──────────────────────────────────────────────
  describe('subscribe_plan (F-78)', () => {
    const pricing = {
      plan: {
        id: 2,
        code: 'core',
        name: 'Core',
        billing_cycle: 'monthly',
        currency: 'COP',
        is_free: false,
      },
      base_price: '99000.00',
      margin_pct: '0.00',
      margin_amount: '0.00',
      fixed_surcharge: '0.00',
      effective_price: '99000.00',
      partner_org_id: null,
    };

    it('(e) confirmación fuerte: warning + frase irreversible + cadena F-71', async () => {
      const { IRREVERSIBLE_DOMAINS } = await import(
        '../bridge/capability-registry.service'
      );
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        noPlanSnapshot,
      );
      deps.subscriptionBillingService.previewNewSubscription.mockResolvedValue(
        pricing,
      );

      const card = await preview(tools, 'subscribe_plan', { plan_id: 2 });

      expect(typeof IRREVERSIBLE_DOMAINS.subscriptions).toBe('string');
      expect(
        deps.subscriptionBillingService.createStoreSubscription,
      ).not.toHaveBeenCalled();
      expect(card.status).toBe('warning');
      expect(card.target).toContain('Core');
      expect(card.target).toContain('99000.00 COP/monthly');
      expect(card.message).toContain(IRREVERSIBLE_DOMAINS.subscriptions);
      expect(card.message).toMatch(/F-71/);
      expect(card.domain).toBe('subscriptions');
    });

    it('(b) happy: crea, invalida caché y devuelve período', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        noPlanSnapshot,
      );
      deps.subscriptionBillingService.createStoreSubscription.mockResolvedValue(
        {
          id: 9,
          state: 'active',
          plan: { code: 'core' },
          effective_price: '99000.00',
          currency: 'COP',
          current_period_start: '2026-09-29T00:00:00.000Z',
          current_period_end: '2026-10-29T00:00:00.000Z',
        },
      );
      deps.subscriptionAccessService.invalidateCache.mockResolvedValue(
        undefined,
      );

      const out = await run(
        tools,
        'subscribe_plan',
        { plan_id: 2 },
        {
          store_id: STORE_ID,
          organization_id: ORG_ID,
          roles: ['owner'],
          user_id: 11,
        },
      );

      expect(
        deps.subscriptionBillingService.createStoreSubscription,
      ).toHaveBeenCalledWith(
        STORE_ID,
        { planId: 2, partnerOverrideId: undefined },
        11,
      );
      expect(
        deps.subscriptionAccessService.invalidateCache,
      ).toHaveBeenCalledWith(STORE_ID);
      expect(out).toEqual({
        id: 9,
        state: 'active',
        plan_code: 'core',
        effective_price: '99000.00',
        currency: 'COP',
        current_period_start: '2026-09-29T00:00:00.000Z',
        current_period_end: '2026-10-29T00:00:00.000Z',
      });
    });

    it('(c) tienda ya suscrita → {error, next_step} al checkout', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        activeSnapshot,
      );

      const card = await preview(tools, 'subscribe_plan', { plan_id: 2 });
      expect(card.status).toBe('error');
      expect(card.message).toMatch(/ya tiene una suscripción/);

      const out = await run(tools, 'subscribe_plan', { plan_id: 2 });
      expect(
        deps.subscriptionBillingService.createStoreSubscription,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/ya tiene una suscripción/);
      expect(out.next_step).toMatch(/F-75/);
    });
  });

  // ─── F-79: cancel_subscription ─────────────────────────────────────────
  describe('cancel_subscription (F-79)', () => {
    it('(e) confirmación fuerte inmediata: warning + frase + estado', async () => {
      const { IRREVERSIBLE_DOMAINS } = await import(
        '../bridge/capability-registry.service'
      );
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        activeSnapshot,
      );

      const card = await preview(tools, 'cancel_subscription', {});

      expect(card.status).toBe('warning');
      expect(card.target).toContain('core');
      expect(card.changes).toEqual([
        { field: 'estado', label: 'Estado', from: 'active', to: 'cancelled' },
      ]);
      expect(card.message).toContain(IRREVERSIBLE_DOMAINS.subscriptions);
      expect(card.message).toMatch(/F-71/);
    });

    it('(e) fin de ciclo programa scheduled_cancel_at', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        activeSnapshot,
      );

      const card = await preview(tools, 'cancel_subscription', {
        end_of_cycle: true,
      });

      expect(card.status).toBe('warning');
      expect(card.changes).toContainEqual({
        field: 'cancelacion_programada',
        label: 'Cancelación programada',
        from: null,
        to: '2026-10-01T00:00:00.000Z',
      });
    });

    it('(b) happy inmediata: transition a cancelled', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        activeSnapshot,
      );
      deps.subscriptionStateService.transition.mockResolvedValue({
        id: 9,
        state: 'cancelled',
      });

      const out = await run(
        tools,
        'cancel_subscription',
        { reason: 'cierre temporal' },
        {
          store_id: STORE_ID,
          organization_id: ORG_ID,
          roles: ['owner'],
          user_id: 11,
        },
      );

      expect(deps.subscriptionStateService.transition).toHaveBeenCalledWith(
        STORE_ID,
        'cancelled',
        { reason: 'cierre temporal', triggeredByUserId: 11 },
      );
      expect(out).toEqual({ state: 'cancelled' });
    });

    it('(b) happy fin de ciclo: scheduleCancel con el período', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        activeSnapshot,
      );
      deps.subscriptionStateService.scheduleCancel.mockResolvedValue({
        id: 9,
        state: 'active',
        scheduled_cancel_at: '2026-10-01T00:00:00.000Z',
        auto_renew: false,
      });

      const out = await run(tools, 'cancel_subscription', {
        end_of_cycle: true,
      });

      expect(deps.subscriptionStateService.scheduleCancel).toHaveBeenCalledWith(
        STORE_ID,
        new Date('2026-10-01T00:00:00.000Z'),
        {
          reason: 'user_initiated_schedule_cancel',
          triggeredByUserId: undefined,
        },
      );
      expect(out.scheduled_cancel_at).toBe('2026-10-01T00:00:00.000Z');
      expect(out.auto_renew).toBe(false);
    });

    it('(c) tienda sin suscripción → {error, next_step} a F-71', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getCurrentSubscriptionSnapshot.mockResolvedValue(
        noPlanSnapshot,
      );

      const out = await run(tools, 'cancel_subscription', {});

      expect(deps.subscriptionStateService.transition).not.toHaveBeenCalled();
      expect(deps.subscriptionStateService.scheduleCancel).not.toHaveBeenCalled();
      expect(out.error).toMatch(/no tiene suscripción/);
      expect(out.next_step).toMatch(/F-71/);
    });
  });

  // ─── F-80: get_subscription_access ─────────────────────────────────────
  describe('get_subscription_access (F-80)', () => {
    it('(b) happy: acceso + banner danger en grace_hard', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionResolverService.resolveSubscription.mockResolvedValue({
        found: true,
        state: 'grace_hard',
        planCode: 'core',
        features: { text_generation: true },
        currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
        overlayActive: false,
        overlayExpiresAt: null,
      });

      const out = await run(
        tools,
        'get_subscription_access',
        {},
        { store_id: STORE_ID, organization_id: ORG_ID, roles: ['cashier'] },
      );

      expect(
        deps.subscriptionResolverService.resolveSubscription,
      ).toHaveBeenCalledWith(STORE_ID);
      expect(out).toEqual({
        found: true,
        state: 'grace_hard',
        planCode: 'core',
        features: { text_generation: true },
        currentPeriodEnd: '2026-10-01T00:00:00.000Z',
        overlayActive: false,
        overlayExpiresAt: null,
        bannerLevel: 'danger',
      });
    });

    it('(b) sin suscripción: found=false, sin gate de rol', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionResolverService.resolveSubscription.mockResolvedValue({
        found: false,
      });

      const out = await run(tools, 'get_subscription_access', {});

      expect(out.found).toBe(false);
      expect(out.state).toBe('draft');
      expect(out.bannerLevel).toBe('info');
    });
  });

  // ─── F-81: get_ai_usage ────────────────────────────────────────────────
  describe('get_ai_usage (F-81)', () => {
    it('(b) happy: usado vs cap por feature', async () => {
      const { deps, tools } = buildTools();
      deps.subscriptionAccessService.getAIUsageSnapshot.mockResolvedValue({
        text_generation: { used: 120, cap: 1000, period: 'monthly' },
        streaming_chat: { used: 0, cap: null, period: 'monthly' },
      });

      const out = await run(tools, 'get_ai_usage', {});

      expect(
        deps.subscriptionAccessService.getAIUsageSnapshot,
      ).toHaveBeenCalledWith(STORE_ID);
      expect(out).toEqual({
        text_generation: { used: 120, cap: 1000, period: 'monthly' },
        streaming_chat: { used: 0, cap: null, period: 'monthly' },
      });
    });

    it('(a) sad: sin tienda en contexto no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(
        tools,
        'get_ai_usage',
        {},
        { organization_id: ORG_ID, roles: ['owner'] },
      );

      expect(
        deps.subscriptionAccessService.getAIUsageSnapshot,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/Sin tienda en contexto/);
    });
  });
});
