import { NO_ERRORS_SCHEMA, provideZonelessChangeDetection, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { PlanillaDetailPageComponent } from './planilla-detail-page.component';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { RoutePositionPublisherService } from '../../services/route-position-publisher.service';
import { RouteTrackingService } from '../../services/route-tracking.service';
import { DispatchNotesService } from '../../../dispatch-notes/services/dispatch-notes.service';
import { DispatchNotePrintService } from '../../../dispatch-notes/services/dispatch-note-print.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { DialogService, EmptyStateComponent } from '../../../../../../shared/components/index';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency';

/**
 * QUI-1058 — abrir el detalle de una ruta inexistente o de otra tienda dejaba
 * la página en blanco. Ahora la primera carga fallida muestra un estado vacío:
 * 404 → «Ruta no encontrada» + Volver a Rutas; otro error → Reintentar.
 *
 * Se renderiza la plantilla real con `app-empty-state` real; los demás hijos
 * quedan inertes (NO_ERRORS_SCHEMA) porque sin ruta no se pintan.
 */
describe('PlanillaDetailPageComponent ruta no encontrada (QUI-1058)', () => {
  let fixture: ComponentFixture<PlanillaDetailPageComponent>;
  let service: jasmine.SpyObj<PlanillasRutasService>;
  let router: jasmine.SpyObj<Router>;
  let toast: jasmine.SpyObj<ToastService>;
  let paramId: string | null;

  const httpError = (status: number, message: string) =>
    throwError(() => Object.assign(new Error(message), { status }));

  beforeEach(async () => {
    paramId = '999999';
    service = jasmine.createSpyObj('PlanillasRutasService', ['getOne']);
    router = jasmine.createSpyObj('Router', ['navigate']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning', 'info']);

    await TestBed.configureTestingModule({
      imports: [PlanillaDetailPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PlanillasRutasService, useValue: service },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => paramId } } } },
        { provide: CurrencyFormatService, useValue: { format: (v: number) => String(v), loadCurrency: () => {} } },
        { provide: DispatchNotesService, useValue: {} },
        { provide: DispatchNotePrintService, useValue: {} },
        { provide: AuthFacade, useValue: { user: signal(null) } },
        {
          provide: RoutePositionPublisherService,
          useValue: { state: signal('idle'), currentRouteId: null, start: () => {}, stop: () => {} },
        },
        { provide: RouteTrackingService, useValue: {} },
        { provide: DialogService, useValue: {} },
      ],
    })
      .overrideComponent(PlanillaDetailPageComponent, {
        set: {
          imports: [CommonModule, CurrencyPipe, EmptyStateComponent],
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();
  });

  const render = async () => {
    fixture = TestBed.createComponent(PlanillaDetailPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const emptyState = (): HTMLElement | null => fixture.nativeElement.querySelector('app-empty-state');

  const actionButton = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('app-empty-state .empty-state-actions button');

  it('404 (inexistente o de otra tienda) muestra «Ruta no encontrada» y vuelve a Rutas', async () => {
    service.getOne.and.returnValue(httpError(404, 'Ruta no encontrada'));
    await render();

    expect(service.getOne).toHaveBeenCalledOnceWith(999999);
    expect(emptyState()?.textContent).toContain('Ruta no encontrada');
    expect(emptyState()?.textContent).toContain('La ruta no existe o no pertenece a esta tienda.');
    expect(actionButton().textContent).toContain('Volver a Rutas');
    expect(toast.error).not.toHaveBeenCalled();

    actionButton().click();
    expect(router.navigate).toHaveBeenCalledOnceWith(['/admin/orders/rutas']);
  });

  it('un id no numérico muestra «Ruta no encontrada» sin llamar a la API', async () => {
    paramId = 'abc';
    await render();

    expect(service.getOne).not.toHaveBeenCalled();
    expect(emptyState()?.textContent).toContain('Ruta no encontrada');
  });

  it('un fallo de red no dice que no existe: ofrece Reintentar y recarga', async () => {
    service.getOne.and.returnValue(httpError(0, 'Sin conexión'));
    await render();

    expect(emptyState()?.textContent).toContain('No se pudo cargar la ruta');
    expect(emptyState()?.textContent).not.toContain('Ruta no encontrada');
    expect(actionButton().textContent).toContain('Reintentar');

    service.getOne.and.returnValue(httpError(500, 'Error interno'));
    actionButton().click();
    expect(service.getOne).toHaveBeenCalledTimes(2);
  });

  it('una recarga fallida con la ruta ya visible conserva la vista y avisa con toast', async () => {
    service.getOne.and.returnValue(of({ id: 999999, route_number: 'R-1', status: 'draft', stops: [] } as any));
    await render();
    expect(fixture.componentInstance.route()).not.toBeNull();

    service.getOne.and.returnValue(httpError(404, 'Ruta no encontrada'));
    fixture.componentInstance.load();

    expect(fixture.componentInstance.loadError()).toBeNull();
    expect(fixture.componentInstance.route()).not.toBeNull();
    expect(toast.error).toHaveBeenCalledOnceWith('Ruta no encontrada');
  });
});
