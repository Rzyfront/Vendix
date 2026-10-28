import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReportDataAdapterService } from './report-data-adapter.service';
import { getReportById } from '../config/report-registry';

describe('ReportDataAdapterService summary adaptation', () => {
  let adapter: ReportDataAdapterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), ReportDataAdapterService],
    });
    adapter = TestBed.inject(ReportDataAdapterService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const purchaseSummaryReport = () => getReportById('purchase-summary')!;

  const purchasesPayload = (overrides = {}) => ({
    data: {
      total_orders: 3,
      total_spent: 1750000,
      pending_orders: 0,
      completed_orders: 3,
      total_items_ordered: 10,
      total_items_received: 10,
      pending_units: 0,
      total_tax_amount: 332500,
      deductible_tax_amount: 332500,
      capitalized_tax_amount: 0,
      average_order_value: 583333.33,
      total_spent_growth: 12.5,
      total_orders_growth: null,
      average_order_value_growth: null,
      orders_by_status: { received: 3 },
      committed_states: ['approved', 'partial', 'received'],
      store_scope: 'location',
      ...overrides,
    },
  });

  it('QUI-696: ignora committed_states (strings) y pinta 1 fila con los escalares', () => {
    const result = adapter.adapt(purchasesPayload(), purchaseSummaryReport());

    expect(result.isSummary).toBeTrue();
    expect(result.data.length).toBe(1);
    expect(result.data[0]).toEqual(
      jasmine.objectContaining({
        total_spent: 1750000,
        total_orders: 3,
        completed_orders: 3,
        average_order_value: 583333.33,
      }),
    );
    expect(result.summaryData).toEqual(
      jasmine.objectContaining({
        total_spent: 1750000,
        total_orders: 3,
        completed_orders: 3,
        average_order_value: 583333.33,
      }),
    );
  });

  it('QUI-696: período sin compras pinta 1 fila con ceros comprensibles', () => {
    const result = adapter.adapt(
      purchasesPayload({
        total_orders: 0,
        total_spent: 0,
        completed_orders: 0,
        average_order_value: 0,
        total_tax_amount: 0,
        deductible_tax_amount: 0,
        total_spent_growth: null,
        orders_by_status: {},
      }),
      purchaseSummaryReport(),
    );

    expect(result.data.length).toBe(1);
    expect(result.data[0]).toEqual(
      jasmine.objectContaining({
        total_spent: 0,
        total_orders: 0,
        completed_orders: 0,
        average_order_value: 0,
      }),
    );
  });

  it('trial-balance: el desglose de objetos (accounts) sigue alimentando la tabla', () => {
    const report = getReportById('trial-balance')!;
    const accounts = [
      { account_id: 1, account_code: '1105', total_debit: 100, total_credit: 0, balance: 100 },
      { account_id: 2, account_code: '2205', total_debit: 0, total_credit: 100, balance: -100 },
    ];
    const result = adapter.adapt(
      { data: { fiscal_period: '2026-09', accounts, totals: { total_debit: 100, total_credit: 100 } } },
      report,
    );

    expect(result.data).toEqual(accounts);
  });

  it('trial-balance sin movimientos: arreglo vacío rinde tabla vacía', () => {
    const report = getReportById('trial-balance')!;
    const result = adapter.adapt(
      { data: { fiscal_period: '2026-09', accounts: [], totals: { total_debit: 0, total_credit: 0 } } },
      report,
    );

    expect(result.data).toEqual([]);
  });

  it('tax-summary: el breakdown de objetos sigue alimentando la tabla', () => {
    const report = getReportById('tax-summary')!;
    const breakdown = [
      { tax_type: 'IVA', total_tax: 500 },
      { tax_type: 'INC', total_tax: 80 },
    ];
    const result = adapter.adapt(
      { data: { total_tax_collected: 580, net_tax: 580, breakdown } },
      report,
    );

    expect(result.data).toEqual(breakdown);
  });
});
