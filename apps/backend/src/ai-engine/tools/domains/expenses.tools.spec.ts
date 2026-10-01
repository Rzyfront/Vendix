import { createExpenseTools, ExpenseToolDeps } from './expenses.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 8 (vex-agent) — contrato expenses: 2 reads + 2 writes.
 *
 * Patrón canónico T4: happy/sad con sad sin tocar deps, literales con
 * `toEqual`, `{error, next_step}` en ES, permiso por tool, `readOnly` en
 * reads y `requiresConfirmation` + `preview` con sujeto humano en writes.
 */
describe('expenses.tools · gastos', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const PENDING = {
    id: 9,
    description: 'Compra de insumos',
    amount: 250000,
    state: 'pending',
    expense_date: '2026-09-30',
  };
  const APPROVED = { ...PENDING, state: 'approved' };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      expensesService: {
        findAll: jest.fn().mockResolvedValue({
          data: [PENDING],
          meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
        }),
        findOne: jest.fn().mockResolvedValue(PENDING),
        create: jest.fn().mockResolvedValue({ ...PENDING, id: 10 }),
      },
      expenseFlowService: {
        approve: jest.fn().mockResolvedValue(APPROVED),
      },
      ...overrides,
    } as any;
    const tools = createExpenseTools(deps as ExpenseToolDeps);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    return { deps: deps as any, tools, byName };
  }

  function run(tool: RegisteredTool, args: Record<string, any> = {}) {
    return tool.handler!(args, CONTEXT).then((raw) => JSON.parse(raw));
  }

  function preview(tool: RegisteredTool, args: Record<string, any> = {}) {
    return tool.preview!(args, CONTEXT);
  }

  it('expone 2 reads + 2 writes con permisos del endpoint equivalente', () => {
    const { tools } = buildTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['approve_expense', 'create_expense', 'get_expense', 'list_expenses'].sort(),
    );
    const perms = Object.fromEntries(
      tools.map((t) => [t.name, t.requiredPermissions]),
    );
    expect(perms).toEqual({
      list_expenses: ['store:expenses:read'],
      get_expense: ['store:expenses:read'],
      create_expense: ['store:expenses:create'],
      approve_expense: ['store:expenses:approve'],
    });
    expect(
      tools.find((t) => t.name === 'list_expenses')!.readOnly,
    ).toBe(true);
    expect(tools.find((t) => t.name === 'get_expense')!.readOnly).toBe(
      true,
    );
    for (const name of ['create_expense', 'approve_expense']) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
    }
  });

  it('list_expenses filtra por estado', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.list_expenses, { state: 'pending' });
    expect(out.data).toEqual([PENDING]);
    expect(deps.expensesService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'pending' }),
    );
  });

  it('list_expenses rechaza date_from inválida sin tocar deps', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.list_expenses, { date_from: 'ayer' });
    expect(out).toEqual({
      error: 'date_from inválido: ayer.',
      next_step: 'Usa formato YYYY-MM-DD.',
    });
    expect(deps.expensesService.findAll).not.toHaveBeenCalled();
  });

  it('create_expense previsualiza con sujeto humano y registra en pending', async () => {
    const { deps, byName } = buildTools();
    const args = {
      amount: 250000,
      expense_date: '2026-09-30',
      description: 'Compra de insumos',
    };
    const prev = await preview(byName.create_expense, args);
    expect(prev.status).toBe('ok');
    expect(prev.target).toContain('Compra de insumos');
    expect(prev.target).toContain('$250000');
    const out = await run(byName.create_expense, args);
    expect(out.expense_id).toBe(10);
    expect(deps.expensesService.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 250000 }),
    );
  });

  it('create_expense rechaza monto cero sin tocar deps', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.create_expense, {
      amount: 0,
      expense_date: '2026-09-30',
    });
    expect(out.error).toContain('mayor que cero');
    expect(out.next_step).toBeDefined();
    expect(deps.expensesService.create).not.toHaveBeenCalled();
  });

  it('approve_expense exige pending en preview y handler', async () => {
    const { deps, byName } = buildTools({
      expensesService: {
        findOne: jest.fn().mockResolvedValue(APPROVED),
      },
      expenseFlowService: { approve: jest.fn() },
    });
    const prev = await preview(byName.approve_expense, { expense_id: 9 });
    expect(prev.status).toBe('error');
    expect(prev.message).toContain('pending');
    const out = await run(byName.approve_expense, { expense_id: 9 });
    expect(out.error).toContain('pending');
    expect(deps.expenseFlowService.approve).not.toHaveBeenCalled();
  });

  it('approve_expense aprueba desde pending', async () => {
    const { deps, byName } = buildTools();
    const prev = await preview(byName.approve_expense, { expense_id: 9 });
    expect(prev.status).toBe('ok');
    expect(prev.target).toContain('Compra de insumos');
    const out = await run(byName.approve_expense, { expense_id: 9 });
    expect(out).toEqual({
      resumen: 'gasto #9 — Compra de insumos aprobado.',
      expense_id: 9,
      estado: 'approved',
    });
    expect(deps.expenseFlowService.approve).toHaveBeenCalledWith(9);
  });
});
