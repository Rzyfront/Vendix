import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ToastService } from '../../../../../../../shared/components';
import { ReservationsService } from '../../../services/reservations.service';
import { ServiceStationsService } from '../../service-stations/service-stations.service';
import { WeeklyScheduleEditorComponent } from './weekly-schedule-editor.component';

/** Parte 1: a provider that works the store hours sees the store week, read-only. */
describe('WeeklyScheduleEditorComponent — horario de la tienda (solo lectura)', () => {
  const storeWeek = [
    { provider_id: 5, day_of_week: 5, block_order: 0, start_time: '17:00', end_time: '04:00', is_active: true, inherited: true },
  ];

  function setup(readOnly: boolean) {
    const service = {
      getProviderSchedule: jasmine.createSpy('getProviderSchedule').and.returnValue(of(storeWeek)),
      upsertProviderSchedule: jasmine.createSpy('upsertProviderSchedule').and.returnValue(of([])),
    };
    TestBed.configureTestingModule({
      imports: [WeeklyScheduleEditorComponent],
      providers: [
        { provide: ReservationsService, useValue: service },
        { provide: ServiceStationsService, useValue: {} },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
      ],
    });
    const fixture = TestBed.createComponent(WeeklyScheduleEditorComponent);
    fixture.componentRef.setInput('providerId', 5);
    fixture.componentRef.setInput('readOnly', readOnly);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, service, el: fixture.nativeElement as HTMLElement };
  }

  it('muestra el horario de la tienda sin acciones de edición ni botón de guardar', () => {
    const { component, el, service } = setup(true);
    const friday = component.days().find((d) => d.day_of_week === 5)!;
    expect(friday.is_active).toBeTrue();
    expect(friday.blocks[0]).toEqual(jasmine.objectContaining({ start_time: '17:00', end_time: '04:00' }));
    expect(el.querySelector('.quick-actions')).toBeNull();
    expect(el.querySelector('.save-row')).toBeNull();
    expect(el.querySelector('.add-block-btn')).toBeNull();
    component.startEditing(component.days().indexOf(friday), 0);
    expect(component.days().find((d) => d.day_of_week === 5)!.editingBlock).toBeNull();
    component.save();
    expect(service.upsertProviderSchedule).not.toHaveBeenCalled();
  });

  it('con horario propio conserva la edición y el botón de guardar (sin cambios)', () => {
    const { el } = setup(false);
    expect(el.querySelector('.quick-actions')).not.toBeNull();
    expect(el.querySelector('.save-row')).not.toBeNull();
  });

  it('recarga la semana al cambiar entre horario de la tienda y horario propio', () => {
    const { fixture, service } = setup(true);
    expect(service.getProviderSchedule).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('readOnly', false);
    fixture.detectChanges();
    expect(service.getProviderSchedule).toHaveBeenCalledTimes(2);
  });
});
