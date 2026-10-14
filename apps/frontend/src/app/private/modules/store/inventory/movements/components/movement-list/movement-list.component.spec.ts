import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InventoryMovement, MovementType } from '../../../interfaces';
import { MovementListComponent } from './movement-list.component';

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

describe('MovementListComponent movement direction display', () => {
  let fixture: ComponentFixture<MovementListComponent>;
  let component: MovementListComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MovementListComponent],
    })
      .overrideComponent(MovementListComponent, { set: { template: '' } })
      .compileComponents();

    fixture = TestBed.createComponent(MovementListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('movements', []);
    fixture.detectChanges();
  });

  it('formats positive adjustments as inbound and negative adjustments as outbound', () => {
    expect(
      component.formatQuantity(20, movement('adjustment', undefined, 5)),
    ).toBe('+20');
    expect(
      component.quantityColor(movement('adjustment', undefined, 5)),
    ).toBe('var(--color-success)');

    expect(component.formatQuantity(20, movement('adjustment', 5))).toBe('-20');
    expect(component.quantityColor(movement('adjustment', 5))).toBe(
      'var(--color-error, #ef4444)',
    );
  });

  it('formats transfers as inbound and preserves the historical type fallback', () => {
    expect(component.formatQuantity(20, movement('transfer', 5, 7))).toBe('+20');
    expect(component.quantityColor(movement('transfer', 5, 7))).toBe(
      'var(--color-success)',
    );

    expect(
      component.formatQuantity(20, movement('stock_out', undefined, 5)),
    ).toBe('-20');
    expect(component.quantityColor(movement('stock_out', undefined, 5))).toBe(
      'var(--color-error, #ef4444)',
    );
  });

  it('keeps the no-item fallback as positive and success-colored', () => {
    expect(component.formatQuantity(20)).toBe('+20');
    expect(component.quantityColor()).toBe('var(--color-success)');
  });
});
