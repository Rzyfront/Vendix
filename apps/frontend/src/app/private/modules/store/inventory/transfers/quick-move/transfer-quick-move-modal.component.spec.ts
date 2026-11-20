import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { TransferQuickMoveModalComponent } from './transfer-quick-move-modal.component';
import { TransferDraftHandoffService, TransferPickerRow } from './transfer-draft';

function row(over: Partial<TransferPickerRow> = {}): TransferPickerRow {
  return {
    id: 10,
    product_id: 10,
    product_variant_id: 1,
    name: 'Camisa',
    variant_name: 'Roja',
    sku: 'CAM-1-R',
    stock_at_origin: {
      quantity_on_hand: 8,
      quantity_reserved: 0,
      quantity_available: 8,
    },
    stock_at_destination: {
      quantity_on_hand: 2,
      quantity_reserved: 0,
      quantity_available: 2,
    },
    ...over,
  };
}

/**
 * Movimiento rápido (D1): un modal que mueve de verdad —multi-producto, con
 * variantes— y que solo deja el registro. La alternativa "masivo o avanzado"
 * navega con lo ya llenado (D9: solo bodegas propias).
 */
describe('TransferQuickMoveModalComponent — mover ahora', () => {
  let fixture: ComponentFixture<TransferQuickMoveModalComponent>;
  let component: TransferQuickMoveModalComponent;
  let handoff: TransferDraftHandoffService;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransferQuickMoveModalComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(TransferQuickMoveModalComponent);
    component = fixture.componentInstance;
    handoff = TestBed.inject(TransferDraftHandoffService);
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);

    fixture.componentRef.setInput('searchFn', () => of([]));
    fixture.componentRef.setInput('advancedRoute', '/admin/inventory/transfers/new');
    fixture.detectChanges();
  });

  function open(): void {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
  }

  it('agrega varias filas de una sentada, separando variantes del mismo producto', () => {
    open();
    component.onFromChange(1);
    component.onToChange(2);

    component.onAddRows([
      row({ product_variant_id: 1, variant_name: 'Roja' }),
      row({ product_variant_id: 2, variant_name: 'Azul', sku: 'CAM-1-A' }),
      row({ id: 11, product_id: 11, product_variant_id: null, name: 'Pantalón', sku: 'PAN-1' }),
    ]);
    fixture.detectChanges();

    expect(component.lines().length).toBe(3);
    expect(component.addedKeys()).toEqual(['10:1', '10:2', '11:base']);
    expect(component.units()).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('3 producto(s)');
    expect(fixture.nativeElement.textContent).toContain('Azul');
  });

  it('no duplica el mismo producto + variante al agregarlo dos veces', () => {
    open();
    component.onFromChange(1);
    component.onToChange(2);

    component.onAddRows([row({ product_variant_id: 1 })]);
    component.onAddRows([row({ product_variant_id: 1 }), row({ product_variant_id: 2 })]);

    expect(component.lines().map((l) => l.key)).toEqual(['10:1', '10:2']);
  });

  it('cambiar la bodega de origen invalida las líneas (el disponible es otro)', () => {
    open();
    component.onFromChange(1);
    component.onToChange(2);
    component.onAddRows([row()]);
    expect(component.lines().length).toBe(1);

    component.onFromChange(3);

    expect(component.lines()).toEqual([]);
    expect(component.toLocationId()).toBe(2);

    // Si el nuevo origen es la bodega de destino, el destino se suelta.
    component.onFromChange(2);
    expect(component.toLocationId()).toBeNull();
  });

  it('manda el payload con product_variant_id y la cantidad editada', () => {
    open();
    const emitted: any[] = [];
    component.quickMove.subscribe((payload) => emitted.push(payload));

    component.onFromChange(1);
    component.onToChange(2);
    component.onAddRows([row({ product_variant_id: 1 }), row({ product_variant_id: 2 })]);
    component.onQuantityChange(0, { target: { value: '3' } } as any);
    fixture.detectChanges();

    component.onSubmit();

    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual({
      from_location_id: 1,
      to_location_id: 2,
      items: [
        { product_id: 10, product_variant_id: 1, quantity: 3 },
        { product_id: 10, product_variant_id: 2, quantity: 1 },
      ],
    });
  });

  it('no deja mover si una cantidad excede el disponible y avisa en pantalla', () => {
    open();
    const emitted: any[] = [];
    component.quickMove.subscribe((payload) => emitted.push(payload));

    component.onFromChange(1);
    component.onToChange(2);
    component.onAddRows([row({ product_variant_id: 1 })]);
    component.onQuantityChange(0, { target: { value: '9' } } as any);
    fixture.detectChanges();

    expect(component.payload()).toBeNull();
    expect(component.invalidLine()).toContain('Solo hay 8');
    expect(fixture.nativeElement.textContent).toContain('Solo hay 8');

    component.onSubmit();
    expect(emitted).toEqual([]);
  });

  it('sin líneas no hay payload: no se puede mover nada', () => {
    open();
    component.onFromChange(1);
    component.onToChange(2);

    expect(component.payload()).toBeNull();
  });

  it('"Movimiento masivo o avanzado" navega llevando origen, destino, líneas y notas', () => {
    open();
    const openChanges: boolean[] = [];
    component.isOpenChange.subscribe((v) => openChanges.push(v));

    component.onFromChange(1);
    component.onToChange(2);
    component.notes.set('Para la sucursal norte');
    component.onAddRows([row({ product_variant_id: 2, variant_name: 'Azul' })]);

    component.onAdvancedToggle(true);

    expect(router.navigate).toHaveBeenCalledWith(['/admin/inventory/transfers/new']);
    expect(openChanges).toEqual([false]);
    const draft = handoff.consume();
    expect(draft?.from_location_id).toBe(1);
    expect(draft?.to_location_id).toBe(2);
    expect(draft?.notes).toBe('Para la sucursal norte');
    expect(draft?.lines.map((l) => l.key)).toEqual(['10:2']);
  });

  it('desmarcar la casilla no navega', () => {
    open();
    component.onAdvancedToggle(false);

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('al cerrar y reabrir, el modal arranca limpio', () => {
    open();
    component.onFromChange(1);
    component.onToChange(2);
    component.onAddRows([row()]);
    component.onCancel();

    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    open();

    expect(component.lines()).toEqual([]);
    expect(component.fromLocationId()).toBeNull();
    expect(component.toLocationId()).toBeNull();
  });

  it('ofrece el flujo detallado sin perderlo: emite useDetailedFlow', () => {
    open();
    let called = 0;
    component.useDetailedFlow.subscribe(() => called++);

    const button = fixture.nativeElement.querySelector(
      '[data-testid="quick-use-detailed"]',
    ) as HTMLButtonElement;
    button.click();

    expect(called).toBe(1);
  });
});
