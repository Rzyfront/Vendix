import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { SupportDocumentListComponent } from './support-document-list.component';
import { SupportDocumentService } from '../../services/support-document.service';
import { SuppliersService } from '../../../inventory/services/suppliers.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';

describe('SupportDocumentListComponent — OC de origen, proveedor y colores (QUI-684)', () => {
  let service: { list: jasmine.Spy };

  const setup = (): SupportDocumentListComponent => {
    service = {
      list: jasmine.createSpy('list').and.returnValue(
        of({
          data: [
            {
              id: 1,
              invoice_number: 'DS1',
              invoice_type: 'support_document',
              status: 'accepted',
              total_amount: '1000',
              purchase_order: { id: 7, order_number: 'OC-0007' },
            },
          ],
          meta: { total: 1 },
        }),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: SupportDocumentService, useValue: service },
        {
          provide: SuppliersService,
          useValue: {
            getSuppliers: () => of({ success: true, data: [{ id: 42, name: 'Proveedor Uno' }] }),
          },
        },
        {
          provide: CurrencyFormatService,
          useValue: { format: (v: number) => `$${Math.round(v)}` },
        },
      ],
    });
    const fixture = TestBed.createComponent(SupportDocumentListComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  it('tiene la columna «OC de origen» y devuelve el número de la OC', () => {
    const list = setup();
    const column = list.columns.find((col) => col.key === 'purchase_order');

    expect(column?.label).toBe('OC de origen');
    expect(list.purchaseOrderNumber({ id: 7, order_number: 'OC-0007' })).toBe('OC-0007');
    expect(list.purchaseOrderNumber(null)).toBe('—');
  });

  it('el filtro de proveedor ofrece los proveedores y envía supplier_id', () => {
    const list = setup();
    const supplier = list.filterConfigs().find((filter) => filter.key === 'supplier_id');

    expect(supplier?.options?.map((option) => option.label)).toEqual([
      'Todos los proveedores',
      'Proveedor Uno',
    ]);

    list.onFilterChange({ status: null, invoice_type: 'support_document', supplier_id: '42' });

    expect(service.list.calls.mostRecent().args[0].supplier_id).toBe(42);

    list.onFilterChange({ status: null, invoice_type: 'support_document', supplier_id: '' });

    expect(service.list.calls.mostRecent().args[0].supplier_id).toBeUndefined();
  });

  it('cancelado es gris y anulado ámbar, como en la lista de facturas', () => {
    const list = setup();
    const statusColumn = list.columns.find((col) => col.key === 'status');
    const colors = statusColumn?.badgeConfig?.colorMap as Record<string, string>;

    expect(colors['cancelled']).toBe('var(--color-text-muted)');
    expect(colors['voided']).toBe('var(--color-warning)');
  });

  it('usa etiquetas masculinas de documento', () => {
    const list = setup();

    expect(list.getStatusLabel('validated')).toBe('Validado');
    expect(list.getStatusLabel('sent')).toBe('Enviado');
  });
});
