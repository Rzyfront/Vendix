import { TestBed } from '@angular/core/testing';

import { ResolutionsInUseCardComponent } from './resolutions-in-use-card.component';
import type { ResolutionInUse, ResolutionsInUseResponse } from '../resolutions-in-use.util';

const item = (over: Partial<ResolutionInUse>): ResolutionInUse => ({
  document_type: 'sales_invoice',
  source: 'resolution',
  resolution_id: 1,
  prefix: 'FE',
  resolution_number: '123',
  next_number: 'FE1001',
  valid_to: '2030-01-01T00:00:00.000Z',
  is_internal_series: false,
  active_count: 1,
  single_active_enforced: false,
  ...over,
});

function render(items: ResolutionInUse[]): string {
  TestBed.configureTestingModule({ imports: [ResolutionsInUseCardComponent] });
  const fixture = TestBed.createComponent(ResolutionsInUseCardComponent);
  const data: ResolutionsInUseResponse = { accounting_entity_id: 1, items };
  fixture.componentRef.setInput('data', data);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('ResolutionsInUseCardComponent', () => {
  it('no repite el prefijo en el siguiente numero', () => {
    const text = render([
      item({}),
      item({
        document_type: 'credit_note',
        source: 'internal_series_projected',
        resolution_id: null,
        prefix: 'NCVS',
        next_number: 'NCVS1',
        is_internal_series: true,
        active_count: 0,
      }),
    ]);
    expect(text).toContain('Siguiente: FE1001');
    expect(text).toContain('Siguiente: NCVS1');
    expect(text).not.toContain('FEFE');
    expect(text).not.toContain('NCVSNCVS');
  });

  it('serie interna inactiva dice que se reactivara', () => {
    const text = render([
      item({
        document_type: 'credit_note',
        prefix: 'NCVS',
        next_number: 'NCVS4',
        is_internal_series: true,
        active_count: 0,
      }),
    ]);
    expect(text).toContain('se reactivará en la próxima nota');
  });
});
