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
        getPendingOrders: jest.fn().mockResolvedValue({
          count: 0,
          fingerprint: 'empty-fingerprint',
          data: [],
          page: 1,
          limit: 100,
        }),
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

  it('expone 4 reads + 3 writes con permisos del endpoint equivalente', () => {
    const { tools } = buildTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'close_cash_session',
        'get_active_cash_session',
        'get_cash_session_close_report',
        'list_cash_session_movements',
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
      get_cash_session_close_report: ['store:cash_registers:read'],
      list_cash_session_movements: ['store:cash_registers:movements'],
      open_cash_session: ['store:cash_registers:open_session'],
      close_cash_session: ['store:cash_registers:close_session'],
      record_cash_movement: ['store:cash_registers:movements'],
    });
    expect(
      tools.find((t) => t.name === 'get_active_cash_session')!.readOnly,
    ).toBe(true);
    for (const name of [
      'list_cash_sessions',
      'get_cash_session_close_report',
      'list_cash_session_movements',
    ]) {
      expect(tools.find((t) => t.name === name)!.readOnly).toBe(true);
    }
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

  it('get_cash_session_close_report devuelve el arqueo del backend y acota salidas', async () => {
    const { deps, byName } = buildTools();
    const outflows = Array.from({ length: 51 }, (_, i) => ({ id: i + 1 }));
    deps.sessionsService.getCloseReport = jest.fn().mockResolvedValue({
      session: { id: 5, status: 'closed' },
      cash: { expected: 350000, declared: 320000, difference: -30000 },
      outflows,
    });
    const out = await run(byName.get_cash_session_close_report, {
      session_id: 5,
    });
    expect(deps.sessionsService.getCloseReport).toHaveBeenCalledWith(5);
    expect(out.cash).toEqual({
      expected: 350000,
      declared: 320000,
      difference: -30000,
    });
    expect(out.outflows).toHaveLength(50);
    expect(out.outflows_total).toBe(51);
    expect(out.outflows_truncated).toBe(true);
  });

  it('get_cash_session_close_report rechaza session_id inválido sin tocar deps', async () => {
    const { deps, byName } = buildTools();
    deps.sessionsService.getCloseReport = jest.fn();
    const out = await run(byName.get_cash_session_close_report, {
      session_id: 'abc',
    });
    expect(out).toEqual({
      error: 'session_id inválido: abc.',
      next_step:
        'Ubica la sesión con list_cash_sessions y pasa su ID numérico.',
    });
    expect(deps.sessionsService.getCloseReport).not.toHaveBeenCalled();
  });

  it('list_cash_session_movements pagina los movimientos de la sesión', async () => {
    const { deps, byName } = buildTools();
    deps.movementsService.findBySession = jest
      .fn()
      .mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ id: i + 1 })));
    const out = await run(byName.list_cash_session_movements, {
      session_id: 5,
      page: 2,
      limit: 10,
    });
    expect(deps.movementsService.findBySession).toHaveBeenCalledWith(5);
    expect(out.data.map((m: any) => m.id)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
    expect(out.meta).toEqual({ total: 25, page: 2, limit: 10, total_pages: 3 });
    expect(out.has_more).toBe(true);
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

  it('close_cash_session expone los campos de decisión pendientes y su explicación', () => {
    const { byName } = buildTools();
    const properties = byName.close_cash_session.parameters.properties;
    expect(properties.pending_decision.enum).toEqual(['resolved', 'override']);
    expect(properties.pending_fingerprint.type).toBe('string');
    expect(properties.override_reason.type).toBe('string');
    expect(properties.pending_decision.description).toContain('No inventes');
    expect(properties.override_reason.description).toContain('No inventes');
  });

  it('close_cash_session bloquea cierre y preview con órdenes pendientes sin decisión explícita', async () => {
    const pending = {
      count: 2,
      fingerprint: 'snapshot-abc',
      page: 1,
      limit: 100,
      data: [
        { id: 81, order_number: 'V-81' },
        { id: 82, order_number: 'V-82' },
      ],
    };
    const { deps, byName } = buildTools({
      sessionsService: {
        findOne: jest.fn().mockResolvedValue({
          ...OPEN,
          pending_orders_tracking_enabled: true,
        }),
        getPendingOrders: jest.fn().mockResolvedValue(pending),
        closeSession: jest.fn(),
      },
    });
    const args = { session_id: 5, actual_closing_amount: 350000 };
    const prev = await preview(byName.close_cash_session, args);
    expect(prev.status).toBe('error');
    expect(prev.message).toContain('V-81');
    expect(prev.message).toContain('snapshot-abc');

    const out = await run(byName.close_cash_session, args);
    expect(out).toEqual({
      error: expect.stringContaining('snapshot-abc'),
      next_step: expect.stringContaining('pending_decision="override"'),
      pending_orders: pending.data,
      count: 2,
      fingerprint: 'snapshot-abc',
    });
    expect(deps.sessionsService.getPendingOrders).toHaveBeenCalledWith(5, {
      limit: 100,
      page: 1,
    });
    expect(deps.sessionsService.closeSession).not.toHaveBeenCalled();
  });

  it('close_cash_session incluye metadatos de paginación cuando hay más de 100 pendientes', async () => {
    const { byName } = buildTools({
      sessionsService: {
        findOne: jest.fn().mockResolvedValue({
          ...OPEN,
          pending_orders_tracking_enabled: true,
        }),
        getPendingOrders: jest.fn().mockResolvedValue({
          count: 101,
          fingerprint: 'snapshot-101',
          page: 1,
          limit: 100,
          data: [{ id: 81, order_number: 'V-81' }],
        }),
        closeSession: jest.fn(),
      },
    });
    const out = await run(byName.close_cash_session, {
      session_id: 5,
      actual_closing_amount: 350000,
    });
    expect(out).toEqual(
      expect.objectContaining({
        count: 101,
        fingerprint: 'snapshot-101',
        pagination: { page: 1, limit: 100, total_pages: 2 },
      }),
    );
  });

  it('close_cash_session muestra la decisión y el motivo override en el preview y los reenvía', async () => {
    for (const args of [
      {
        session_id: 5,
        actual_closing_amount: 350000,
        pending_decision: 'resolved',
        pending_fingerprint: 'snapshot-resolved',
      },
      {
        session_id: 5,
        actual_closing_amount: 350000,
        pending_decision: 'override',
        pending_fingerprint: 'snapshot-override',
        override_reason: 'Autorizado por la administradora',
      },
    ]) {
      const { deps, byName } = buildTools({
        sessionsService: {
          findOne: jest.fn().mockResolvedValue({
            ...OPEN,
            pending_orders_tracking_enabled: true,
          }),
          getPendingOrders: jest.fn(),
          closeSession: jest.fn().mockResolvedValue(CLOSED),
        },
      });
      const prev = await preview(byName.close_cash_session, args);
      expect(prev.changes).toContainEqual(
        expect.objectContaining({
          field: 'pending_decision',
          to: args.pending_decision,
        }),
      );
      if (args.pending_decision === 'override') {
        expect(prev.changes).toContainEqual(
          expect.objectContaining({
            field: 'override_reason',
            to: args.override_reason,
          }),
        );
      }
      await run(byName.close_cash_session, args);
      expect(deps.sessionsService.getPendingOrders).not.toHaveBeenCalled();
      expect(deps.sessionsService.closeSession).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          actual_closing_amount: 350000,
          pending_decision: args.pending_decision,
          pending_fingerprint: args.pending_fingerprint,
          ...(args.pending_decision === 'override'
            ? { override_reason: args.override_reason }
            : {}),
        }),
      );
    }
  });

  it('close_cash_session exige motivo y fingerprint para override, y deniega decisiones inválidas', async () => {
    const { deps, byName } = buildTools();
    const base = { session_id: 5, actual_closing_amount: 350000 };
    for (const invalid of [
      { ...base, pending_decision: 'override', pending_fingerprint: 'fp' },
      { ...base, pending_decision: 'override', override_reason: 'motivo' },
      {
        ...base,
        pending_decision: 'ignore',
        pending_fingerprint: 'fp',
      },
    ]) {
      const out = await run(byName.close_cash_session, invalid);
      expect(out.error).toBeDefined();
      expect(out.next_step).toBeDefined();
    }
    expect(deps.sessionsService.closeSession).not.toHaveBeenCalled();
    expect(deps.sessionsService.getPendingOrders).not.toHaveBeenCalled();
  });

  it('close_cash_session cierra una sesión tracked sin pendientes y conserva legacy sin consultar órdenes', async () => {
    const { deps, byName } = buildTools({
      sessionsService: {
        findOne: jest.fn().mockResolvedValue({
          ...OPEN,
          pending_orders_tracking_enabled: true,
        }),
        getPendingOrders: jest.fn().mockResolvedValue({
          count: 0,
          fingerprint: 'empty-fingerprint',
          data: [],
        }),
        closeSession: jest.fn().mockResolvedValue(CLOSED),
      },
    });
    const out = await run(byName.close_cash_session, {
      session_id: 5,
      actual_closing_amount: 350000,
    });
    expect(out.session_id).toBe(5);
    expect(deps.sessionsService.getPendingOrders).toHaveBeenCalledWith(5, {
      limit: 100,
      page: 1,
    });
    expect(deps.sessionsService.closeSession).toHaveBeenCalled();

    const legacy = buildTools();
    await run(legacy.byName.close_cash_session, {
      session_id: 5,
      actual_closing_amount: 350000,
    });
    expect(legacy.deps.sessionsService.getPendingOrders).not.toHaveBeenCalled();
    expect(legacy.deps.sessionsService.closeSession).toHaveBeenCalled();
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

  it('close_cash_session y record_cash_movement declaran irreversible: true', () => {
    const { byName } = buildTools();
    expect(byName.close_cash_session.irreversible).toBe(true);
    // R3-A: el movimiento manual de efectivo mueve dinero y se aprueba con
    // confirmación propia dentro de planes.
    expect(byName.record_cash_movement.irreversible).toBe(true);
    // Apertura y lecturas no llevan la marca (evita fatiga del badge).
    for (const name of [
      'get_active_cash_session',
      'list_cash_sessions',
      'open_cash_session',
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
  describe('close_cash_session · pre-verificación guiada del arqueo', () => {
    function withExpected(expected: number | (() => never)) {
      const built = buildTools();
      built.deps.sessionsService.getCashSummary =
        typeof expected === 'function'
          ? jest.fn().mockRejectedValue(new Error('boom'))
          : jest.fn().mockResolvedValue({ expected_cash_total: expected });
      return built;
    }

    it('faltante sin revisar: preview en error con la señal estructurada', async () => {
      const { deps, byName } = withExpected(350000);
      const prev = await preview(byName.close_cash_session, {
        session_id: 5,
        actual_closing_amount: 320000,
      });
      expect(deps.sessionsService.getCashSummary).toHaveBeenCalledWith(5);
      expect(prev.status).toBe('error');
      expect(prev.discrepancy).toEqual(
        expect.objectContaining({
          signal: 'discrepancy_detected',
          process: 'cash_close',
          unit: 'COP',
          expected: 350000,
          actual: 320000,
          difference: -30000,
          direction: 'shortage',
          tolerance: 350,
        }),
      );
      expect(prev.discrepancy!.causes_to_check.length).toBeGreaterThan(0);
      expect(prev.discrepancy!.reads_to_run).toContain(
        'get_cash_session_close_report',
      );
      expect(prev.discrepancy!.plain_summary).toContain('faltan');
      expect(prev.message).toContain('discrepancy_reviewed=true');
    });

    it('sobrante sin revisar: dirección surplus', async () => {
      const { byName } = withExpected(350000);
      const prev = await preview(byName.close_cash_session, {
        session_id: 5,
        actual_closing_amount: 360000,
      });
      expect(prev.status).toBe('error');
      expect(prev.discrepancy!.direction).toBe('surplus');
      expect(prev.discrepancy!.difference).toBe(10000);
      expect(prev.discrepancy!.plain_summary).toContain('sobran');
    });

    it('dentro de la tolerancia: preview warning normal y sin señal', async () => {
      const { deps, byName } = withExpected(350000);
      const args = { session_id: 5, actual_closing_amount: 349800 };
      const prev = await preview(byName.close_cash_session, args);
      expect(prev.status).toBe('warning');
      expect(prev.discrepancy).toBeUndefined();
      expect(prev.changes.map((c) => c.field)).not.toContain('difference');
      await run(byName.close_cash_session, args);
      expect(deps.sessionsService.closeSession).toHaveBeenCalledWith(5, {
        actual_closing_amount: 349800,
      });
    });

    it('revisada sin motivo: preview y handler piden el motivo', async () => {
      const { deps, byName } = withExpected(350000);
      const args = {
        session_id: 5,
        actual_closing_amount: 320000,
        discrepancy_reviewed: true,
      };
      const prev = await preview(byName.close_cash_session, args);
      expect(prev.status).toBe('error');
      expect(prev.message).toContain('discrepancy_reason');
      const out = await run(byName.close_cash_session, args);
      expect(out.error).toContain('discrepancy_reason');
      expect(deps.sessionsService.closeSession).not.toHaveBeenCalled();
    });

    it('revisada con motivo: warning con la diferencia y notas con el motivo', async () => {
      const { deps, byName } = withExpected(350000);
      const args = {
        session_id: 5,
        actual_closing_amount: 320000,
        closing_notes: 'Turno de la tarde',
        discrepancy_reviewed: true,
        discrepancy_reason: 'Se pagó al domiciliario desde el cajón',
      };
      const prev = await preview(byName.close_cash_session, args);
      expect(prev.status).toBe('warning');
      expect(prev.changes).toEqual(
        expect.arrayContaining([
          {
            field: 'difference',
            label: 'Faltante',
            from: 350000,
            to: 320000,
          },
          {
            field: 'discrepancy_reason',
            label: 'Motivo de la diferencia',
            from: null,
            to: 'Se pagó al domiciliario desde el cajón',
          },
        ]),
      );
      await run(byName.close_cash_session, args);
      const dto = deps.sessionsService.closeSession.mock.calls[0][1];
      expect(dto.actual_closing_amount).toBe(320000);
      expect(dto.closing_notes).toBe(
        'Turno de la tarde\nDiferencia de arqueo (faltante de $30.000): Se pagó al domiciliario desde el cajón',
      );
    });

    it('handler sin revisar con diferencia no cierra y devuelve la señal', async () => {
      const { deps, byName } = withExpected(350000);
      const out = await run(byName.close_cash_session, {
        session_id: 5,
        actual_closing_amount: 320000,
      });
      expect(out.error).toContain('faltan');
      expect(out.discrepancy.direction).toBe('shortage');
      expect(out.next_step).toContain('discrepancy_reviewed=true');
      expect(deps.sessionsService.closeSession).not.toHaveBeenCalled();
    });

    it('si el esperado no se puede leer, el cierre sigue igual (fail-open)', async () => {
      const { deps, byName } = withExpected(() => {
        throw new Error('unused');
      });
      const args = { session_id: 5, actual_closing_amount: 1 };
      const prev = await preview(byName.close_cash_session, args);
      expect(prev.status).toBe('warning');
      expect(prev.discrepancy).toBeUndefined();
      await run(byName.close_cash_session, args);
      expect(deps.sessionsService.closeSession).toHaveBeenCalled();
    });

    it('expone los parámetros de reconocimiento de la diferencia', () => {
      const { byName } = buildTools();
      const properties = byName.close_cash_session.parameters.properties;
      expect(properties.discrepancy_reviewed.type).toBe('boolean');
      expect(properties.discrepancy_reason.type).toBe('string');
      expect(byName.close_cash_session.parameters.required).toEqual([
        'session_id',
        'actual_closing_amount',
      ]);
    });
  });
});
