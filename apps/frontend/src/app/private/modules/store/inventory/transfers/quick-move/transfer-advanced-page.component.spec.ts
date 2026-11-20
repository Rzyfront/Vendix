import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { TransferAdvancedPageComponent } from './transfer-advanced-page.component';
import {
  TransferDraftHandoffService,
  TransferPickerRow,
} from './transfer-draft';
import {
  TRANSFER_ADVANCED_API,
  TransferAdvancedApi,
} from '../advanced/transfer-advanced-api';
import { EMPTY_ADVANCED_OPTIONS } from '../advanced/transfer-advanced';

function row(over: Partial<TransferPickerRow> = {}): TransferPickerRow {
  return {
    id: 10,
    product_id: 10,
    product_variant_id: null,
    name: 'Café',
    variant_name: null,
    sku: 'CAF-500',
    stock_at_origin: {
      quantity_on_hand: 5,
      quantity_reserved: 0,
      quantity_available: 5,
    },
    stock_at_destination: {
      quantity_on_hand: 0,
      quantity_reserved: 0,
      quantity_available: 0,
    },
    ...over,
  };
}

/**
 * Vista avanzada (P3): modo con/sin remisiones, destino externo con alerta,
 * lote por defecto, escáner, pegar lista, borrador local y envío a aprobación.
 */
