import { Prisma } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import { SplitOrderService } from './split-order.service';
import {
  SplitPreviewDto,
  SplitByAmountDto,
  SplitAccountPayDto,
} from './dto/split-order.dto';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

/** Unit ledger harness. SQL locking itself is covered by the integration suite. */
describe('SplitOrderService financial ledger', () => {
  let service: SplitOrderService;
  let db: any;
  let source: any;
  let groups: any[];
  let accounts: any[];
  let lines: any[];
  let taxes: any[];
  let sourcePayments: any[];
  let newPayments: any[];
  let invoices: any[];
  const context = {
    store_id: 10,
    organization_id: 6,
    user_id: 15,
    is_super_admin: false,
    is_owner: true,
  };

  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
      if (value && typeof value === 'object') {
        if ('in' in value) return value.in.includes(row[key]);
        if ('notIn' in value) return !value.notIn.includes(row[key]);
      }
      return row[key] === value;
    });

  beforeEach(() => {
    groups = [];
    accounts = [];
    lines = [];
    taxes = [];
    newPayments = [];
    invoices = [];
    sourcePayments = [
      { id: 1, amount: '40.00', state: 'succeeded', order_id: 100 },
    ];
    source = {
      id: 100,
      store_id: 10,
      state: 'draft',
      order_number: 'QA-F006',
      currency: 'COP',
      customer_id: 8,
      customer_alias: null,
      active_financial_split_id: null,
      subtotal_amount: '100.00',
      discount_amount: '0.00',
      tax_amount: '19.00',
      shipping_cost: '5.00',
      tip_amount: '6.00',
      grand_total: '130.00',
      total_paid: '40.00',
      payments: sourcePayments,
      invoices: [],
      refunds: [],
      order_installments: [],
      order_items: [1, 2].map((id) => ({
        id,
        product_id: 1000 + id,
        product_name: `Item ${id}`,
        quantity: 1,
        unit_price: '50.00',
        total_price: '50.00',
        inventory_consumed_at_fire: true,
        order_item_taxes: [
          {
            id,
            tax_rate_id: 3,
            tax_name: 'IVA',
            tax_type: 'iva',
            tax_rate: '0.19',
            tax_amount: '9.50',
            is_inclusive: false,
            is_compound: false,
          },
        ],
      })),
    };
    db = {
      $queryRaw: jest.fn(async () => [{ id: 100 }]),
      $transaction: jest.fn(async (callback) => callback(db)),
      orders: {
        findFirst: jest.fn(async ({ where }) =>
          where.id === source.id && where.store_id === source.store_id
            ? source
            : null,
        ),
        create: jest.fn(),
        updateMany: jest.fn(async ({ where, data }) => {
          if (!matches(source, where)) return { count: 0 };
          Object.assign(source, data);
          return { count: 1 };
        }),
      },
      order_items: { create: jest.fn(), updateMany: jest.fn() },
      accounts_receivable: { findFirst: jest.fn(async () => null) },
      users: {
        findFirst: jest.fn(async ({ where }) =>
          where.organization_id === 6 && where.id === 8 ? { id: 8 } : null,
        ),
      },
      payments: {
        findMany: jest.fn(async ({ where }) =>
          newPayments.filter((p) => matches(p, where)),
        ),
        count: jest.fn(
          async ({ where }) =>
            newPayments.filter((p) => matches(p, where)).length,
        ),
        updateMany: jest.fn(),
      },
      invoices: {
        findMany: jest.fn(async ({ where }) =>
          invoices.filter((i) => matches(i, where)),
        ),
        count: jest.fn(
          async ({ where }) => invoices.filter((i) => matches(i, where)).length,
        ),
      },
      order_financial_splits: {
        findFirst: jest.fn(async ({ where, include, orderBy }) => {
          const list = groups.filter((g) => matches(g, where));
          const group = orderBy
            ? list.sort((a, b) => b.version - a.version)[0]
            : list[0];
          return (
            group && {
              ...group,
              ...(include
                ? { accounts: accounts.filter((a) => a.split_id === group.id) }
                : {}),
            }
          );
        }),
        create: jest.fn(async ({ data }) => {
          const row = { id: groups.length + 1, ...data };
          groups.push(row);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          groups
            .filter((g) => matches(g, where))
            .forEach((g) => Object.assign(g, data));
          return { count: 1 };
        }),
      },
      order_financial_accounts: {
        findFirst: jest.fn(async ({ where }) =>
          accounts.find((a) => matches(a, where)),
        ),
        create: jest.fn(async ({ data }) => {
          const row = { id: accounts.length + 1, ...data };
          accounts.push(row);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          accounts
            .filter((a) => matches(a, where))
            .forEach((a) => Object.assign(a, data));
          return { count: 1 };
        }),
      },
      order_financial_lines: {
        create: jest.fn(async ({ data }) => {
          const row = { id: lines.length + 1, ...data };
          lines.push(row);
          return row;
        }),
      },
      order_financial_line_taxes: {
        create: jest.fn(async ({ data }) => {
          taxes.push(data);
          return data;
        }),
      },
    };
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(context);
    service = new SplitOrderService(db);
  });
  afterEach(() => jest.restoreAllMocks());

  async function confirm(extra: Partial<SplitByAmountDto> = {}) {
    const preview = await service.preview(100, { mode: 'equal', n_splits: 2 });
    return service.splitByAmount(100, {
      mode: 'equal',
      n_splits: 2,
      source_version: preview.source_version,
      idempotency_key: 'same-source-key',
      ...extra,
    });
  }

  it('previews only R=90 with P=40 retained, without writes', async () => {
    const result = await service.preview(100, { mode: 'equal', n_splits: 2 });
    expect(result).toMatchObject({
      original_total: '130.00',
      preserved_paid: '40.00',
      pending_to_split: '90.00',
      kitchen_fire: null,
    });
    expect(result.accounts.map((a) => a.grand_total)).toEqual([
      '45.00',
      '45.00',
    ]);
    expect(result.retained_account).toMatchObject({
      grand_total: '40.00',
      payment_state: 'paid',
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('persists immutable financial snapshots, never child orders/items or rewrites prior payments', async () => {
    const paymentsBefore = JSON.stringify(sourcePayments);
    const itemsBefore = JSON.stringify(source.order_items);
    const result = await confirm({
      accounts: [
        { customer_id: 8, label: 'Titular A' },
        { customer_alias: 'Invitado' },
      ],
    });
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0]).toMatchObject({
      customer_id: 8,
      total_paid: '0.00',
    });
    expect(result.accounts[1]).toMatchObject({
      customer_id: null,
      customer_alias: 'Invitado',
    });
    expect(result.retained_account).toMatchObject({
      customer_id: 8,
      total_paid: '40.00',
    });
    expect(source.state).toBe('draft');
    expect(source.grand_total).toBe('130.00');
    expect(JSON.stringify(sourcePayments)).toBe(paymentsBefore);
    expect(JSON.stringify(source.order_items)).toBe(itemsBefore);
    expect(db.orders.create).not.toHaveBeenCalled();
    expect(db.order_items.create).not.toHaveBeenCalled();
    expect(db.order_items.updateMany).not.toHaveBeenCalled();
    expect(db.payments.updateMany).not.toHaveBeenCalled();
    expect(groups[0].original_payment_ids).toEqual([1]);
    expect(lines.length).toBeGreaterThan(0);
    expect(
      taxes.every((tax) => tax.tax_type === 'iva' && tax.tax_rate === '0.19'),
    ).toBe(true);
    expect(db.$queryRaw.mock.calls[0].slice(1)).toEqual([100, 10]);
  });

  it('never silently copies source customer into payable accounts', async () => {
    const result = await confirm();
    expect(
      result.accounts.every(
        (a) => a.customer_id === null && a.customer_alias === null,
      ),
    ).toBe(true);
  });

  it('idempotent confirm returns same group and refuses changed allocation with same key', async () => {
    const first = await confirm();
    const same = await service.splitByAmount(100, {
      mode: 'equal',
      n_splits: 2,
      source_version: first.source_version,
      idempotency_key: 'same-source-key',
    });
    expect(same.split_group_id).toBe(first.split_group_id);
    expect(groups).toHaveLength(1);
    await expect(
      service.splitByAmount(100, {
        mode: 'equal',
        n_splits: 3,
        source_version: first.source_version,
        idempotency_key: 'same-source-key',
      }),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(groups).toHaveLength(1);
  });

  it('maps simultaneous cross-order split key collision to canonical 409', async () => {
    db.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['store_id', 'idempotency_key'] },
      }),
    );
    await expect(confirm()).rejects.toMatchObject({
      errorCode: 'SPLIT_IDEMPOTENCY_CONFLICT',
      status: 409,
    });
  });

  it('rejects stale source version after a new received payment', async () => {
    const preview = await service.preview(100, { mode: 'equal', n_splits: 2 });
    source.payments.push({ id: 2, amount: '10.00', state: 'succeeded' });
    await expect(
      service.splitByAmount(100, {
        n_splits: 2,
        source_version: preview.source_version,
        idempotency_key: 'stale-source-key',
      }),
    ).rejects.toThrow('cambió');
    expect(groups).toHaveLength(0);
  });

  it.each([
    'pending',
    'authorized',
    'partially_refunded',
    'refunded',
    'disputed',
  ])('rejects source payment state %s', async (state) => {
    source.payments.push({ id: 2, amount: '5.00', state });
    await expect(
      service.preview(100, { mode: 'equal', n_splits: 2 }),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it.each(['draft', 'validated', 'accepted', 'sent'])(
    'rejects live source invoice including %s',
    async (status) => {
      source.invoices = [{ id: 1, status }];
      await expect(
        service.preview(100, { mode: 'equal', n_splits: 2 }),
      ).rejects.toThrow('fiscal');
    },
  );

  it.each([
    { payment_form: '2' },
    { credit_type: 'free' },
    { order_installments: [{ id: 1 }] },
    { refunds: [{ id: 1 }] },
  ])('rejects materialized debt/refunds %j', async (extra) => {
    Object.assign(source, extra);
    await expect(
      service.preview(100, { mode: 'equal', n_splits: 2 }),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('rejects materialized receivable and foreign customer/store', async () => {
    db.accounts_receivable.findFirst.mockResolvedValueOnce({ id: 1 });
    await expect(
      service.preview(100, { mode: 'equal', n_splits: 2 }),
    ).rejects.toThrow('cartera');
    await expect(
      service.preview(100, {
        mode: 'equal',
        n_splits: 2,
        accounts: [{ customer_id: 999 }, {}],
      }),
    ).rejects.toThrow('organización');
    await expect(
      service.preview(999, { mode: 'equal', n_splits: 2 }),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('rejects overpaid source, stale denormalized amount does not determine P', async () => {
    source.total_paid = '999.99';
    expect(
      (await service.preview(100, { mode: 'equal', n_splits: 2 }))
        .preserved_paid,
    ).toBe('40.00');
    source.payments[0].amount = '140.00';
    await expect(
      service.preview(100, { mode: 'equal', n_splits: 2 }),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('rejects scalar-only or untyped fiscal taxes rather than inventing IVA', async () => {
    source.order_items[0].order_item_taxes[0].tax_type = null;
    await expect(
      service.preview(100, { mode: 'equal', n_splits: 2 }),
    ).rejects.toThrow('desglose fiscal');
    source.order_items[0].order_item_taxes = [];
    source.order_items[0].tax_amount_item = '9.50';
    await expect(
      service.preview(100, { mode: 'equal', n_splits: 2 }),
    ).rejects.toThrow('desglose fiscal');
  });

  it('rechaza dividir una orden cuyo envío lleva impuesto; sin copia se divide como hoy', async () => {
    // Fixture base: envío 5 sin copia de impuesto ⇒ se divide.
    await expect(
      service.preview(100, { mode: 'equal', n_splits: 2 }),
    ).resolves.toMatchObject({ original_total: '130.00' });

    // Mismo envío con copia INC 8 % congelada en la orden.
    source.shipping_tax_rate_id = 68;
    source.shipping_tax_name = 'INC 8%';
    source.shipping_tax_type = 'inc';
    source.shipping_tax_rate = '0.08000';
    source.shipping_tax_amount = '0.37';
    await expect(
      service.preview(100, { mode: 'equal', n_splits: 2 }),
    ).rejects.toThrow('envío con impuesto');

    // Copia vacía (default de la columna) ⇒ vuelve a dividirse.
    source.shipping_tax_amount = '0.00';
    await expect(
      service.preview(100, { mode: 'equal', n_splits: 2 }),
    ).resolves.toMatchObject({ original_total: '130.00' });
  });

  it('supports items and custom remainder, rejecting duplicate/omitted items', async () => {
    expect(
      (
        await service.preview(100, {
          mode: 'custom',
          n_splits: 2,
          amounts: [30, 60],
        })
      ).accounts.map((a) => a.grand_total),
    ).toEqual(['30.00', '60.00']);
    expect(
      (
        await service.preview(100, {
          mode: 'items',
          item_groups: [{ order_item_ids: [1] }, { order_item_ids: [2] }],
        })
      ).accounts,
    ).toHaveLength(2);
    await expect(
      service.preview(100, {
        mode: 'items',
        item_groups: [{ order_item_ids: [1] }, { order_item_ids: [1] }],
      }),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('cancel restores editability with original P intact, then allows a new version', async () => {
    const group = await confirm();
    await service.cancel(100, { source_version: group.source_version });
    expect(source.active_financial_split_id).toBeNull();
    expect(source.payments).toEqual(sourcePayments);
    expect(groups[0].state).toBe('cancelled');
    await confirm({ idempotency_key: 'second-group-key' });
    expect(groups[1].version).toBe(2);
  });

  it.each(['pending', 'authorized', 'succeeded', 'captured'])(
    'does not cancel when a new account has %s payment',
    async (state) => {
      const result = await confirm();
      newPayments.push({
        id: 10,
        financial_account_id: result.accounts[0].id,
        state,
        amount: '5.00',
        order_id: 100,
      });
      await expect(
        service.cancel(100, { source_version: result.source_version }),
      ).rejects.toThrow('pagos nuevos');
      expect(source.active_financial_split_id).toBe(result.split_group_id);
    },
  );

  it('cannot cancel invoice or change payer after collection; label-only retains payer', async () => {
    const result = await confirm({ accounts: [{ customer_id: 8 }, {}] });
    const accountId = result.accounts[0].id!;
    await service.updateCustomer(100, accountId, { label: 'Mesa A' });
    expect(accounts.find((a) => a.id === accountId).customer_id).toBe(8);
    invoices.push({
      id: 9,
      financial_account_id: accountId,
      order_id: 100,
      status: 'draft',
    });
    await expect(
      service.cancel(100, { source_version: result.source_version }),
    ).rejects.toThrow('documentos');
    await expect(
      service.updateCustomer(100, accountId, { customer_alias: 'Otro' }),
    ).rejects.toThrow('titular');
  });

  it('read derives account balances from real payments and distinguishes pending/manual gateway', async () => {
    const result = await confirm();
    newPayments.push(
      {
        id: 10,
        order_id: 100,
        financial_account_id: result.accounts[0].id,
        amount: '10.00',
        state: 'succeeded',
      },
      {
        id: 11,
        order_id: 100,
        financial_account_id: result.accounts[0].id,
        amount: '5.00',
        state: 'pending',
        store_payment_method: {
          system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' },
        },
      },
    );
    const read = await service.getSplit(100);
    expect(read!.accounts[0]).toMatchObject({
      total_paid: '10.00',
      remaining_balance: '35.00',
      available_to_pay: '30.00',
      payment_state: 'partial',
    });
    expect(read!.accounts[0].payments[1].can_confirm).toBe(false);
  });
});

describe('financial split DTO input boundary', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const validate = (value: any, metatype: any) =>
    pipe.transform(value, { type: 'body', metatype });
  it('accepts preview and tokenized Wompi object', async () => {
    await expect(
      validate({ mode: 'equal', n_splits: 2 }, SplitPreviewDto),
    ).resolves.toBeInstanceOf(SplitPreviewDto);
    await expect(
      validate(
        {
          amount: 10,
          store_payment_method_id: 1,
          idempotency_key: 'wompi-001',
          wompi_payment_method: { type: 'NEQUI', phone_number: '3000000000' },
        },
        SplitAccountPayDto,
      ),
    ).resolves.toBeInstanceOf(SplitAccountPayDto);
  });
  it.each([-1, 0, 0.001, 'NaN', Infinity])(
    'rejects payment amount %s',
    async (amount) => {
      await expect(
        validate(
          {
            amount,
            store_payment_method_id: 1,
            idempotency_key: 'request-001',
          },
          SplitAccountPayDto,
        ),
      ).rejects.toThrow();
    },
  );
  it.each([
    {},
    { type: 'NEQUI' },
    { type: 'CARD', token: 'PAN-123', installments: 1 },
    { type: 'PSE', user_type: 5 },
    {
      type: 'NEQUI',
      phone_number: '3000000000',
      card_number: 'never-accepted',
    },
  ])('rejects malformed Wompi payload %j', async (wompi_payment_method) => {
    await expect(
      validate(
        {
          amount: 10,
          store_payment_method_id: 1,
          idempotency_key: 'request-001',
          wompi_payment_method,
        },
        SplitAccountPayDto,
      ),
    ).rejects.toThrow();
  });
  it('rejects excess splits, duplicate IDs and external financial fields', async () => {
    await expect(
      validate({ mode: 'equal', n_splits: 21 }, SplitPreviewDto),
    ).rejects.toThrow();
    await expect(
      validate(
        {
          mode: 'items',
          item_groups: [{ order_item_ids: [1, 1] }, { order_item_ids: [2] }],
        },
        SplitPreviewDto,
      ),
    ).rejects.toThrow();
    await expect(
      validate({ mode: 'equal', n_splits: 2, grand_total: 1 }, SplitPreviewDto),
    ).rejects.toThrow();
  });
});
