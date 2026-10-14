import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MovementDetailModalComponent } from './movement-detail-modal.component';
import {
  InventoryMovement,
  MovementType,
} from '../../interfaces/inventory.interface';

const movement = (
  movement_type: MovementType,
  from_location_id?: number,
  to_location_id?: number,
): InventoryMovement => ({
  id: 1,
  organization_id: 1,
  product_id: 10,
  from_location_id,
  to_location_id,
  movement_type,
  quantity: 20,
});

describe('MovementDetailModalComponent isInbound (QUI-441)', () => {
  let fixture: ComponentFixture<MovementDetailModalComponent>;
  let component: MovementDetailModalComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MovementDetailModalComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(MovementDetailModalComponent);
    component = fixture.componentInstance;
  });

  const setMovement = (value: InventoryMovement | null): void => {
    fixture.componentRef.setInput('movement', value);
  };

  it('crea el componente', () => {
    expect(component).toBeTruthy();
  });

  it('QUI-441: ajuste positivo (solo pata de destino) es entrada', () => {
    setMovement(movement('adjustment', undefined, 5));

    expect(component.isInbound()).toBeTrue();
  });

  it('ajuste negativo (solo pata de origen) es salida', () => {
    setMovement(movement('adjustment', 5, undefined));

    expect(component.isInbound()).toBeFalse();
  });

  it('stock_in y return con pata de destino son entrada', () => {
    setMovement(movement('stock_in', undefined, 5));
    expect(component.isInbound()).toBeTrue();

    setMovement(movement('return', undefined, 5));
    expect(component.isInbound()).toBeTrue();
  });

  it('salida nueva (solo pata de origen) es salida', () => {
    setMovement(movement('stock_out', 5, undefined));

    expect(component.isInbound()).toBeFalse();
  });

  it('traslado (las dos patas) se muestra como entrada', () => {
    setMovement(movement('transfer', 5, 7));

    expect(component.isInbound()).toBeTrue();
  });

  it('filas históricas con solo destino se desempatan por tipo', () => {
    // Históricas: to_location_id relleno en los dos sentidos.
    setMovement(movement('stock_out', undefined, 5));
    expect(component.isInbound()).toBeFalse();

    setMovement(movement('sale', undefined, 5));
    expect(component.isInbound()).toBeFalse();

    setMovement(movement('damage', undefined, 5));
    expect(component.isInbound()).toBeFalse();

    setMovement(movement('adjustment', undefined, 5));
    expect(component.isInbound()).toBeTrue();
  });

  it('sin movimiento no es entrada', () => {
    setMovement(null);

    expect(component.isInbound()).toBeFalse();
  });

  it('QUI-441: el detalle pinta "+20" en un ajuste positivo', () => {
    setMovement(movement('adjustment', undefined, 5));
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('+20');
  });

  it('el detalle pinta "-20" en un ajuste negativo', () => {
    setMovement(movement('adjustment', 5, undefined));
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('-20');
  });
});
