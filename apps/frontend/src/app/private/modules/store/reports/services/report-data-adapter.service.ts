import { Injectable } from '@angular/core';
import {
  ReportDefinition,
  ReportAdaptedData,
  ReportType,
} from '../interfaces/report.interface';

interface NormalizedResponse {
  data: any[];
  meta?: Record<string, any>;
}

@Injectable({ providedIn: 'root' })
export class ReportDataAdapterService {

  /**
   * Adapts raw backend response to the format expected by the frontend,
   * using the report definition to determine the correct strategy.
   */
  adapt(rawData: any, report: ReportDefinition): ReportAdaptedData {
    // Custom transformers for reports with non-standard response shapes
    if (report.id === 'profit-loss') {
      return this.adaptProfitLoss(rawData);
    }
    if (report.id === 'accounts-payable-aging') {
      return this.adaptAccountsPayableAging(rawData);
    }
    if (report.id === 'customer-receivables') {
      return this.adaptCustomerReceivables(rawData);
    }

    const normalized = this.normalizeResponse(rawData);
    const reportType = this.resolveType(report, normalized);

    switch (reportType) {
      case 'summary':
        return this.adaptSummary(normalized);
      case 'list':
        return this.adaptList(normalized, report);
      case 'nested':
        return this.adaptNested(normalized);
      default:
        return { data: normalized.data, meta: normalized.meta };
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Normalizes any backend response shape into a consistent { data, meta } structure.
   */
  private normalizeResponse(raw: any): NormalizedResponse {
    if (Array.isArray(raw)) {
      return { data: raw };
    }

    if (raw == null || typeof raw !== 'object') {
      return { data: [] };
    }

    if (Array.isArray(raw.data)) {
      const { data, ...rest } = raw;
      // Flatten: if backend returned { data, meta: { pagination } }, extract pagination directly
      const meta = rest.meta && typeof rest.meta === 'object' && !Array.isArray(rest.meta)
        ? rest.meta
        : Object.keys(rest).length ? rest : undefined;
      return { data, meta };
    }

    // raw.data is a plain object (not array) — treat as a single summary row
    if (raw.data != null && typeof raw.data === 'object') {
      const { data, ...rest } = raw;
      const meta = rest.meta && typeof rest.meta === 'object' && !Array.isArray(rest.meta)
        ? rest.meta
        : Object.keys(rest).length ? rest : undefined;
      return { data: [data], meta };
    }

    // No .data property — likely a bare summary object
    return { data: [raw] };
  }

  /**
   * Determines the effective report type: explicit from definition or auto-detected.
   */
  private resolveType(report: ReportDefinition, normalized: NormalizedResponse): ReportType {
    if (report.type) {
      return report.type;
    }

    // Auto-detect: single-row response with non-scalar values is a summary
    if (normalized.data.length === 1 && this.detectSummary(normalized.data[0])) {
      return 'summary';
    }

    return 'list';
  }

  /**
   * A response is a summary if it's a plain object with multiple numeric/string keys
   * (not a typical tabular row with a clear entity identifier).
   */
  private detectSummary(row: any): boolean {
    if (row == null || typeof row !== 'object' || Array.isArray(row)) {
      return false;
    }

    const keys = Object.keys(row);
    if (keys.length === 0) {
      return false;
    }

    const primitiveCount = keys.filter(k => {
      const v = row[k];
      return v === null || v === undefined || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
    }).length;

    return primitiveCount >= 2;
  }

  private adaptSummary(normalized: NormalizedResponse): ReportAdaptedData {
    const rawSummary = normalized.data[0] || {};

    // For reports like expense-summary that have both summary fields and a nested array
    // (e.g., category_breakdown), extract the array as tabular data
    const arrayKey = Object.keys(rawSummary).find(
      k => Array.isArray(rawSummary[k])
    );
    const tableData = arrayKey ? rawSummary[arrayKey] : [];

    // Build summaryData from non-array, non-object primitives
    const summaryData: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawSummary)) {
      if (!Array.isArray(value) && typeof value !== 'object') {
        summaryData[key] = value;
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Flatten nested objects (e.g., counts_by_state) into summary
        for (const [subKey, subValue] of Object.entries(value)) {
          summaryData[`${key}_${subKey}`] = subValue;
        }
      }
    }

    return {
      data: tableData,
      isSummary: true,
      summaryData,
      meta: normalized.meta,
    };
  }

  private adaptList(normalized: NormalizedResponse, report: ReportDefinition): ReportAdaptedData {
    const keyMapping = report.keyMapping;
    const trackKey = report.trackKey;

    let mappedRows = keyMapping
      ? this.applyKeyMapping(normalized.data, keyMapping)
      : normalized.data;

    if (trackKey) {
      mappedRows = this.ensureRowId(mappedRows, trackKey);
    }

    return { data: mappedRows, meta: normalized.meta };
  }

