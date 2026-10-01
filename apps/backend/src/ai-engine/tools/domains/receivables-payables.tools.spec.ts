import {
  createReceivablesPayablesTools,
  ReceivablesPayablesToolDeps,
} from './receivables-payables.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 8 (vex-agent) — contrato receivables-payables: 4 reads + 2 writes.
 *
 * Patrón canónico T4: happy/sad con sad sin tocar deps, literales con
 * `toEqual`, `{error, next_step}` en ES, permiso por tool, `readOnly` en
 * reads y `requiresConfirmation` + `preview` con sujeto humano en writes.
 */
describe('receivables-payables.tools · cartera y CxP', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const AR = {
    id: 31,
    customer_id: 4,
    customer_name: 'Tienda La Esquina',
    balance: 180000,
    status: 'partial',
  };
  const AP = {
    id: 12,
    supplier_id: 2,
    supplier_name: 'Distribuidora Andina',
    balance: 500000,
    status: 'open',
  };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      accountsReceivableService: {
        findAll: jest.fn().mockResolvedValue({
          data: [AR],
          meta: { total: 1, page: 1, limit: 20, total_pages: 1 },
        }),
        findOne: jest.fn().mockResolvedValue(AR),
        registerPayment: jest
          .fn()
          .mockResolvedValue({ ...AR, balance: 80000 }),
      },
      accountsPayableService: {
        findAll: jest.fn().mockResolvedValue({
          data: [AP],
          meta: { total: 1, page: 1, limit: 20, total_pages: 1 },
        }),
        findOne: jest.fn().mockResolvedValue(AP),
        registerPayment: jest
          .fn()
          .mockResolvedValue({ ...AP, balance: 0, status: 'paid' }),
      },
      ...overrides,
    } as any;
    const tools = createReceivablesPayablesTools(
      deps as ReceivablesPayablesToolDeps,
    );
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    return { deps: deps as any, tools, byName };
  }

  function run(
    tool: RegisteredTool,
    args: Record<string, any> = {},
    context: Record<string, any> = CONTEXT,
  ) {
    return tool.handler!(args, context).then((raw) => JSON.parse(raw));
  }

  function preview(tool: RegisteredTool, args: Record<string, any> = {}) {
    return tool.preview!(args, CONTEXT);
  }

  it('expone 4 reads + 2 writes con permisos del endpoint equivalente', () => {
    const { tools } = buildTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'collect_receivable',
        'get_payable',
        'get_receivable',
        'list_payables',
        'list_receivables',
        'pay_payable',
      ].sort(),
    );
    const perms = Object.fromEntries(
      tools.map((t) => [t.name, t.requiredPermissions]),
    );
    expect(perms).toEqual({
      list_receivables: ['store:accounts_receivable:read'],
      get_receivable: ['store:accounts_receivable:read'],
      collect_receivable: ['store:accounts_receivable:payment'],
      list_payables: ['store:accounts_payable:read'],
      get_payable: ['store:accounts_payable:read'],
      pay_payable: ['store:accounts_payable:payment'],
    });
    for (const name of [
      'list_receivables',
      'get_receivable',
      'list_payables',
      'get_payable',
    ]) {
      expect(tools.find((t) => t.name === name)!.readOnly).toBe(true);
    }
    for (const name of ['collect_receivable', 'pay_payable']) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
    }
  });

  it('list_receivables filtra por estado', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.list_receivables, { status: 'partial' });
    expect(out.data).toEqual([AR]);
    expect(deps.accountsReceivableService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'partial' }),
    );
  });

  it('collect_receivable abona dentro del saldo', async () => {
    const { deps, byName } = buildTools();
    const args = { receivable_id: 31, amount: 100000 };
    const prev = await preview(byName.collect_receivable, args);
    expect(prev.status).toBe('ok');
    expect(prev.target).toContain('Tienda La Esquina');
    const out = await run(byName.collect_receivable, args);
    expect(out.resumen).toContain('Abono $100000');
    expect(deps.accountsReceivableService.registerPayment).toHaveBeenCalledWith(
      31,
      expect.objectContaining({ amount: 100000 }),
      11,
    );
  });

  it('collect_receivable rechaza abono mayor que el saldo', async () => {
    const { deps, byName } = buildTools();
    const prev = await preview(byName.collect_receivable, {
      receivable_id: 31,
      amount: 999999,
    });
    expect(prev.status).toBe('error');
    expect(prev.message).toContain('excede el saldo');
    const out = await run(byName.collect_receivable, {
      receivable_id: 31,
      amount: 999999,
    });
    expect(out.error).toContain('excede el saldo');
    expect(
      deps.accountsReceivableService.registerPayment,
    ).not.toHaveBeenCalled();
  });

  it('collect_receivable rechaza cuenta pagada', async () => {
    const { deps, byName } = buildTools({
      accountsReceivableService: {
        findOne: jest
          .fn()
          .mockResolvedValue({ ...AR, status: 'paid', balance: 0 }),
        registerPayment: jest.fn(),
      },
    });
    const out = await run(byName.collect_receivable, {
      receivable_id: 31,
      amount: 1000,
    });
    expect(out.error).toContain('paid');
    expect(
      deps.accountsReceivableService.registerPayment,
    ).not.toHaveBeenCalled();
  });

  it('pay_payable advierte y paga dentro del saldo', async () => {
    const { deps, byName } = buildTools();
    const args = {
      payable_id: 12,
      amount: 500000,
      payment_method: 'bank_transfer',
    };
    const prev = await preview(byName.pay_payable, args);
    expect(prev.status).toBe('warning');
    expect(prev.target).toContain('Distribuidora Andina');
    const out = await run(byName.pay_payable, args);
    expect(out.resumen).toContain('Pago $500000');
    expect(deps.accountsPayableService.registerPayment).toHaveBeenCalledWith(
      12,
      expect.objectContaining({
        amount: 500000,
        payment_method: 'bank_transfer',
      }),
      11,
    );
  });

  it('pay_payable exige payment_method sin tocar deps', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.pay_payable, {
      payable_id: 12,
      amount: 1000,
    });
    expect(out.error).toContain('payment_method');
    expect(
      deps.accountsPayableService.registerPayment,
    ).not.toHaveBeenCalled();
  });
});
