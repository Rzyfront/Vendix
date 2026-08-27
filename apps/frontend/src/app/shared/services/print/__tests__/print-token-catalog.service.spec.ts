import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { PrintTokenCatalogService } from '../print-token-catalog.service';
import { PrintGatewayClientService } from '../print-gateway-client.service';
import { StorePrintFormatDetail, PrintTokenDefinition } from '../../../../core/models/print-formats.model';

/**
 * [print-editor-dsk P3.2] — Minimal stub for the gateway client. We only need
 * `getFormatDetail()` to return the `available_tokens` payload the catalog
 * reads. Anything else throws to surface unexpected dependencies.
 */
class FakeGatewayClient {
  detailResponse: StorePrintFormatDetail | null = null;
  error: any = null;
  getFormatDetailCalls = 0;

  getFormatDetail(_formatType: string) {
    this.getFormatDetailCalls++;
    if (this.error) {
      return throwError(() => this.error);
    }
    return of(this.detailResponse);
  }
}

describe('PrintTokenCatalogService [print-editor-dsk P3.2]', () => {
  let service: PrintTokenCatalogService;
  let fakeClient: FakeGatewayClient;

  const detailWithTokens = (tokens: PrintTokenDefinition[]): StorePrintFormatDetail => ({
    format_type: 'pos_sale_ticket',
    name: 'POS Sale',
    category: 'pos',
    is_active: true,
    gateway_enabled: false,
    is_customized: false,
    template_id: null,
    template_name: null,
    definition: { paper: { format: 'thermal_80', width_mm: 80, is_roll: true, copies: 1 }, sections: [] },
    overrides: null,
    available_tokens: tokens,
  });

  beforeEach(() => {
    fakeClient = new FakeGatewayClient();
    TestBed.configureTestingModule({
      providers: [
        PrintTokenCatalogService,
        { provide: PrintGatewayClientService, useValue: fakeClient },
      ],
    });
    service = TestBed.inject(PrintTokenCatalogService);
  });

  it('load() populates groups from the API response', async () => {
    fakeClient.detailResponse = detailWithTokens([
      { token: 'store.name', path: 'store.name', description: 'Store name', example: 'Acme' },
      { token: 'customer.email', path: 'customer.email', description: 'Customer email', example: 'a@b.c' },
    ]);

    expect(service.groups().length).toBe(0);
    await service.load('pos_sale_ticket');

    const groups = service.groups();
    expect(groups.length).toBe(2);
    expect(fakeClient.getFormatDetailCalls).toBe(1);
    expect(service.lastFormatType()).toBe('pos_sale_ticket');
    expect(service.tokens().length).toBe(2);
  });

  it('groups tokens by the prefix of the token path (store.*, customer.*, items.*)', async () => {
    fakeClient.detailResponse = detailWithTokens([
      { token: 'store.name', path: 'store.name', description: '', example: '' },
      { token: 'store.nit', path: 'store.nit', description: '', example: '' },
      { token: 'customer.name', path: 'customer.name', description: '', example: '' },
      { token: 'customer.email', path: 'customer.email', description: '', example: '' },
      { token: 'items.0.name', path: 'items.0.name', description: '', example: '' },
      { token: 'items.1.qty', path: 'items.1.qty', description: '', example: '' },
    ]);

    await service.load('sales_order_invoice');

    const groups = service.groups();
    const byLabel = Object.fromEntries(groups.map((g) => [g.label, g]));
    expect(Object.keys(byLabel).sort()).toEqual(['Customer', 'Items', 'Store']);

    expect(byLabel['Store'].tokens.map((t) => t.token)).toEqual(['store.name', 'store.nit']);
    expect(byLabel['Customer'].tokens.map((t) => t.token)).toEqual(['customer.name', 'customer.email']);
    expect(byLabel['Items'].tokens.map((t) => t.token)).toEqual(['items.0.name', 'items.1.qty']);
    // Alphabetical ordering across groups keeps the UI stable.
    expect(groups.map((g) => g.label)).toEqual(['Customer', 'Items', 'Store']);
  });

  it('empty available_tokens yields zero groups (no synthetic placeholders)', async () => {
    fakeClient.detailResponse = detailWithTokens([]);
    await service.load('pos_sale_ticket');

    expect(service.groups().length).toBe(0);
    expect(service.tokens().length).toBe(0);
  });
});