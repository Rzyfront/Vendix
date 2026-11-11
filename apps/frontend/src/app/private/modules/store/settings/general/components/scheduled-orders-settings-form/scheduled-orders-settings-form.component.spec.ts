import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';

import {
  ScheduledOrdersPayload,
  ScheduledOrdersSettingsForm,
} from './scheduled-orders-settings-form.component';

/** Config de pedidos programados: sin «Tipos de entrega» y con días plegables. */
describe('ScheduledOrdersSettingsForm', () => {
  // Un guardado viejo todavía puede traer `fulfillment_types`.
  const stored = {
    enabled: true,
    weekly_schedule: [{ day_of_week: 1, start_time: '08:00', end_time: '18:00' }],
    slot_duration_minutes: 150,
    slot_capacity: 3,
    day_capacity: null,
    min_lead_time_hours: 24,
    max_days_ahead: 60,
    fulfillment_types: ['pickup', 'delivery'],
    reminders: [
      { minutes_before: 1440, enabled: true, notify_staff: true, notify_customer: true },
    ],
  };

  function build() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // Los inputs de moneda del formulario inyectan CurrencyFormatService → TenantFacade → Store.
        provideMockStore({ initialState: {} }),
      ],
    });
    const fixture = TestBed.createComponent(ScheduledOrdersSettingsForm);
    fixture.componentRef.setInput('settings', stored);
    const emitted: ScheduledOrdersPayload[] = [];
    fixture.componentInstance.settingsChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, emitted };
  }

  it('el payload guardado no incluye fulfillment_types y conserva las demás claves', () => {
    const { component, emitted } = build();

    component.onNumberChange('max_days_ahead', 30);

    expect(emitted.length).toBe(1);
    const payload = emitted[0] as unknown as Record<string, unknown>;
    expect('fulfillment_types' in payload).toBeFalse();
    expect(Object.keys(payload).sort()).toEqual(
      [
        'day_capacity',
        'enabled',
        'max_days_ahead',
        'min_lead_time_hours',
        'reminders',
        'slot_capacity',
        'slot_duration_minutes',
        'weekly_schedule',
      ].sort(),
    );
    expect(payload['max_days_ahead']).toBe(30);
    expect(payload['slot_duration_minutes']).toBe(150);
  });

  it('un día plegado muestra su resumen y un día sin bloque dice Cerrado', () => {
    const { fixture, component } = build();

    expect(component.daySummary(1)).toBe('8:00–18:00 · 4 franjas');
    expect(component.daySummary(2)).toBe('Cerrado');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('8:00–18:00 · 4 franjas');
    expect(text).toContain('Cerrado');
  });

  it('un recordatorio no puede tomar la anticipación de otro: dos reglas iguales avisarían dos veces', () => {
    const { fixture, component, emitted } = build();
    fixture.componentRef.setInput('settings', {
      ...stored,
      reminders: [
        { minutes_before: 1440, enabled: true, notify_staff: true, notify_customer: true },
        { minutes_before: 120, enabled: true, notify_staff: true, notify_customer: false },
      ],
    });
    fixture.detectChanges();

    const firstOptions = component.leadOptions(1440, 0).map((o) => o.value);
    expect(firstOptions).toContain(1440);
    expect(firstOptions).not.toContain(120);
    expect(component.leadOptions(120, 1).map((o) => o.value)).not.toContain(1440);

    component.onReminderLeadChange(0, 120);
    expect(emitted.length).toBe(0);

    component.onReminderLeadChange(0, 60);
    expect(emitted.length).toBe(1);
    expect(emitted[0].reminders.map((r) => r.minutes_before)).toEqual([60, 120]);
  });

  it('una anticipación fuera de 5..10080 minutos (límites del backend) no se emite', () => {
    const { component, emitted } = build();
    component.onReminderLeadChange(0, 4);
    component.onReminderLeadChange(0, 10081);
    expect(emitted.length).toBe(0);
  });
});
