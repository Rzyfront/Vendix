import {
  createSubscriptionTools,
  SubscriptionToolDeps,
} from './subscriptions.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * F-71/F-72/F-73 — Spec de contrato de la familia subscriptions (patrón
 * canónico T4, escrita en el paso 7).
 *
 * (a) validación happy/sad — el sad no toca las deps mockeadas;
 * (b) snapshot JSON exacto de la salida happy (literales con `toEqual`);
 * (c) forma `{error, next_step}` en español en los fallos guiados;
 * (d) permiso declarado por tool;
 * (e) las 3 son reads puras: `readOnly: true`, sin `requiresConfirmation` ni
 *     `preview`, y sin gate de suscripción (el gate solo cubre writes).
 *
 * Reglas blindadas:
 * - `subscriptions:read` en las 3 (verificado en GET current,
 *   current/dunning-state y current/invoices de
 *   `store-subscriptions.controller.ts`).
 * - F-73 replica el `@Roles(OWNER, SUPER_ADMIN)` del endpoint contra
 *   `context.roles` (fail-closed).
 */
describe('subscriptions.tools · contrato canónico T4', () => {
  const STORE_ID = 7;
  const ORG_ID = 3;

  function baseDeps() {
    return {
      subscriptionAccessService: {
        getCurrentSubscriptionSnapshot: jest.fn(),
        getDunningStateForCurrentStore: jest.fn(),
      },
      subscriptionBillingService: {
        listStoreInvoices: jest.fn(),
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

  // ─── (d)+(e) Registro: permisos, categoría y forma ────────────────────
  describe('registro', () => {
    it('expone exactamente los 3 reads P0 de suscripciones', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'get_subscription_status',
        'get_dunning_state',
        'list_subscription_invoices',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('subscriptions');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('cada read exige subscriptions:read (mismo verbo que el controlador)', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.requiredPermissions).toEqual(['subscriptions:read']);
      }
    });

    it('las 3 son reads puras sin circuito de escritura', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation ?? false).toBe(false);
        expect(tool.preview).toBeUndefined();
        expect(tool.clientSide ?? false).toBe(false);
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
});
