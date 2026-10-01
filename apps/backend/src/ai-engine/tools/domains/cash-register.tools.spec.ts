import {
  createCashRegisterTools,
  CashRegisterToolDeps,
} from './cash-register.tools';
import { RegisteredTool } from '../interfaces/tool.interface';
import { IRREVERSIBLE_DOMAIN_SEGMENTS } from '../bridge/capability-registry.service';

/**
 * Paso 8 (vex-agent) — contrato cash-register: 2 reads + 3 writes.
 *
 * Patrón canónico T4: happy/sad con sad sin tocar deps, literales con
 * `toEqual`, `{error, next_step}` en ES, permiso por tool, `readOnly` en
 * reads y `requiresConfirmation` + `preview` con sujeto humano en writes.
 * Pinnea además que close_cash_session advierte irreversibilidad.
 */
describe('cash-register.tools · caja', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const OPEN = {
    id: 5,
    status: 'open',
    cash_register_id: 2,
    register: { id: 2, name: 'Caja principal' },
    opening_amount: 200000,
  };
  const CLOSED = { ...OPEN, status: 'closed' };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      sessionsService: {
        getActiveSession: jest.fn().mockResolvedValue(OPEN),
        findAll: jest.fn().mockResolvedValue({
          data: [OPEN],
          meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
        }),
        findOne: jest.fn().mockResolvedValue(OPEN),
        openSession: jest.fn().mockResolvedValue({ ...OPEN, id: 6 }),
        closeSession: jest
          .fn()
          .mockResolvedValue({ ...CLOSED, actual_closing_amount: 350000 }),
      },
      movementsService: {
        createManualMovement: jest
          .fn()
          .mockResolvedValue({ id: 44, session_id: 5, type: 'cash_in', amount: 50000 }),
      },
      ...overrides,
    } as any;
    const tools = createCashRegisterTools(deps as CashRegisterToolDeps);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    return { deps: deps as any, tools, byName };
  }

  function run(tool: RegisteredTool, args: Record<string, any> = {}) {
    return tool.handler!(args, CONTEXT).then((raw) => JSON.parse(raw));
  }

  function preview(tool: RegisteredTool, args: Record<string, any> = {}) {
    return tool.preview!(args, CONTEXT);
  }

  it('expone 2 reads + 3 writes con permisos del endpoint equivalente', () => {
    const { tools } = buildTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'close_cash_session',
        'get_active_cash_session',
        'list_cash_sessions',
        'open_cash_session',
        'record_cash_movement',
      ].sort(),
    );
    const perms = Object.fromEntries(
      tools.map((t) => [t.name, t.requiredPermissions]),
    );
    expect(perms).toEqual({
      get_active_cash_session: ['store:cash_registers:read'],
      list_cash_sessions: ['store:cash_registers:read'],
      open_cash_session: ['store:cash_registers:open_session'],
      close_cash_session: ['store:cash_registers:close_session'],
      record_cash_movement: ['store:cash_registers:movements'],
    });
    expect(
      tools.find((t) => t.name === 'get_active_cash_session')!.readOnly,
    ).toBe(true);
    expect(
      tools.find((t) => t.name === 'list_cash_sessions')!.readOnly,
    ).toBe(true);
    for (const name of [
      'open_cash_session',
      'close_cash_session',
      'record_cash_movement',
    ]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
    }
  });

  it('get_active_cash_session devuelve la sesión abierta', async () => {
    const { byName } = buildTools();
    const out = await run(byName.get_active_cash_session, {});
    expect(out.session).toEqual(OPEN);
  });

  it('get_active_cash_session rechaza user_id inválido sin tocar deps', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.get_active_cash_session, { user_id: -1 });
    expect(out).toEqual({
      error: 'user_id inválido: -1.',
      next_step: 'Pasa el ID numérico del usuario u omítelo.',
    });
    expect(deps.sessionsService.getActiveSession).not.toHaveBeenCalled();
  });

  it('open_cash_session previsualiza y abre', async () => {
    const { deps, byName } = buildTools();
    const args = { cash_register_id: 2, opening_amount: 200000 };
    const prev = await preview(byName.open_cash_session, args);
    expect(prev.status).toBe('ok');
    expect(prev.target).toContain('caja #2');
    const out = await run(byName.open_cash_session, args);
    expect(out.session_id).toBe(6);
    expect(deps.sessionsService.openSession).toHaveBeenCalledWith({
      cash_register_id: 2,
      opening_amount: 200000,
    });
  });

  it('close_cash_session advierte irreversibilidad y cierra', async () => {
    const { deps, byName } = buildTools();
    const args = { session_id: 5, actual_closing_amount: 350000 };
    const prev = await preview(byName.close_cash_session, args);
    expect(prev.status).toBe('warning');
    expect(prev.message).toContain('Irreversible');
    expect(prev.target).toContain('Caja principal');
    const out = await run(byName.close_cash_session, args);
    expect(out.resumen).toContain('cerrada');
    expect(deps.sessionsService.closeSession).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ actual_closing_amount: 350000 }),
    );
  });

  it('close_cash_session rechaza sesión no abierta sin tocar close', async () => {
    const { deps, byName } = buildTools({
      sessionsService: {
        findOne: jest.fn().mockResolvedValue(CLOSED),
        closeSession: jest.fn(),
      },
    });
    const prev = await preview(byName.close_cash_session, {
      session_id: 5,
      actual_closing_amount: 350000,
    });
    expect(prev.status).toBe('error');
    expect(prev.message).toContain('open');
    expect(deps.sessionsService.closeSession).not.toHaveBeenCalled();
  });

  it('record_cash_movement registra un ingreso', async () => {
    const { deps, byName } = buildTools();
    const args = {
      session_id: 5,
      type: 'cash_in',
      amount: 50000,
      reference: 'Base adicional',
    };
    const prev = await preview(byName.record_cash_movement, args);
    expect(prev.status).toBe('ok');
    expect(prev.target).toContain('Ingreso $50000');
    const out = await run(byName.record_cash_movement, args);
    expect(out.movement_id).toBe(44);
    expect(deps.movementsService.createManualMovement).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ type: 'cash_in', amount: 50000 }),
    );
  });

  it('record_cash_movement rechaza tipo inválido sin tocar deps', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.record_cash_movement, {
      session_id: 5,
      type: 'transfer',
      amount: 1000,
    });
    expect(out.error).toContain('cash_in');
    expect(
      deps.movementsService.createManualMovement,
    ).not.toHaveBeenCalled();
  });

  it('solo close_cash_session declara irreversible: true', () => {
    const { byName } = buildTools();
    expect(byName.close_cash_session.irreversible).toBe(true);
    // Apertura y movimientos se corrigen con otra escritura (cerrar con
    // arqueo, contra-movimiento): la marca selectiva evita fatiga del badge.
    for (const name of [
      'get_active_cash_session',
      'list_cash_sessions',
      'open_cash_session',
      'record_cash_movement',
    ]) {
      expect(byName[name].irreversible).not.toBe(true);
    }
  });

  it('la red compartida cubre ambas grafías del dominio de caja', () => {
    // Regresión: el espejo local de plan-approval solo traía `cash-registers`
    // (segmento de ruta) y el dominio tipado `cash-register` colaba como
    // reversible dentro de planes aprobados.
    expect(byNameDomain()).toBe('cash-register');
    expect(IRREVERSIBLE_DOMAIN_SEGMENTS.has('cash-register')).toBe(true);
    expect(IRREVERSIBLE_DOMAIN_SEGMENTS.has('cash-registers')).toBe(true);

    function byNameDomain() {
      return buildTools().byName.close_cash_session.domain;
    }
  });
});
