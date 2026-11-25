import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { ToastService } from '../../../../../../shared/components';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ReservationsService } from '../../services/reservations.service';
import { ServiceStationsService } from '../service-stations/service-stations.service';
import { ScheduleManagementComponent } from './schedule-management.component';
import type { ServiceProvider } from '../../interfaces/reservation.interface';

/** Provider modal → Horario: "Horario propio" never leaves a provider without availability. */
describe('ScheduleManagementComponent — horario de la tienda / horario propio', () => {
  function setup(provider: Partial<ServiceProvider>) {
    const service = {
      getProviders: jasmine.createSpy('getProviders').and.returnValue(of([])),
      getBookableServices: jasmine.createSpy('getBookableServices').and.returnValue(of([])),
      updateProvider: jasmine
        .createSpy('updateProvider')
        .and.callFake((_id: number, dto: Partial<ServiceProvider>) => of({ ...provider, ...dto })),
    };
    TestBed.configureTestingModule({
      imports: [ScheduleManagementComponent],
      providers: [
        { provide: ReservationsService, useValue: service },
        { provide: ServiceStationsService, useValue: {} },
        { provide: ToastService, useValue: { success: jasmine.createSpy(), error: jasmine.createSpy() } },
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy() } },
        { provide: AuthFacade, useValue: { isServiceIndustry: signal(false) } },
      ],
    });
    TestBed.overrideComponent(ScheduleManagementComponent, { set: { template: '', imports: [] } });
    const component = TestBed.createComponent(ScheduleManagementComponent).componentInstance;
    component.selectedProvider.set({ id: 7, uses_store_hours: true, ...provider } as ServiceProvider);
    return { component, service };
  }

  it('sin horario propio guardado, elegir "Horario propio" es un borrador y no cambia nada en el servidor', () => {
    const { component, service } = setup({ has_own_schedule: false });
    component.setUsesStoreHours(false);
    expect(service.updateProvider).not.toHaveBeenCalled();
    expect(component.ownScheduleDraft()).toBeTrue();
    expect(component.showsOwnSchedule()).toBeTrue();
    expect(component.usesStoreHours()).toBeTrue();
  });

  it('volver a "Horario de la tienda" desde el borrador lo descarta sin llamar al servidor', () => {
    const { component, service } = setup({ has_own_schedule: false });
    component.setUsesStoreHours(false);
    component.setUsesStoreHours(true);
    expect(service.updateProvider).not.toHaveBeenCalled();
    expect(component.showsOwnSchedule()).toBeFalse();
  });

  it('el primer guardado del borrador pasa al prestador a su horario propio', () => {
    const { component } = setup({ has_own_schedule: false });
    component.setUsesStoreHours(false);
    component.onOwnScheduleSaved();
    expect(component.ownScheduleDraft()).toBeFalse();
    expect(component.usesStoreHours()).toBeFalse();
    expect(component.selectedProvider()?.has_own_schedule).toBeTrue();
  });

  it('con horario propio ya guardado, el cambio se aplica al instante como antes', () => {
    const { component, service } = setup({ has_own_schedule: true });
    component.setUsesStoreHours(false);
    expect(service.updateProvider).toHaveBeenCalledWith(7, { uses_store_hours: false });
    expect(component.ownScheduleDraft()).toBeFalse();
    expect(component.usesStoreHours()).toBeFalse();
  });
});
