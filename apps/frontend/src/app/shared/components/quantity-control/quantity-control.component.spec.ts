import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  QuantityControlComponent,
  QuantityClampEvent,
} from './quantity-control.component';

describe('QuantityControlComponent', () => {
  let fixture: ComponentFixture<QuantityControlComponent>;
  let component: QuantityControlComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [QuantityControlComponent],
    });
    fixture = TestBed.createComponent(QuantityControlComponent);
    component = fixture.componentInstance;
  });

  function setInputs(value: number, min: number, max: number | null): void {
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('min', min);
    fixture.componentRef.setInput('max', max);
    fixture.detectChanges();
  }

  function collectClamps(): QuantityClampEvent[] {
    const events: QuantityClampEvent[] = [];
    component.valueClamped.subscribe((e) => events.push(e));
    return events;
  }

  function collectValueChanges(): number[] {
    const events: number[] = [];
    component.valueChange.subscribe((e) => events.push(e));
    return events;
  }

  it('should emit valueClamped with reason "max" when user types above max on blur', () => {
    setInputs(1, 1, 11);
    const clamps = collectClamps();
    const changes = collectValueChanges();

    // Simulate user typing "12" and pressing Tab (blur)
    component['onInputChange']('12'); // private but used in production
    component['onBlur']();

    expect(clamps).toEqual([
      { attempted: 12, max: 11, reason: 'max' },
    ]);
    expect(changes).toEqual([11]);
    expect(component['displayValue']).toBe(11);
  });

  it('should NOT emit valueClamped when value is exactly at max', () => {
    setInputs(11, 1, 11);
    const clamps = collectClamps();
    const changes = collectValueChanges();

    component['onInputChange']('11');
    component['onBlur']();

    expect(clamps).toEqual([]);
    // valueChange still fires because typed 11 was re-committed (was already at 11)
    // but commitValue guards with "if (constrainedValue !== this.value())" so no emit
    expect(changes).toEqual([]);
  });

  it('should emit valueClamped with reason "min" when user types below min', () => {
    setInputs(5, 1, 99);
    const clamps = collectClamps();
    const changes = collectValueChanges();

    component['onInputChange']('0');
    component['onBlur']();

    expect(clamps).toEqual([
      { attempted: 0, max: 1, reason: 'min' },
    ]);
    expect(changes).toEqual([1]);
  });

  it('should NOT emit valueClamped when increase() is called and already at max', () => {
    setInputs(11, 1, 11);
    const clamps = collectClamps();

    component.increase();

    expect(clamps).toEqual([]);
  });

  it('should NOT clamp or emit valueClamped when max is null', () => {
    setInputs(1, 1, null);
    const clamps = collectClamps();
    const changes = collectValueChanges();

    component['onInputChange']('9999');
    component['onBlur']();

    expect(clamps).toEqual([]);
    expect(changes).toEqual([9999]);
  });
});
