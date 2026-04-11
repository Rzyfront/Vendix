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
}
