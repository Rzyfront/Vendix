import { createNotificationTools } from './notifications.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 13 — contrato D-12 `list_notifications`, D-13 `manage_notifications`.
 *
 * Patrón canónico T4: (a) validación happy/sad — el sad no toca las deps;
 * (b) snapshot JSON exacto de la salida happy; (c) forma
 * `{error, next_step}` en español; (d) permiso declarado por tool;
 * (e) circuito de escritura: D-13 lleva `requiresConfirmation` + `preview`
 * con sujeto humano y re-verificación en el handler.
 *
 * Casos fijados por el plan: D-12 read (el SSE no es tool), D-13 valida el
 * tipo contra `notification_type_enum` en el borde (fuera del enum no
 * procede, porque la emisión se traga en el servicio) y mark read/read-all
 * delegan en los métodos del servicio que los endpoints exponen con
 * `@SkipSubscriptionGate`.
 */
describe('notifications.tools · D-12 list / D-13 manage', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  const ROWS = [
    {
      id: 901,
      type: 'low_stock',
      severity: 'warning',
      title: 'Stock bajo: Fríjol',
      body: 'Quedan 400 gramos',
      is_read: false,
      created_at: '2026-01-10T10:00:00.000Z',
    },
    {
      id: 902,
      type: 'new_order',
      severity: 'info',
      title: 'Nueva orden #501',
      body: null,
      is_read: false,
      created_at: '2026-01-10T09:00:00.000Z',
    },
  ];

  function buildTools(overrides: {
    notificationsService?: Record<string, any>;
    pushService?: Record<string, any>;
  } = {}) {
    const deps = {
      notificationsService: {
        findAll: jest.fn(),
        getUnreadCount: jest.fn(),
        markRead: jest.fn(),
        markAllRead: jest.fn(),
        getSubscriptions: jest.fn(),
        updateSubscription: jest.fn(),
        ...overrides.notificationsService,
      } as any,
      pushService: {
        saveSubscription: jest.fn(),
        removeSubscription: jest.fn(),
        ...overrides.pushService,
      } as any,
    };
    return createNotificationTools(deps);
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = CONTEXT,
  ) => JSON.parse(await getTool(tools, name).handler!(args, context as any));

  // ─── (d)+(e) Registro ─────────────────────────────────────────────
  describe('registro', () => {
    it('expone exactamente las 2 tools con version 1 y dominio notifications', () => {
      const tools = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'list_notifications',
        'manage_notifications',
      ]);
      for (const tool of tools) {
        expect(tool.version).toBe('1');
        expect(tool.domain).toBe('notifications');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('D-12 es readOnly; D-13 es write con circuito completo', () => {
      const tools = buildTools();
      const list = getTool(tools, 'list_notifications');
      expect(list.readOnly).toBe(true);
      expect(list.requiresConfirmation).toBeUndefined();
      expect(list.preview).toBeUndefined();
      expect(list.requiredPermissions).toEqual(['store:notifications:read']);
      const manage = getTool(tools, 'manage_notifications');
      expect(manage.readOnly ?? false).toBe(false);
      expect(manage.requiresConfirmation).toBe(true);
      expect(typeof manage.preview).toBe('function');
      expect(manage.requiredPermissions).toEqual([
        'store:notifications:update',
      ]);
      expect(manage.description).toMatch(/list_notifications/);
    });
  });

  // ─── D-12 list_notifications ──────────────────────────────────────
  describe('list_notifications', () => {
    it('(b) happy: lista + campana (snapshot)', async () => {
      const findAll = jest.fn().mockResolvedValue({
        data: structuredClone(ROWS),
        unread_count: 2,
        meta: { total: 2, page: 1, limit: 20, total_pages: 1 },
      });
      const getUnreadCount = jest.fn().mockResolvedValue({ count: 2 });
      const tools = buildTools({
        notificationsService: { findAll, getUnreadCount },
      });

      const answer = await run(tools, 'list_notifications', {});

      expect(findAll).toHaveBeenCalledWith(11, {
        page: 1,
        limit: 20,
      });
      expect(getUnreadCount).toHaveBeenCalledWith(11);
      expect(answer).toEqual({
        resumen: '2 notificación(es) de 2 en total',
        pagina: 1,
        paginas: 1,
        notificaciones: [
          {
            notification_id: 901,
            type: 'low_stock',
            severity: 'warning',
            title: 'Stock bajo: Fríjol',
            body: 'Quedan 400 gramos',
            is_read: false,
            created_at: '2026-01-10T10:00:00.000Z',
          },
          {
            notification_id: 902,
            type: 'new_order',
            severity: 'info',
            title: 'Nueva orden #501',
            body: null,
            is_read: false,
            created_at: '2026-01-10T09:00:00.000Z',
          },
        ],
        no_leidas: 2,
        next_step: expect.stringContaining('manage_notifications'),
      });
    });

    it('(b) happy unread_only filtra en el servicio', async () => {
      const findAll = jest.fn().mockResolvedValue({
        data: [ROWS[0]],
        unread_count: 1,
        meta: { total: 1, page: 1, limit: 20, total_pages: 1 },
      });
      const tools = buildTools({
        notificationsService: {
          findAll,
          getUnreadCount: jest.fn().mockResolvedValue({ count: 1 }),
        },
      });

      await run(tools, 'list_notifications', {
        unread_only: true,
        type: 'low_stock',
      });

      expect(findAll).toHaveBeenCalledWith(11, {
        page: 1,
        limit: 20,
        type: 'low_stock',
        is_read: false,
      });
    });

    it('(a) sad: tipo fuera del enum no toca el servicio', async () => {
      const findAll = jest.fn();
      const tools = buildTools({
        notificationsService: { findAll },
      });

      const answer = await run(tools, 'list_notifications', {
        type: 'inventado',
      });

      expect(answer.error).toMatch(/inválido/);
      expect(findAll).not.toHaveBeenCalled();
    });
  });

  // ─── D-13 manage_notifications ────────────────────────────────────
  describe('manage_notifications', () => {
    it('(b+e) happy mark-read: preview nombra el título y delega al método con gate skip', async () => {
      const markRead = jest.fn().mockResolvedValue({ id: 901 });
      const tools = buildTools({
        notificationsService: {
          findAll: jest.fn().mockResolvedValue({
            data: structuredClone(ROWS),
            unread_count: 2,
            meta: { total: 2, page: 1, limit: 100, total_pages: 1 },
          }),
          markRead,
        },
      });
      const tool = getTool(tools, 'manage_notifications');
      const args = { action: 'mark-read', notification_id: 901 };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('ok');
      expect(preview.target).toContain('Stock bajo: Fríjol');

      const answer = JSON.parse(await tool.handler!(args, CONTEXT as any));
      expect(markRead).toHaveBeenCalledWith(901);
      expect(answer).toEqual({
        resumen: 'Notificación #901 marcada como leída.',
        notification_id: 901,
      });
    });

    it('(b) happy mark-all-read: preview cuenta no leídas (snapshot)', async () => {
      const markAllRead = jest.fn().mockResolvedValue({ count: 2 });
      const tools = buildTools({
        notificationsService: {
          getUnreadCount: jest.fn().mockResolvedValue({ count: 2 }),
          markAllRead,
        },
      });
      const tool = getTool(tools, 'manage_notifications');

      const preview = await tool.preview!(
        { action: 'mark-all-read' },
        CONTEXT as any,
      );
      expect(preview.status).toBe('warning');
      expect(preview.target).toContain('2 no leídas');

      const answer = JSON.parse(
        await tool.handler!({ action: 'mark-all-read' }, CONTEXT as any),
      );
      expect(markAllRead).toHaveBeenCalled();
      expect(answer).toEqual({
        resumen: 'Campana al día: 2 marcada(s) como leídas.',
      });
    });

    it('(b) happy update-subscription: preview from→to y delega con DTO real', async () => {
      const updateSubscription = jest.fn().mockResolvedValue({});
      const tools = buildTools({
        notificationsService: {
          getSubscriptions: jest.fn().mockResolvedValue([
            { type: 'low_stock', in_app: true, email: false },
          ]),
          updateSubscription,
        },
      });
      const tool = getTool(tools, 'manage_notifications');
      const args = {
        action: 'update-subscription',
        type: 'low_stock',
        in_app: false,
      };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('ok');
      expect(preview.target).toContain('low_stock');
      expect(preview.changes).toEqual([
        { field: 'in_app', label: 'Campana', from: true, to: false },
      ]);

      const answer = JSON.parse(await tool.handler!(args, CONTEXT as any));
      expect(updateSubscription).toHaveBeenCalledWith(
        11,
        expect.objectContaining({ type: 'low_stock', in_app: false }),
      );
      expect(answer.resumen).toContain('low_stock');
    });

    it('(a) sad: tipo fuera del enum se rechaza en preview y handler', async () => {
      const updateSubscription = jest.fn();
      const tools = buildTools({
        notificationsService: { updateSubscription },
      });
      const tool = getTool(tools, 'manage_notifications');
      const args = {
        action: 'update-subscription',
        type: 'inventado',
        in_app: false,
      };

      const preview = await tool.preview!(args, CONTEXT as any);
      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/notification_type_enum/);

      const answer = JSON.parse(await tool.handler!(args, CONTEXT as any));
      expect(answer.error).toMatch(/notification_type_enum/);
      expect(updateSubscription).not.toHaveBeenCalled();
    });

    it('(b) happy push-subscribe/unsubscribe delegan con DTOs reales', async () => {
      const saveSubscription = jest.fn().mockResolvedValue({ id: 1 });
      const removeSubscription = jest.fn().mockResolvedValue({});
      const tools = buildTools({
        pushService: { saveSubscription, removeSubscription },
      });
      const tool = getTool(tools, 'manage_notifications');

      const sub = JSON.parse(
        await tool.handler!(
          {
            action: 'push-subscribe',
            endpoint: 'https://push/x',
            p256dh: 'p256',
            auth: 'auth',
          },
          CONTEXT as any,
        ),
      );
      expect(saveSubscription).toHaveBeenCalledWith(
        7,
        11,
        expect.objectContaining({ endpoint: 'https://push/x' }),
        undefined,
      );
      expect(sub.resumen).toContain('suscrito');

      const unsub = JSON.parse(
        await tool.handler!(
          { action: 'push-unsubscribe', endpoint: 'https://push/x' },
          CONTEXT as any,
        ),
      );
      expect(removeSubscription).toHaveBeenCalledWith(7, 11, 'https://push/x');
      expect(unsub.resumen).toContain('baja');
    });
  });
});
