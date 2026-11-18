import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { PurchaseOrderSupportDocumentCardComponent } from './purchase-order-support-document-card.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import type { PoSupportDocument } from '../../../../invoicing/interfaces/support-document.interface';

describe('PurchaseOrderSupportDocumentCardComponent (QUI-684)', () => {
  let fixture: ComponentFixture<PurchaseOrderSupportDocumentCardComponent>;
  const navigate = jasmine.createSpy('navigate').and.resolveTo(true);

  const doc = (overrides: Partial<PoSupportDocument> = {}): PoSupportDocument => ({
    id: 77,
    invoice_type: 'support_document',
    invoice_number: 'DS-0077',
    cufe: 'abcdef0123456789abcdef0123456789abcdef0123',
    status: 'accepted',
    dian_status: 'accepted',
    transmission_status: 'sent_ok',
    issue_date: '2026-11-17T00:00:00.000Z',
    total_amount: 119000,
    accepted_at: '2026-11-17T10:00:00.000Z',
    ...overrides,
  });

  const render = (documents: PoSupportDocument[]) => {
    fixture.componentRef.setInput('documents', documents);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => {
    navigate.calls.reset();
    TestBed.configureTestingModule({
      imports: [PurchaseOrderSupportDocumentCardComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: { navigate } },
        {
          provide: CurrencyFormatService,
          useValue: {
            loadCurrency: () => undefined,
            format: (v: number) => `$${v}`,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(PurchaseOrderSupportDocumentCardComponent);
  });

  it('shows the empty state when the order has no support document', () => {
    const el = render([]);
    expect(el.textContent).toContain('Esta orden aún no tiene documento soporte.');
    expect(el.querySelector('[data-testid="po-support-doc"]')).toBeNull();
  });

  it('renders number, shortened CUDS (full value in the title) and DIAN status', () => {
    const el = render([doc()]);
    expect(el.textContent).toContain('DS-0077');
    expect(el.textContent).toContain('Aceptado');
    expect(el.textContent).toContain('DIAN: aceptado');
    const cuds = el.querySelector('[data-testid="po-support-cuds"]') as HTMLElement;
    expect(cuds.getAttribute('title')).toBe('abcdef0123456789abcdef0123456789abcdef0123');
    expect(cuds.textContent).toContain('…');
  });

  it('navigates to the support documents page with ?document=<id>', () => {
    const el = render([doc()]);
    const button = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ver detalle'),
    ) as HTMLButtonElement;
    button.click();
    expect(navigate).toHaveBeenCalledWith(['/admin/invoicing/support-documents'], {
      queryParams: { document: 77 },
    });
  });
});
