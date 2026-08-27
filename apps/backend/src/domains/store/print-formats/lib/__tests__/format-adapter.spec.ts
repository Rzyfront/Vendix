/**
 * [print-editor-dsk P7] — Unit tests for the FormatAdapter shape and
 * its 11 known adapter records.
 *
 * The contract this file pins:
 *   1. Exactly 11 adapters exist (matches the print_format_type_enum
 *      shape; adding a new enum value requires adding an adapter here).
 *   2. `defaultPaperFor(formatType)` returns the matching `defaultPaper`
 *      field on the same adapter record — so the registry and the bare
 *      helper stay in lockstep.
 *   3. Non-fiscal adapters don't expose `fiscal-block` or `qr-block`.
 *   4. The fiscal adapters do expose both, AND carry the three required
 *      fields the renderer checks before emitting.
 */

import { PRINT_FORMAT_TYPES } from '../../enums/print-format.enum';
import { ALL_ADAPTERS } from '../adapters';
import { defaultPaperFor } from '../default-paper';

describe('FormatAdapter (P7 — adapter contract)', () => {
  it('1. exposes exactly 11 adapter records (one per print_format_type_enum value)', () => {
    expect(ALL_ADAPTERS).toHaveLength(11);
    // Sanity: every enum value should be accounted for, and only for
    // those enum values. The registry's Map size matches by construction.
    const adapterFormatTypes = new Set(
      ALL_ADAPTERS.map((a) => a.formatType),
    );
    expect(adapterFormatTypes.size).toBe(11);
    for (const t of PRINT_FORMAT_TYPES) {
      expect(adapterFormatTypes.has(t)).toBe(true);
    }
  });

  it('2a. defaultPaperFor(pos_sale_ticket) === thermal_80', () => {
    expect(defaultPaperFor('pos_sale_ticket')).toBe('thermal_80');
  });

  it('2b. defaultPaperFor(kitchen_ticket) === thermal_80 (and matches adapter.defaultPaper)', () => {
    expect(defaultPaperFor('kitchen_ticket')).toBe('thermal_80');
    const adapter = ALL_ADAPTERS.find((a) => a.formatType === 'kitchen_ticket');
    expect(adapter?.defaultPaper).toBe('thermal_80');
  });

  it('2c. letter formats return "letter" from defaultPaperFor', () => {
    const letterFormats = [
      'sales_order_invoice',
      'quotation',
      'credit_note',
      'purchase_order',
      'transfer_note',
      'fiscal_electronic_invoice',
      'fiscal_credit_note',
    ];
    for (const format of letterFormats) {
      expect(defaultPaperFor(format as any)).toBe('letter');
    }
  });

  it('2d. dispatch_note defaults to a4', () => {
    expect(defaultPaperFor('dispatch_note')).toBe('a4');
  });

  it('3. non-fiscal adapters exclude fiscal-block and qr-block from availableRegions', () => {
    const nonFiscal = ALL_ADAPTERS.filter((a) => !a.fiscal);
    expect(nonFiscal.length).toBeGreaterThan(0);

    for (const adapter of nonFiscal) {
      expect(adapter.availableRegions).not.toContain('fiscal-block');
      expect(adapter.availableRegions).not.toContain('qr-block');
      expect(adapter.requiredFields).toEqual([]);
    }
  });

  it('4. fiscal adapters include fiscal-block, qr-block and the three required fields', () => {
    const fiscal = ALL_ADAPTERS.filter((a) => a.fiscal);
    expect(fiscal).toHaveLength(2);

    for (const adapter of fiscal) {
      expect(adapter.availableRegions).toContain('fiscal-block');
      expect(adapter.availableRegions).toContain('qr-block');
      expect(adapter.requiredFields).toContain('fiscal.cufe');
      expect(adapter.requiredFields).toContain('fiscal.qr_code_png_base64');
      expect(adapter.requiredFields).toContain('store.tax_id');
    }
  });
});
