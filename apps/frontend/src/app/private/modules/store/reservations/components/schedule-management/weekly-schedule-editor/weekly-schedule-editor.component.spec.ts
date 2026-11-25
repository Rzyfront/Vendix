import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ToastService } from '../../../../../../../shared/components';
import { ReservationsService } from '../../../services/reservations.service';
import { ServiceStationsService } from '../../service-stations/service-stations.service';
import { WeeklyScheduleEditorComponent } from './weekly-schedule-editor.component';

/** Provider schedule tab: store hours read-only, or the own schedule with the shared editor. */
describe('WeeklyScheduleEditorComponent — horario del prestador', () => {
  const storeWeek = [
    { provider_id: 5, day_of_week: 5, block_order: 0, start_time: '17:00', end_time: '04:00', is_active: true, inherited: true },
  ];

  function setup(readOnly: boolean) {
    const service = {
      getProviderSchedule: jasmine.createSpy('getProviderSchedule').and.returnValue(of(storeWeek)),
      upsertProviderSchedule: jasmine.createSpy('upsertProviderSchedule').and.returnValue(of([])),
    };
    const toast = { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') };
    TestBed.configureTestingModule({
      imports: [WeeklyScheduleEditorComponent],
      providers: [
        { provide: ReservationsService, useValue: service },
        { provide: ServiceStationsService, useValue: {} },
        { provide: ToastService, useValue: toast },
      ],
    });
    const fixture = TestBed.createComponent(WeeklyScheduleEditorComponent);
    fixture.componentRef.setInput('providerId', 5);
    fixture.componentRef.setInput('readOnly', readOnly);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, service, toast, el: fixture.nativeElement as HTMLElement };
  }

  it('muestra el horario de la tienda en solo lectura: sin atajos, sin selectores ni botón de guardar', () => {
    const { component, el, service } = setup(true);
    const friday = component.days().find((d) => d.day_of_week === 5)!;
    expect(friday.is_active).toBeTrue();
    expect(friday.blocks[0]).toEqual({ start_time: '17:00', end_time: '04:00' });
    expect(el.querySelector('[data-testid="week-summary"]')?.textContent).toContain('Vie 5 p. m. – 4 a. m. (día siguiente)');
    expect(el.textContent).toContain('Termina al día siguiente');
    expect(el.querySelector('.whe-presets')).toBeNull();
    expect(el.querySelector('select')).toBeNull();
    expect(el.querySelector('.whe-footer')).toBeNull();
    component.onDaysChange([]);
    component.save(component.days());
    expect(service.upsertProviderSchedule).not.toHaveBeenCalled();
  });

  it('con horario propio muestra atajos, selectores de hora y el botón de guardar deshabilitado sin cambios', () => {
    const { el } = setup(false);
    expect(el.querySelector('.whe-presets')).not.toBeNull();
    expect(el.querySelectorAll('select').length).toBe(2);
    const button = el.querySelector('.whe-footer button') as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    expect(el.querySelector('.whe-footer__status')?.textContent).toContain('Sin cambios por guardar');
  });

  it('guarda un bloque por tramo con el atajo nocturno y avisa el éxito', () => {
    const { fixture, component, el, service, toast } = setup(false);
    const savedSpy = jasmine.createSpy('saved');
    component.saved.subscribe(savedSpy);
    (el.querySelector('[data-preset="night"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid="ends-next-day"]').length).toBe(7);
    (el.querySelector('.whe-footer button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const items = service.upsertProviderSchedule.calls.mostRecent().args[1];
    expect(items.length).toBe(7);
    expect(items[0]).toEqual({ day_of_week: 1, block_order: 0, is_active: true, start_time: '17:00', end_time: '04:00' });
    expect(toast.success).toHaveBeenCalled();
    expect(savedSpy).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.whe-footer__status')?.textContent).toContain('Horario guardado');
  });

  it('marca el error junto al tramo y no guarda si los tramos se cruzan', () => {
    const { fixture, component, el, service } = setup(false);
    component.onDaysChange(
      component.days().map((d) =>
        d.day_of_week === 2
          ? { ...d, is_active: true, blocks: [{ start_time: '08:00', end_time: '12:00' }, { start_time: '11:00', end_time: '14:00' }] }
          : d,
      ),
    );
    fixture.detectChanges();
    const tuesday = el.querySelector('[data-day="2"]')!;
    expect(tuesday.querySelectorAll('.whe-error').length).toBe(2);
    expect(tuesday.textContent).toContain('Se cruza con otro tramo del mismo día');
    const button = el.querySelector('.whe-footer button') as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    button.click();
    expect(service.upsertProviderSchedule).not.toHaveBeenCalled();
    expect(el.querySelector('.whe-footer__status')?.textContent).toContain('Hay 2 problemas por corregir');
  });

  it('recarga la semana al cambiar entre horario de la tienda y horario propio', () => {
    const { fixture, service } = setup(true);
    expect(service.getProviderSchedule).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('readOnly', false);
    fixture.detectChanges();
    expect(service.getProviderSchedule).toHaveBeenCalledTimes(2);
  });
});
