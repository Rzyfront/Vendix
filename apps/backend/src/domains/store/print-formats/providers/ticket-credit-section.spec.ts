import { PosSaleTicketDataProvider } from './pos-sale-ticket.provider';
import { PrintLayoutComposerService } from '../services/print-layout-composer.service';

/**
 * QUI-979 — gate de sección Crédito (provider + composer).
 *
 * La venta a crédito imprime total del crédito, abonado (Cuotas X de Y),
 * saldo pendiente, último abono, historial de abonos y calendario de cuotas
 * pendientes. El tiquete de contado y la orden cancelada salen byte-idénticos
 * (sin la llave `credit`). La ruta `custom_template` queda excluida por
 * diseño (plantilla total de la tienda).
 */
describe('ticket — gate de sección Crédito (QUI-979)', () => {
  const orderRow: any = {
    id: 7,
    order_number: 'POS-0007',
    created_at: new Date('2026-08-27T09:15:00.000Z'),
    state: 'created',
    payment_form: '2',
    credit_type: 'installments',
    subtotal_amount: 4629.62,
    discount_amount: 0,
    tax_amount: 370.36,
    shipping_cost: 0,
    grand_total: 100000,
    total_paid: 20000,
    remaining_balance: 80000,
    total_with_interest: 100000,
    order_items: [],
    users: null,
    stores: {
      name: 'Tienda Test',
      organizations: { tax_id: '900.000.000-1' },
      addresses: [],
    },
    table_sessions: [],
    payments: [],
  };

  const installment = (over: any = {}) => ({
    id: 1,
    order_id: 7,
    installment_number: 1,
    amount: 20000,
    capital_amount: 20000,
    interest_amount: 0,
    due_date: new Date('2026-09-15T00:00:00.000Z'),
    state: 'pending',
    amount_paid: 0,
    remaining_balance: 20000,
    paid_at: null,
    ...over,
  });

  const posPayment = (over: any = {}) => ({
    id: 11,
    amount: 20000,
    paid_at: new Date('2026-08-27T14:15:00.000Z'),
    created_at: new Date('2026-08-27T14:15:00.000Z'),
    gateway_response: {
      metadata: { is_initial_credit_payment: true },
    },
    store_payment_method: {
      display_name: null,
      system_payment_method: { display_name: 'Efectivo', name: 'cash' },
    },
    ...over,
  });

  const arPayment = (over: any = {}) => ({
    id: 31,
    amount: 10000,
    payment_date: new Date('2026-09-02T16:00:00.000Z'),
    payment_method: 'Transferencia',
    ...over,
  });

  const makePrisma = (
    over: {
      order?: any;
      installments?: any[];
      payments?: any[];
      ars?: any[];
      arPayments?: any[];
    } = {},
  ) =>
    ({
      orders: {
        findFirst: jest.fn().mockResolvedValue(over.order ?? orderRow),
      },
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
      refunds: { findMany: jest.fn().mockResolvedValue([]) },
      order_installments: {
        findMany: jest.fn().mockResolvedValue(over.installments ?? []),
      },
      payments: {
        findMany: jest.fn().mockResolvedValue(over.payments ?? []),
      },
      accounts_receivable: {
        findMany: jest.fn().mockResolvedValue(over.ars ?? []),
      },
      ar_payments: {
        findMany: jest.fn().mockResolvedValue(over.arPayments ?? []),
      },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      withoutScope: () => ({
        credit_note_refund_items: { findMany: jest.fn().mockResolvedValue([]) },
        invoices: { findFirst: jest.fn().mockResolvedValue(null) },
        order_items: { findMany: jest.fn().mockResolvedValue([]) },
      }),
    }) as any;

  describe('provider pos_sale_ticket', () => {
    it('contado (payment_form 1): sin sección y modelo byte-idéntico', async () => {
      const prisma = makePrisma({
        order: { ...orderRow, payment_form: '1' },
      });
      const provider = new PosSaleTicketDataProvider(prisma);

      const a = await provider.fetchDocumentData(10, 7);
      const b = await provider.fetchDocumentData(10, 7);

      expect((a as any).custom_variables?.credit).toBeUndefined();
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(JSON.stringify(a)).not.toContain('credit');
    });

    it('orden cancelada: sin sección aunque haya sido crédito', async () => {
      const data = await new PosSaleTicketDataProvider(
        makePrisma({ order: { ...orderRow, state: 'cancelled' } }),
      ).fetchDocumentData(10, 7);

      expect((data as any).custom_variables?.credit).toBeUndefined();
    });

    it('crédito con inicial: total/abonado/saldo cuadran y totales intactos', async () => {
      const withCredit = await new PosSaleTicketDataProvider(
        makePrisma({
          installments: [
            installment({ id: 1, installment_number: 1 }),
            installment({ id: 2, installment_number: 2 }),
            installment({ id: 3, installment_number: 3 }),
            installment({ id: 4, installment_number: 4 }),
          ],
          payments: [posPayment()],
          ars: [{ id: 55 }],
          arPayments: [],
        }),
      ).fetchDocumentData(10, 7);
      const cash = await new PosSaleTicketDataProvider(
        makePrisma({ order: { ...orderRow, payment_form: '1' } }),
      ).fetchDocumentData(10, 7);

      const section = (withCredit as any).custom_variables?.credit;
      expect(section).toBeDefined();
      expect(section.total).toBe(100000);
      expect(section.paid_total).toBe(20000);
      expect(section.balance).toBe(80000);
      expect(section.installments_paid).toBe(0);
      expect(section.installments_total).toBe(4);
      expect(section.last_payment).toMatchObject({ amount: 20000 });
      expect(section.payments).toEqual([
        expect.objectContaining({
          amount: 20000,
          method: 'Efectivo',
          is_initial: true,
        }),
      ]);
      expect(section.pending_installments).toHaveLength(4);
      expect(section.pending_installments[0]).toMatchObject({
        number: 1,
        balance: 20000,
      });
      // Inmutabilidad del original: mismos totales, mismos ítems, mismos impuestos.
      expect(withCredit.totals).toEqual(cash.totals);
      expect(withCredit.items).toEqual(cash.items);
      expect(withCredit.taxes).toEqual(cash.taxes);
    });

    it('abono posterior actualiza X de Y, saldo e historial', async () => {
      const data = await new PosSaleTicketDataProvider(
        makePrisma({
          order: { ...orderRow, total_paid: 50000, remaining_balance: 50000 },
          installments: [
            installment({
              id: 1,
              installment_number: 1,
              state: 'paid',
              amount_paid: 20000,
              remaining_balance: 0,
            }),
            installment({
              id: 2,
              installment_number: 2,
              state: 'partial',
              amount_paid: 10000,
              remaining_balance: 10000,
            }),
            installment({ id: 3, installment_number: 3 }),
            installment({ id: 4, installment_number: 4 }),
          ],
          payments: [
            posPayment(),
            posPayment({
              id: 12,
              amount: 20000,
              paid_at: new Date('2026-09-10T15:00:00.000Z'),
              created_at: new Date('2026-09-10T15:00:00.000Z'),
              gateway_response: { metadata: { is_credit_payment: true } },
            }),
          ],
          ars: [{ id: 55 }],
          arPayments: [arPayment()],
        }),
      ).fetchDocumentData(10, 7);

      const section = (data as any).custom_variables.credit;
      expect(section.paid_total).toBe(50000);
      expect(section.balance).toBe(50000);
      expect(section.installments_paid).toBe(1);
      expect(section.installments_total).toBe(4);
      expect(section.payments).toHaveLength(3);
      // Orden cronológico: inicial 27/08, abono CxC 02/09, abono POS 10/09.
      expect(section.payments.map((p: any) => p.amount)).toEqual([
        20000, 10000, 20000,
      ]);
      expect(section.last_payment).toMatchObject({ amount: 20000 });
      expect(section.pending_installments.map((p: any) => p.number)).toEqual([
        2, 3, 4,
      ]);
    });

    it('crédito libre (sin cuotas): totales + historial, sin calendario', async () => {
      const data = await new PosSaleTicketDataProvider(
        makePrisma({
          order: {
            ...orderRow,
            credit_type: 'free',
            total_with_interest: null,
            total_paid: 30000,
            remaining_balance: 70000,
          },
          installments: [],
          payments: [posPayment({ amount: 30000 })],
          ars: [{ id: 55 }],
          arPayments: [],
        }),
      ).fetchDocumentData(10, 7);

      const section = (data as any).custom_variables.credit;
      expect(section.is_installments).toBe(false);
      expect(section.total).toBe(100000);
      expect(section.paid_total).toBe(30000);
      expect(section.balance).toBe(70000);
      expect(section.installments_total).toBe(0);
      expect(section.pending_installments).toEqual([]);
      expect(section.payments).toHaveLength(1);
    });
  });

  describe('composer', () => {
    const compiler: any = {
      escapeHtml: (v: unknown) => String(v ?? ''),
      compile: jest.fn((tpl: string) => ({ compiled: `<div>${tpl}</div>` })),
    };
    const composer = () => new PrintLayoutComposerService(compiler);

    const modelWith = (over: any = {}) =>
      ({
        totals: { grand_total: 100000 },
        custom_variables: {
          credit: {
            is_installments: true,
            total: 100000,
            total_formatted: '$100.000',
            paid_total: 20000,
            paid_total_formatted: '$20.000',
            balance: 80000,
            balance_formatted: '$80.000',
            installments_total: 4,
            installments_paid: 1,
            last_payment: {
              amount: 20000,
              amount_formatted: '$20.000',
              date: '2026-09-10T20:00:00.000Z',
              date_formatted: '10/09/2026',
            },
            payments: [
              {
                date: '2026-08-27T19:15:00.000Z',
                date_formatted: '27/08/2026',
                amount: 20000,
                amount_formatted: '$20.000',
                method: 'Efectivo',
                is_initial: true,
              },
            ],
            pending_installments: [
              {
                number: 2,
                state: 'partial',
                due_date: '2026-10-15T00:00:00.000Z',
                due_date_formatted: '15/10/2026',
                amount: 20000,
                amount_formatted: '$20.000',
                balance: 10000,
                balance_formatted: '$10.000',
              },
            ],
          },
        },
        ...over,
      }) as any;

    it('con sección: pinta sec_credit + CRÉDITO + cuotas + calendario', () => {
      const html = (composer() as any).renderCreditSection(modelWith());

      expect(html).toContain('sec_credit');
      expect(html).toContain('CRÉDITO');
      expect(html).toContain('Total del crédito:');
      expect(html).toContain('Abonado:');
      expect(html).toContain('(Cuotas 1 de 4)');
      expect(html).toContain('Saldo pendiente:');
      expect(html).toContain('Último abono:');
      expect(html).toContain('Efectivo (inicial)');
      expect(html).toContain('Cuota 2 (parcial)');
      expect(html).toContain('15/10/2026');
    });

    it('sin credit: string vacío (salida byte-idéntica)', () => {
      expect(
        (composer() as any).renderCreditSection({
          totals: {},
          custom_variables: {},
        }),
      ).toBe('');
      expect((composer() as any).renderCreditSection({ totals: {} })).toBe('');
    });

    it('custom_template queda excluida por diseño (plantilla total de la tienda)', () => {
      const html = composer().compose(
        {
          custom_template: '<div>Mi diseño</div>',
          sections: [],
          paper: {},
          styles: {},
        } as any,
        modelWith(),
      );

      expect(compiler.compile).toHaveBeenCalledWith(
        '<div>Mi diseño</div>',
        expect.anything(),
        'dummy',
        undefined,
      );
      expect(html).not.toContain('sec_credit');
      expect(html).not.toContain('CRÉDITO');
    });
  });
});
