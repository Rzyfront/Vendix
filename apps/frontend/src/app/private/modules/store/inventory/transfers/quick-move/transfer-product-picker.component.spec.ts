import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { TransferProductPickerComponent } from './transfer-product-picker.component';
import { TransferPickerRow } from './transfer-draft';

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
 * El buscador que hace posible la orden multi-producto: tras "Agregar
 * seleccionados" el término y los resultados SIGUEN ahí (antes se limpiaban y
 * el comerciante tenía que volver a teclear para cada ítem), la selección es
 * múltiple y cada variante es una fila propia.
 */
describe('TransferProductPickerComponent', () => {
  let fixture: ComponentFixture<TransferProductPickerComponent>;
  let component: TransferProductPickerComponent;

  const rows = [
    row({ product_variant_id: 1, variant_name: 'Roja' }),
    row({ product_variant_id: 2, variant_name: 'Azul', sku: 'CAM-1-A' }),
    row({
      id: 11,
      product_id: 11,
      product_variant_id: null,
      name: 'Pantalón',
      variant_name: null,
      sku: 'PAN-1',
    }),
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransferProductPickerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TransferProductPickerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('fromLocationId', 1);
    fixture.componentRef.setInput('toLocationId', 2);
    fixture.componentRef.setInput('searchFn', () => of(rows));
    fixture.detectChanges();
  });

  it('sin origen y destino no busca', () => {
    expect(component.ready()).toBeTrue();

    fixture.componentRef.setInput('toLocationId', null);
    fixture.detectChanges();

    expect(component.ready()).toBeFalse();
  });

  it('la búsqueda sigue abierta después de agregar seleccionados', () => {
    const added: TransferPickerRow[][] = [];
    component.add.subscribe((r) => added.push(r));

    component.onSearch('cam');
    fixture.detectChanges();
    expect(component.results().length).toBe(3);

    component.toggle('10:1', true);
    component.toggle('10:2', true);
    expect(component.selectedCount()).toBe(2);

    component.addSelected();
    fixture.detectChanges();

    expect(added.length).toBe(1);
    expect(added[0].map((r) => r.product_variant_id ?? 'base')).toEqual([1, 2]);

    // Lo que NO se limpia: término y resultados. Solo la selección.
    expect(component.term()).toBe('cam');
    expect(component.results().length).toBe(3);
    expect(component.selectedCount()).toBe(0);
  });

  it('marca como ya agregadas las filas que la orden ya tiene y no las deja re-seleccionar', () => {
    fixture.componentRef.setInput('addedKeys', ['10:1']);
    fixture.detectChanges();

    component.onSearch('cam');
    fixture.detectChanges();

    expect(component.isAdded('10:1')).toBeTrue();
    expect(component.selectableRows().map((r) => r.product_variant_id ?? 'base')).toEqual([
      2,
      'base',
    ]);

    component.toggleAll(true);
    expect(component.selectedCount()).toBe(2);
  });

  it('no ofrece filas sin disponible en origen', () => {
    fixture.componentRef.setInput('searchFn', () =>
      of([
        row({
          product_variant_id: 9,
          stock_at_origin: {
            quantity_on_hand: 0,
            quantity_reserved: 0,
            quantity_available: 0,
          },
        }),
      ]),
    );
    fixture.detectChanges();

    component.onSearch('cam');
    fixture.detectChanges();

    expect(component.selectableRows()).toEqual([]);
    component.toggleAll(true);
    expect(component.selectedCount()).toBe(0);
  });

  it('en una salida externa busca solo con el origen y oculta el destino', () => {
    const calls: Array<[string, number, number]> = [];
    fixture.componentRef.setInput('searchFn', (t: string, f: number, to: number) => {
      calls.push([t, f, to]);
      return of(rows);
    });
    fixture.componentRef.setInput('toLocationId', null);
    fixture.componentRef.setInput('requireDestination', false);
    fixture.detectChanges();

    expect(component.ready()).toBeTrue();
    component.onSearch('cam');
    fixture.detectChanges();

    expect(calls).toEqual([['cam', 1, 1]]);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Destino:');
  });

  it('un error de búsqueda se muestra y no deja resultados viejos', () => {
    fixture.componentRef.setInput('searchFn', () =>
      throwError(() => new Error('boom')),
    );
    fixture.detectChanges();

    component.onSearch('cam');
    fixture.detectChanges();

    expect(component.searching()).toBeFalse();
    expect(component.results()).toEqual([]);
    expect(component.error()).toContain('No se pudo buscar');
  });
});
