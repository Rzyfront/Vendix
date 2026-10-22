import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { NEVER } from 'rxjs';
import { Router } from '@angular/router';

import { FiscalFlowDashboardComponent } from './fiscal-flow-dashboard.component';
import { FiscalOperationsService } from '../services/fiscal-operations.service';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';

describe('FiscalFlowDashboardComponent.checklistRoute', () => {
  let router: Router;

  function create(scope: 'store' | 'organization' | 'platform') {
    const fixture = TestBed.createComponent(FiscalFlowDashboardComponent);
    fixture.componentRef.setInput('scope', scope);
    return fixture.componentInstance;
  }

  const item = (link_hint: string) => ({
    key: 'k',
    label: 'l',
    complete: false,
    detail: '',
    link_hint,
  });

  beforeEach(() => {
    const serviceStub = new Proxy({}, { get: () => () => NEVER });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: FiscalOperationsService, useValue: serviceStub },
        {
          provide: CurrencyFormatService,
          useValue: { loadCurrency: () => undefined },
        },
      ],
    });
    TestBed.overrideComponent(FiscalFlowDashboardComponent, {
      set: { template: '', imports: [] },
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => TestBed.resetTestingModule());

  for (const scope of ['store', 'organization'] as const) {
    it(`fiscal/dian apunta al asistente de activación en scope ${scope}`, () => {
      expect(create(scope).checklistRoute(item('fiscal/dian'))).toBe(
        '/admin/invoicing/activation',
      );
    });
  }

  it('fiscal/dian conserva la ruta de plataforma en scope platform', () => {
    expect(create('platform').checklistRoute(item('fiscal/dian'))).toBe(
      '/super-admin/fiscal/invoicing/dian-config',
    );
  });

  it('goToChecklistItem navega con navigateByUrl a esa ruta', () => {
    const nav = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    create('store').goToChecklistItem(item('fiscal/dian'));
    expect(nav).toHaveBeenCalledWith('/admin/invoicing/activation');
  });

  it('goToChecklistItem no navega si el hint no tiene destino', () => {
    const nav = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    create('store').goToChecklistItem(item('desconocido'));
    expect(nav).not.toHaveBeenCalled();
  });
});
