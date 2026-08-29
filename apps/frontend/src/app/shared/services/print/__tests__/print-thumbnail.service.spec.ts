import { TestBed } from '@angular/core/testing';

import {
  PrintThumbnailService,
  PRINT_FORMAT_CATEGORY_MAP,
  resolveCategory,
} from '../print-thumbnail.service';

describe('PrintThumbnailService [print-editor-dsk P6]', () => {
  let service: PrintThumbnailService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PrintThumbnailService);
  });

  it('is provided in root and instantiates without DI deps', () => {
    expect(service).toBeTruthy();
  });

  it('returns an SVG dataURL for known formats', () => {
    const url = service.getThumbnail('pos_sale_ticket');
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('returns an SVG dataURL even for unknown formats (falls back to Logística color)', () => {
    const url = service.getThumbnail('unknown_format_xyz');
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('caches thumbnails so the second call returns the same dataURL', () => {
    const first = service.getThumbnail('dispatch_note');
    const second = service.getThumbnail('dispatch_note');
    expect(first).toBe(second);
  });

  it('invalidate() forces the next call to rebuild', () => {
    const first = service.getThumbnail('dispatch_note');
    service.invalidate('dispatch_note');
    const second = service.getThumbnail('dispatch_note');
    expect(second).toBe(first); // same content, but rebuilt
  });

  it('clear() empties the cache', () => {
    service.getThumbnail('pos_sale_ticket');
    service.clear();
    const first = service.getThumbnail('pos_sale_ticket');
    expect(first.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('escapes XML-special characters in the format name', () => {
    // Even though real format_types are snake_case, ensure the renderer
    // doesn't blow up on a format name with < or & characters.
    const url = service.getThumbnail('malicious<&>name');
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('resolveCategory() maps known formats to their canonical category', () => {
    expect(resolveCategory('pos_sale_ticket')).toBe('Ventas POS');
    expect(resolveCategory('sales_order_invoice')).toBe('Ventas');
    expect(resolveCategory('dispatch_note')).toBe('Logística');
    expect(resolveCategory('dispatch_ticket')).toBe('Logística');
    expect(resolveCategory('quotation')).toBe('Comercial');
    expect(resolveCategory('credit_note')).toBe('Ventas');
    expect(resolveCategory('purchase_order')).toBe('Compras');
    expect(resolveCategory('transfer_note')).toBe('Inventario');
    expect(resolveCategory('fiscal_electronic_invoice')).toBe('Facturación');
    expect(resolveCategory('fiscal_credit_note')).toBe('Facturación');
    expect(resolveCategory('kitchen_ticket')).toBe('Restaurante');
  });

  it('resolveCategory() falls back to Logística for unknown formats', () => {
    expect(resolveCategory('unknown_thing')).toBe('Logística');
  });

  it('PRINT_FORMAT_CATEGORY_MAP covers all 11 format_types', () => {
    const expected = [
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
    for (const fmt of expected) {
      expect(PRINT_FORMAT_CATEGORY_MAP[fmt]).toBeTruthy();
    }
  });
});
