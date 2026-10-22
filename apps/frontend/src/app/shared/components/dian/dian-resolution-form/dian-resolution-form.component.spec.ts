import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { DianResolutionFormComponent, DianResolutionFormValue } from './dian-resolution-form.component';
import { CurrencyFormatService } from '../../../pipes/currency/currency.pipe';
import type { FiscalReadinessResolution } from '../fiscal-readiness.interface';

describe('DianResolutionFormComponent submit (serie interna)', () => {
  function mount(resolution: FiscalReadinessResolution | null) {
    TestBed.configureTestingModule({
      imports: [DianResolutionFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CurrencyFormatService, useValue: {} },
      ],
    });
    const fixture = TestBed.createComponent(DianResolutionFormComponent);
    fixture.componentRef.setInput('configurationType', 'invoicing');
    fixture.componentRef.setInput('resolution', resolution);
    if (!resolution) fixture.componentRef.setInput('documentType', 'credit_note');
    fixture.detectChanges();
    const emitted: DianResolutionFormValue[] = [];
    fixture.componentInstance.save.subscribe((v) => emitted.push(v));
    return { fixture, emitted };
  }

  it('en edicion de una serie interna usada conserva resolution_number cargado', () => {
    const { fixture, emitted } = mount({
      id: 5,
      document_type: 'credit_note',
      prefix: 'NC',
      range_from: 1,
      range_to: 1000,
      current_number: 5,
      valid_from: '2025-01-01T00:00:00.000Z',
      valid_to: '2125-01-01T00:00:00.000Z',
      is_active: true,
      technical_key_set: false,
      resolution_number: 'INTERNA-NC',
      resolution_date: '2025-01-01T00:00:00.000Z',
    });
    fixture.componentInstance.form.controls.range_to.setValue(2000);
    fixture.componentInstance.submit();
    expect(emitted.length).toBe(1);
    expect(emitted[0].resolution_number).toBe('INTERNA-NC');
  });

  it('en alta de serie interna envia resolution_number vacio', () => {
    const { fixture, emitted } = mount(null);
    fixture.componentInstance.form.controls.resolution_date.setValue('2026-01-01');
    fixture.detectChanges();
    fixture.componentInstance.submit();
    expect(emitted.length).toBe(1);
    expect(emitted[0].resolution_number).toBe('');
  });
});