describe('TransferAdvancedPageComponent — orden avanzada', () => {
  let fixture: ComponentFixture<TransferAdvancedPageComponent>;
  let component: TransferAdvancedPageComponent;
  let api: jasmine.SpyObj<TransferAdvancedApi>;
  let router: Router;

  function setup(): void {
    fixture = TestBed.createComponent(TransferAdvancedPageComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    if (!jasmine.isSpy(router.navigate)) {
      spyOn(router, 'navigate').and.resolveTo(true);
    }
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.removeItem('test.advanced-draft');
    api = jasmine.createSpyObj<TransferAdvancedApi>(
      'TransferAdvancedApi',
      [
        'getLocations',
        'searchProducts',
        'getOptions',
        'getBatches',
        'getLocationStock',
        'create',
      ],
      {
        surface: 'store',
        listRoute: '/admin/inventory/transfers',
        draftStorageKey: 'test.advanced-draft',
      },
    );
    api.getLocations.and.returnValue(
      of([
        { value: 1, label: 'Bodega principal' },
        { value: 2, label: 'Punto norte' },
      ]),
    );
    api.getOptions.and.returnValue(of(EMPTY_ADVANCED_OPTIONS));
    api.getBatches.and.returnValue(
      of([
        {
          id: 70,
          product_id: 10,
          product_variant_id: null,
          batch_number: 'L-VIEJO',
          expiration_date: '2026-12-01',
          available: 3,
        },
        {
          id: 71,
          product_id: 10,
          product_variant_id: null,
          batch_number: 'L-NUEVO',
          expiration_date: '2027-01-01',
          available: 8,
        },
      ]),
    );
    api.searchProducts.and.returnValue(of([row()]));
    api.getLocationStock.and.returnValue(
      of([row(), row({ id: 11, product_id: 11, sku: 'AZU', name: 'Azúcar' })]),
    );
    api.create.and.returnValue(of({ id: 99, transfer_number: 'TRF-0099' }));

    await TestBed.configureTestingModule({
      imports: [TransferAdvancedPageComponent],
      providers: [
        provideRouter([]),
        { provide: TRANSFER_ADVANCED_API, useValue: api },
      ],
    }).compileComponents();
  });

  afterEach(() => localStorage.removeItem('test.advanced-draft'));

  it('hereda lo llenado en el modal rápido y asigna el lote más antiguo', () => {
    TestBed.inject(TransferDraftHandoffService).set({
      from_location_id: 1,
      to_location_id: 2,
      notes: 'Para la feria',
      lines: [
        {
          key: '10:base',
          product_id: 10,
          product_variant_id: null,
          product_name: 'Café',
          variant_name: null,
          sku: 'CAF-500',
          available_at_origin: 5,
          available_at_destination: 0,
          quantity: 2,
        },
      ],
    });
    setup();

    expect(component.form().notes).toBe('Para la feria');
    expect(api.getOptions).toHaveBeenCalledWith(1);
    expect(api.getBatches).toHaveBeenCalledWith(1, [10]);
    expect(component.lines()[0].batch_id).toBe(70);
  });

  it('destino externo fuerza remisiones y avisa la alerta sin soporte', () => {
    setup();
    component.onFromChange(1);
    component.setExternal(true);
    component.setMode('mass_only');
    fixture.detectChanges();

    expect(component.mode()).toBe('with_dispatch_notes');
    const el: HTMLElement = fixture.nativeElement;
    expect(
      el.querySelector('[data-testid="external-alert-warning"]'),
    ).not.toBeNull();

    component.patchExternal({ exit_reason: 'Muestra comercial' });
    fixture.detectChanges();
    expect(
      el.querySelector('[data-testid="external-alert-warning"]'),
    ).toBeNull();
  });

  it('el escáner suma 1 por lectura', () => {
    setup();
    component.onFromChange(1);
    component.onToChange(2);
    component.scanCode.set('caf-500');
    component.onScan();
    component.scanCode.set('CAF-500');
    component.onScan();

    expect(component.lines().length).toBe(1);
    expect(component.lines()[0].quantity).toBe(2);
    expect(component.scanMessage()?.kind).toBe('ok');
  });

  it('pegar lista agrega las válidas y reporta las inválidas', () => {
    api.searchProducts.and.callFake((term: string) =>
      of(term.toUpperCase() === 'CAF-500' ? [row()] : []),
    );
    setup();
    component.onFromChange(1);
    component.onToChange(2);
    component.pasteText.set('CAF-500;3\nNOEXISTE;1\nPAN;cero');
    component.processPaste();

    expect(component.lines()[0].quantity).toBe(3);
    const report = component.pasteReport()!;
    expect(report.added).toBe(1);
    expect(report.invalid.map((i) => i.line)).toEqual([2, 3]);
    expect(report.invalid[0].reason).toContain('no encontrado');
  });

  it('agrega todo el stock de la bodega con su disponible', () => {
    setup();
    component.onFromChange(1);
    component.onToChange(2);
    component.stockCategoryId.set(4);
    component.addAllStock();

    expect(api.getLocationStock).toHaveBeenCalledWith(1, 2, 4);
    expect(component.lines().map((l) => l.quantity)).toEqual([5, 5]);
  });

  it('no envía si faltan datos y muestra los errores', () => {
    setup();
    component.submit();
    fixture.detectChanges();
    expect(api.create).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="advanced-errors"]',
      )?.textContent,
    ).toContain('Elige la bodega de origen');
  });

  it('envía a aprobación con modo y lote, limpia el borrador y vuelve a la lista', () => {
    setup();
    component.onFromChange(1);
    component.onToChange(2);
    component.onAddRows([row()]);
    component.setMode('mass_only');
    component.saveDraft();
    expect(localStorage.getItem('test.advanced-draft')).not.toBeNull();

    component.submit();

    expect(api.create).toHaveBeenCalledWith(
      jasmine.objectContaining({
        from_location_id: 1,
        to_location_id: 2,
        movement_mode: 'mass_only',
        items: [{ product_id: 10, batch_id: 70, quantity: 1 }],
      }),
    );
    expect(localStorage.getItem('test.advanced-draft')).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith([
      '/admin/inventory/transfers',
    ]);
  });

  it('ofrece retomar un borrador guardado', () => {
    setup();
    component.onFromChange(1);
    component.onToChange(2);
    component.onAddRows([row()]);
    component.saveDraft();

    // Nueva visita a la vista.
    fixture.destroy();
    setup();
    expect(component.savedDraft()).not.toBeNull();
    component.resumeDraft();
    expect(component.form().from_location_id).toBe(1);
    expect(component.lines().length).toBe(1);
  });
});
