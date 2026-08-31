import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ProductTypeChipFilterComponent,
  ProductTypeFilterValue,
} from './product-type-chip-filter.component';

/**
 * QUI-729 (D.1) — chip tri-estado "Productos / Insumos / Todos".
 *
 * La emisión del `model()` se prueba a través de un HOST wrapper: un
 * `model()` expone el output `valueChange` en el template, no como propiedad
 * TS del componente (no hay `.change` accesible programáticamente en esta
 * versión de Angular). Sin host, `value.set()` del hijo no dispara ninguna
 * emisión observable.
 */
@Component({
  standalone: true,
  imports: [ProductTypeChipFilterComponent],
  template: `<app-product-type-chip-filter
    [value]="value()"
    (valueChange)="onChange($event)"
  />`,
})
class HostComponent {
  readonly value = signal<ProductTypeFilterValue>('products');
  received: ProductTypeFilterValue | undefined;

  onChange(v: ProductTypeFilterValue): void {
    this.received = v;
  }
}

describe('ProductTypeChipFilterComponent', () => {
  let host: HostComponent;
  let component: ProductTypeChipFilterComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    component = fixture.debugElement
      .query(By.css('app-product-type-chip-filter'))
      .componentInstance;
    fixture.detectChanges();
  });

  it('defaults a "products" (solo productos, sin insumos — ADR-6)', () => {
    expect(component.value()).toBe('products');
  });

  it('expone los tres estados en orden Productos / Insumos / Todos', () => {
    expect(component.options.map((o) => o.value)).toEqual([
      'products',
      'ingredients',
      'all',
    ]);
  });

  it('select() actualiza la selección y emite valueChange al host', () => {
    component.select('ingredients');

    expect(component.value()).toBe('ingredients');
    expect(host.received).toBe('ingredients');
  });

  it('la flecha derecha avanza al siguiente estado de forma cíclica', () => {
    component.value.set('products');
    component.onKeydown({ key: 'ArrowRight', preventDefault: () => {} } as any);
    expect(component.value()).toBe('ingredients');

    component.onKeydown({ key: 'ArrowRight', preventDefault: () => {} } as any);
    expect(component.value()).toBe('all');

    component.onKeydown({ key: 'ArrowRight', preventDefault: () => {} } as any);
    expect(component.value()).toBe('products');
  });

  it('la flecha izquierda retrocede de forma cíclica', () => {
    component.value.set('products');
    component.onKeydown({ key: 'ArrowLeft', preventDefault: () => {} } as any);
    expect(component.value()).toBe('all');
  });

  it('ignora teclas que no son flechas', () => {
    component.value.set('products');
    component.onKeydown({ key: 'Enter', preventDefault: () => {} } as any);
    expect(component.value()).toBe('products');
  });
});
