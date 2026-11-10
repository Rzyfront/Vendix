import { Component, input, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PosScheduledOrderPickerComponent } from './pos-scheduled-order-picker.component';
import {
  FulfillmentDay,
  FulfillmentSlot,
  PosScheduledOrderService,
} from '../../services/pos-scheduled-order.service';

@Component({ selector: 'app-icon', standalone: true, template: `` })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}

@Component({ selector: 'app-non-producible-notice', standalone: true, template: `` })
class NoticeStub {
  readonly productId = input(0);
  readonly productName = input('');
  readonly productType = input<string | null>(null);
}

const slot = (h: string, over: Partial<FulfillmentSlot> = {}): FulfillmentSlot => ({
  start: `2026-11-12T${h}:00:00.000Z`,
  end: `2026-11-12T${h}:59:00.000Z`,
  local_start: `${h}:00`,
  local_end: `${h}:59`,
  capacity: 4,
  taken: 1,
  available: true,
  blocked_reason: null,
  ...over,
});

const OPEN_DAY: FulfillmentDay = {
  date: '2026-11-12',
  day_of_week: 4,
  blocked_reason: null,
  slots: [slot('09'), slot('10', { available: false, blocked_reason: 'slot_full', taken: 4 })],
};
const CLOSED_DAY: FulfillmentDay = {
  date: '2026-11-13',
  day_of_week: 5,
  blocked_reason: 'day_blocked',
  exception_reason: 'Festivo',
  slots: [],
};
const FULL_DAY: FulfillmentDay = {
  date: '2026-11-14',
  day_of_week: 6,
  blocked_reason: null,
  slots: [slot('09', { available: false, blocked_reason: 'slot_full', taken: 4 })],
};

describe('PosScheduledOrderPickerComponent (S5)', () => {
  let fixture: ComponentFixture<PosScheduledOrderPickerComponent>;
  let serviceMock: {
    enabled: WritableSignal<boolean>;
    active: WritableSignal<boolean>;
    loading: WritableSignal<boolean>;
    loadError: WritableSignal<string | null>;
    days: WritableSignal<FulfillmentDay[]>;
    selectedDate: WritableSignal<string | null>;
    selectedStart: WritableSignal<string | null>;
    showValidation: WritableSignal<boolean>;
    selectedDay: () => FulfillmentDay | null;
    hasSlot: () => boolean;
    selectDay: jasmine.Spy;
    selectSlot: jasmine.Spy;
    activate: jasmine.Spy;
    reset: jasmine.Spy;
  };

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const setSection = (section: 'toggle' | 'slot' | 'summary'): void => {
    fixture.componentRef.setInput('section', section);
    fixture.detectChanges();
  };
  const dayButtons = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('[aria-labelledby="pos-scheduled-day-label"] button'));
  const slotButtons = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('[aria-labelledby="pos-scheduled-slot-label"] button'));

  beforeEach(async () => {
    const days = signal<FulfillmentDay[]>([OPEN_DAY, CLOSED_DAY, FULL_DAY]);
    const selectedDate = signal<string | null>(null);
    const selectedStart = signal<string | null>(null);
    serviceMock = {
      enabled: signal(true),
      active: signal(true),
      loading: signal(false),
      loadError: signal(null),
      days,
      selectedDate,
      selectedStart,
      showValidation: signal(false),
      selectedDay: () => days().find((d) => d.date === selectedDate()) ?? null,
      hasSlot: () =>
        !!days()
          .find((d) => d.date === selectedDate())
          ?.slots.some((s) => s.start === selectedStart()),
      selectDay: jasmine.createSpy('selectDay').and.callFake((d: string) => {
        selectedDate.set(d);
        selectedStart.set(null);
      }),
      selectSlot: jasmine
        .createSpy('selectSlot')
        .and.callFake((s: FulfillmentSlot) => selectedStart.set(s.start)),
      activate: jasmine.createSpy('activate'),
      reset: jasmine.createSpy('reset'),
    };

    TestBed.configureTestingModule({
      imports: [PosScheduledOrderPickerComponent],
      providers: [{ provide: PosScheduledOrderService, useValue: serviceMock }],
    });
    TestBed.overrideComponent(PosScheduledOrderPickerComponent, {
      set: { imports: [IconStub, NoticeStub] },
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(PosScheduledOrderPickerComponent);
    setSection('slot');
  });

  it('primero el día: sin día elegido no se muestran franjas', () => {
    expect(dayButtons().length).toBe(3);
    expect(slotButtons().length).toBe(0);
  });

  it('un día cerrado y un día sin cupo quedan deshabilitados y muestran su motivo', () => {
    const [open, closed, full] = dayButtons();
    expect(open.disabled).toBeFalse();
    expect(closed.disabled).toBeTrue();
    expect(closed.textContent).toContain('Festivo');
    expect(closed.getAttribute('aria-label')).toContain('no disponible');
    expect(full.disabled).toBeTrue();
    expect(full.textContent).toContain('Sin cupo');
  });

  it('luego la franja: la llena queda deshabilitada con su motivo y la libre se elige', () => {
    dayButtons()[0].click();
    fixture.detectChanges();
    const [free, fullSlot] = slotButtons();
    expect(free.disabled).toBeFalse();
    expect(free.textContent).toContain('Quedan 3 cupos');
    expect(fullSlot.disabled).toBeTrue();
    expect(fullSlot.textContent).toContain('Sin cupo');

    free.click();
    fixture.detectChanges();
    expect(serviceMock.selectSlot).toHaveBeenCalledWith(OPEN_DAY.slots[0]);
    expect(slotButtons()[0].getAttribute('aria-checked')).toBe('true');
  });

  it('muestra el resumen Entrega: día · franja · método', () => {
    dayButtons()[0].click();
    fixture.detectChanges();
    slotButtons()[0].click();
    fixture.componentRef.setInput('methodName', 'Entrega Rápida Local');
    fixture.detectChanges();
    const text = (el().textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toMatch(/Entrega: \S+ 12 \S+ · 09:00–09:59 · Entrega Rápida Local/);
  });

  it('el resumen del paso Envío indica que falta elegir el método mientras no hay uno', () => {
    dayButtons()[0].click();
    fixture.detectChanges();
    slotButtons()[0].click();
    setSection('summary');
    expect(el().textContent).toContain('método por elegir');
  });

  it('sin cliente pide Con Cliente junto al selector', () => {
    fixture.componentRef.setInput('hasCustomer', false);
    fixture.detectChanges();
    expect(el().textContent).toContain('Con Cliente');
    fixture.componentRef.setInput('hasCustomer', true);
    fixture.detectChanges();
    expect(el().textContent).not.toContain('Con Cliente');
  });

  it('el interruptor activa y Quitar programación desactiva', () => {
    serviceMock.active.set(false);
    setSection('toggle');
    const sw = el().querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    sw.click();
    expect(serviceMock.activate).toHaveBeenCalled();

    serviceMock.active.set(true);
    fixture.detectChanges();
    const remove = Array.from(el().querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Quitar programación'),
    )!;
    remove.click();
    expect(serviceMock.reset).toHaveBeenCalled();
  });

  it('con el ajuste apagado no se renderiza nada', () => {
    serviceMock.enabled.set(false);
    fixture.detectChanges();
    expect(el().querySelector('section')).toBeNull();
  });
});
