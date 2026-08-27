/**
 * [print-editor-dsk P7] — Unit tests for `FormatAdapterRegistryService`.
 *
 * The contract this file pins:
 *   1. `get('pos_sale_ticket')` returns the POS adapter (matches
 *      `POS_SALE_TICKET_ADAPTER` exactly by reference, frozen).
 *   2. `byCategory('Logística')` returns exactly [dispatch_note,
 *      dispatch_ticket] in declaration order (the dispatch_ticket
 *      adapter was added by CP-DTLP-20260827 and stays under Logística).
 *   3. `availableRegions('fiscal_electronic_invoice')` includes
 *      `fiscal-block` AND `qr-block`.
 *   4. `has()` distinguishes known vs unknown format types.
 *
 * No mocking: the service holds no external dependencies, so we wire it
 * directly with `new FormatAdapterRegistryService()`.
 */

import { FormatAdapterRegistryService } from '../format-adapter-registry.service';
import { POS_SALE_TICKET_ADAPTER } from '../../lib/adapters';

describe('FormatAdapterRegistryService (P7 — DI lookup over the 11 adapters)', () => {
  const registry = new FormatAdapterRegistryService();

  it('1. get("pos_sale_ticket") returns the POS adapter', () => {
    const adapter = registry.get('pos_sale_ticket');
    expect(adapter).toBeDefined();
    expect(adapter).toBe(POS_SALE_TICKET_ADAPTER);
    expect(adapter?.label).toBe('Ticket de Venta POS');
    expect(adapter?.defaultPaper).toBe('thermal_80');
  });

  it('2. byCategory("Logística") returns [dispatch_note, dispatch_ticket] in declaration order', () => {
    const logistics = registry.byCategory('Logística');
    expect(logistics).toHaveLength(2);
    expect(logistics.map((a) => a.formatType)).toEqual([
      'dispatch_note',
      'dispatch_ticket',
    ]);
  });

  it('3. availableRegions("fiscal_electronic_invoice") includes fiscal-block and qr-block', () => {
    const regions = registry.availableRegions('fiscal_electronic_invoice');
    expect(regions).toContain('fiscal-block');
    expect(regions).toContain('qr-block');
  });

  it('4a. has() returns true for every known enum value', () => {
    const known = [
      'pos_sale_ticket',
      'sales_order_invoice',
      'dispatch_note',
      'dispatch_ticket',
      'quotation',
      'credit_note',
      'purchase_order',
      'transfer_note',
      'fiscal_electronic_invoice',
      'fiscal_credit_note',
      'kitchen_ticket',
    ];
    for (const format of known) {
      expect(registry.has(format)).toBe(true);
    }
  });

  it('4b. has() returns false for an unknown format type', () => {
    expect(registry.has('not_a_real_format')).toBe(false);
  });

  it('4c. get() returns undefined for an unknown format type (does NOT throw)', () => {
    expect(registry.get('not_a_real_format')).toBeUndefined();
  });

  it('5. list() returns 11 entries and a fresh array (mutating it does not affect the registry)', () => {
    const before = registry.list();
    expect(before).toHaveLength(11);

    // Caller mutates the returned array — registry must remain pristine.
    (before as unknown as { length: number }).length = 0;
    expect(registry.list()).toHaveLength(11);
  });

  it('6. defaultPaper("pos_sale_ticket") === "thermal_80" (and falls back for unknowns)', () => {
    expect(registry.defaultPaper('pos_sale_ticket')).toBe('thermal_80');
    expect(registry.defaultPaper('not_a_real_format')).toBe('letter');
  });
});
