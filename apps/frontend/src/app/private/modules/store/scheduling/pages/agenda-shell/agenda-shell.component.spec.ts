import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { AgendaShellComponent } from './agenda-shell.component';
import { SchedulingAgendaPageComponent } from '../scheduling-agenda-page/scheduling-agenda-page.component';
import { SchedulingListPageComponent } from '../scheduling-list-page/scheduling-list-page.component';
import { SchedulingConfigTabComponent } from '../../components/scheduling-config-tab/scheduling-config-tab.component';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { SchedulingApiService } from '../../services/scheduling-api.service';
import { SCHEDULING_AGENDA_ROUTES } from '../../scheduling.routes';
import type { SchedulingSources } from '../../interfaces/scheduling.interface';

@Component({ selector: 'app-scheduling-agenda-page', standalone: true, template: 'CALENDARIO' })
class CalendarStub {
  readonly embedded = input(false);
}
@Component({ selector: 'app-scheduling-list-page', standalone: true, template: 'PROGRAMACION' })
class ListStub {
  readonly embedded = input(false);
}
@Component({ selector: 'app-scheduling-config-tab', standalone: true, template: 'CONFIG {{ section() }}' })
class ConfigStub {
  readonly section = input.required<string>();
  readonly sectionChange = output<string>();
}

/** Solo la ruta de Agenda: las redirecciones reales se prueban en `store-admin-rutas-routes.spec.ts`. */
function routes() {
  return [{ path: 'admin/orders/agenda', loadChildren: () => SCHEDULING_AGENDA_ROUTES }];
}

async function open(url: string) {
  TestBed.configureTestingModule({ providers: [provideRouter(routes())] });
  TestBed.overrideComponent(AgendaShellComponent, {
    remove: {
      imports: [SchedulingAgendaPageComponent, SchedulingListPageComponent, SchedulingConfigTabComponent],
    },
    add: { imports: [CalendarStub, ListStub, ConfigStub] },
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  harness.detectChanges();
  return { harness, router: TestBed.inject(Router) };
}

describe('Agenda unificada F1 — módulo Agenda con pestañas', () => {
  it('abre por defecto en Calendario y lo escribe en la URL', async () => {
    const { harness, router } = await open('/admin/orders/agenda');
    await harness.fixture.whenStable();
    expect(router.url).toBe('/admin/orders/agenda?tab=calendario');
    expect(harness.routeNativeElement?.textContent).toContain('CALENDARIO');
  });

  it('?tab= abre la pestaña pedida; una desconocida cae en Calendario', async () => {
    let { harness } = await open('/admin/orders/agenda?tab=programacion');
    expect(harness.routeNativeElement?.textContent).toContain('PROGRAMACION');
    TestBed.resetTestingModule();
    ({ harness } = await open('/admin/orders/agenda?tab=configuracion&seccion=cola'));
    expect(harness.routeNativeElement?.textContent).toContain('CONFIG cola');
    TestBed.resetTestingModule();
    ({ harness } = await open('/admin/orders/agenda?tab=xyz'));
    expect(harness.routeNativeElement?.textContent).toContain('CALENDARIO');
  });

  it('cambiar de pestaña actualiza ?tab= (y la sección de Configuración)', async () => {
    const { harness, router } = await open('/admin/orders/agenda?tab=calendario');
    const shell = harness.routeDebugElement!.componentInstance as AgendaShellComponent;
    shell.onTab('configuracion');
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(router.url).toBe('/admin/orders/agenda?tab=configuracion&seccion=equipo');
    shell.onSection('disponibilidad');
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(router.url).toBe('/admin/orders/agenda?tab=configuracion&seccion=disponibilidad');
    expect(harness.routeNativeElement?.textContent).toContain('CONFIG disponibilidad');
  });

});

describe('Agenda unificada F1 — pestaña Configuración', () => {
  const SOURCES: SchedulingSources = {
    timezone: 'America/Bogota',
    today: '2026-11-25',
    types: [
      { value: 'booking', label: 'Reserva de servicio' },
      { value: 'scheduled_order', label: 'Pedido programado' },
    ],
    status_groups: [],
    staff: [],
  };

  function setup(sources: SchedulingSources) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SchedulingApiService, useValue: { getSources: () => of(sources) } },
        { provide: AuthFacade, useValue: { isServiceIndustry: signal(true) } },
      ],
    });
    // Sin detectChanges: las pantallas de Reservas se prueban en su módulo; aquí solo el acceso.
  }

  it('configura las secciones de Agenda sin repetir las pantallas que ya viven en el menú de Acciones', () => {
    setup(SOURCES);
    const fixture = TestBed.createComponent(SchedulingConfigTabComponent);
    fixture.componentRef.setInput('section', 'equipo');
    const tab = fixture.componentInstance;
    expect(tab.sectionTabs.map((t) => t.id)).toEqual(['equipo', 'disponibilidad', 'cola', 'horario']);
    expect(tab.hasBookings()).toBeTrue();
    // La rejilla «Otras pantallas» se retiró: esas rutas ya están en el menú de acciones de Agenda.
    expect((tab as unknown as { links?: unknown }).links).toBeUndefined();
  });

  it('sin reservas habilitadas no ofrece configurar prestadores', () => {
    setup({ ...SOURCES, types: [{ value: 'scheduled_order', label: 'Pedido programado' }] });
    const fixture = TestBed.createComponent(SchedulingConfigTabComponent);
    fixture.componentRef.setInput('section', 'equipo');
    const tab = fixture.componentInstance;
    expect(tab.hasBookings()).toBeFalse();
  });
});