  private adaptNested(normalized: NormalizedResponse): ReportAdaptedData {
    // Specialized components (balance-sheet, aging) handle their own rendering
    return { data: normalized.data, meta: normalized.meta };
  }

  /**
   * Renames properties on each row according to the mapping:
   * { 'backend_key': 'frontend_key' } => row.backend_key becomes row.frontend_key
   */
  private applyKeyMapping(rows: any[], mapping: Record<string, string>): any[] {
    if (!mapping || Object.keys(mapping).length === 0) {
      return rows;
    }

    return rows.map(row => {
      const mapped: Record<string, any> = {};

      for (const [key, value] of Object.entries(row)) {
        const targetKey = mapping[key] ?? key;
        mapped[targetKey] = value;
      }

      return mapped;
    });
  }

  /**
   * Ensures each row has a unique _rowId derived from the trackKey field,
   * falling back to an index-based id when the key is missing.
   */
  private ensureRowId(rows: any[], trackKey: string): any[] {
    return rows.map((row, index) => {
      if (row[trackKey] != null && row._rowId == null) {
        return { ...row, _rowId: String(row[trackKey]) };
      }
      if (row._rowId == null) {
        return { ...row, _rowId: `row-${index}` };
      }
      return row;
    });
  }

  // ── Custom report transformers ────────────────────────────────────────────

  /**
   * Transforms the profit-loss nested object into flat rows with sections
   * for the nested-report component.
   */
  private adaptProfitLoss(raw: any): ReportAdaptedData {
    const d = raw?.data ?? raw;
    const rows: any[] = [];

    // Revenue section
    if (d.revenue) {
      rows.push({ section: 'Ingresos', concept: 'Ingresos Brutos', amount: Number(d.revenue.gross_revenue || 0) });
      if (d.revenue.discounts) rows.push({ section: 'Ingresos', concept: 'Descuentos', amount: -Number(d.revenue.discounts || 0) });
      if (d.revenue.shipping_revenue) rows.push({ section: 'Ingresos', concept: 'Envios', amount: Number(d.revenue.shipping_revenue || 0) });
      rows.push({ section: 'Ingresos', concept: 'Ingresos Netos', amount: Number(d.revenue.net_revenue || 0), is_total: true });
    }

    // Costs section
    if (d.costs) {
      rows.push({ section: 'Costos', concept: 'Costo de Mercancia Vendida', amount: Number(d.costs.cost_of_goods_sold || 0) });
      rows.push({ section: 'Costos', concept: 'Utilidad Bruta', amount: Number(d.costs.gross_profit || 0), is_total: true, percentage: d.costs.gross_margin });
    }

    // Refunds section
    if (d.refunds && Number(d.refunds.total_refunds || 0) > 0) {
      rows.push({ section: 'Devoluciones', concept: 'Total Devoluciones', amount: -Number(d.refunds.total_refunds || 0) });
    }

    // Operating expenses
    if (d.operating_expenses != null) {
      rows.push({ section: 'Gastos Operativos', concept: 'Gastos Operativos', amount: Number(d.operating_expenses || 0) });
    }

    // Bottom line
    if (d.bottom_line) {
      rows.push({ section: 'Resultado Final', concept: 'Utilidad Neta', amount: Number(d.bottom_line.net_profit || 0), is_total: true, percentage: d.bottom_line.net_margin });
    }

    return { data: rows, meta: undefined };
  }

  /**
   * Transforms the accounts-payable-aging buckets response into a summary.
   */
  private adaptAccountsPayableAging(raw: any): ReportAdaptedData {
    const d = raw?.data ?? raw;
    const summaryData: Record<string, any> = {
      current: Number(d.buckets?.current || 0),
      days_1_30: Number(d.buckets?.days_1_30 || 0),
      days_31_60: Number(d.buckets?.days_31_60 || 0),
      days_61_90: Number(d.buckets?.days_61_90 || 0),
      days_91_120: Number(d.buckets?.days_91_120 || 0),
      days_120_plus: Number(d.buckets?.days_120_plus || 0),
      total: Number(d.total || 0),
      record_count: Number(d.record_count || 0),
    };
    return { data: d.top_suppliers || [], isSummary: true, summaryData, meta: undefined };
  }

  /**
   * Transforms the customer-receivables dashboard response into a summary.
   */
  private adaptCustomerReceivables(raw: any): ReportAdaptedData {
    const d = raw?.data ?? raw;
    const summaryData: Record<string, any> = {
      pending_amount: Number(d.total_pending?.amount || 0),
      pending_count: Number(d.total_pending?.count || 0),
      overdue_amount: Number(d.total_overdue?.amount || 0),
      overdue_count: Number(d.total_overdue?.count || 0),
      due_soon_amount: Number(d.due_soon?.amount || 0),
      due_soon_count: Number(d.due_soon?.count || 0),
      collected_this_month: Number(d.collected_this_month || 0),
    };
    return { data: [], isSummary: true, summaryData, meta: undefined };
  }
}
