import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';

import { PlanillaWizardComponent } from './planilla-wizard.component';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { OrdersService } from '../../../orders/services/orders.service';
import { DispatchNotesService } from '../../../dispatch-notes/services/dispatch-notes.service';

/**
 * Nueva planilla, paso 2 "Remisiones existentes": páginas de 15 con el
 * paginador estándar, las paradas elegidas sobreviven a cambiar de página o de
 * búsqueda, el contador es el total real y el vacío solo sale con total 0.
 */
describe('PlanillaWizardComponent — paso 2 con remisiones paginadas', () => {
  let fixture: ComponentFixture<PlanillaWizardComponent>;
  let component: PlanillaWizardComponent;
  let service: jasmine.SpyObj<PlanillasRutasService>;

  const TOTAL = 32;
  const note = (id: number) => ({
    id,
    dispatch_number: `REM-${id}`,
    customer_name: `Cliente ${id}`,
    grand_total: 1000,
    status: 'confirmed',
  });
  const pageOf = (page: number, limit: number, total = TOTAL) => {
    const data: ReturnType<typeof note>[] = [];
    for (let id = (page - 1) * limit + 1; id <= Math.min(page * limit, total); id++) {
      data.push(note(id));
    }
    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const stopIds = () => component.orderedStops().map((s) => s.dispatch_note_id);

  beforeEach(async () => {
    service = jasmine.createSpyObj<PlanillasRutasService>('PlanillasRutasService', [
      'listAvailableDispatchNotes',
      'listVehicles',
    ]);
    service.listAvailableDispatchNotes.and.callFake((q = {}) =>
      of(pageOf(q.page ?? 1, q.limit ?? 15)),
    );
    service.listVehicles.and.returnValue(of({ data: [], pagination: null }));

    TestBed.configureTestingModule({
      imports: [PlanillaWizardComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({ initialState: { tenant: {} } }),
        { provide: PlanillasRutasService, useValue: service },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        { provide: AuthFacade, useValue: { hasPermission: () => false } },
        { provide: OrdersService, useValue: {} },
        { provide: DispatchNotesService, useValue: {} },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info', 'warning']),
        },
      ],
    });
    fixture = TestBed.createComponent(PlanillaWizardComponent);
    component = fixture.componentInstance;
    component.currentStep.set(2);
    await render();
  });

  it('muestra la primera página de 15 con el total real y el paginador estándar', () => {
    expect(service.listAvailableDispatchNotes.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ page: 1, limit: 15 }),
    );
    expect(component.availableNotes().length).toBe(15);
    expect(host().textContent).toContain(`Disponibles (${TOTAL})`);
    expect(host().querySelector('app-pagination nav')).not.toBeNull();
    expect(host().textContent).not.toContain('Cargar más');
  });

  it('las paradas sobreviven a cambiar de página y se marcan al volver', async () => {
    component.toggleNote(2);
    component.onNotesPageChange(3);
    await render();
    expect(component.availableNotes().map((n) => n.id)).toEqual([31, 32]);
    component.toggleNote(31);
    expect(stopIds()).toEqual([2, 31]);

    component.onNotesPageChange(1);
    await render();
    expect(stopIds()).toEqual([2, 31]);
    expect(host().querySelector('button[aria-pressed="true"]')?.textContent).toContain(
      'REM-2',
    );
    // Quitarla desde la lista recalcula la secuencia de las paradas.
    component.toggleNote(2);
    expect(component.orderedStops()).toEqual([
      jasmine.objectContaining({ dispatch_note_id: 31, stop_sequence: 1 }),
    ]);
  });

  it('buscar vuelve a la página 1 y el vacío solo sale con total 0', async () => {
    component.onNotesPageChange(2);
    await render();
    component.toggleNote(20);

    service.listAvailableDispatchNotes.and.returnValue(of(pageOf(1, 15, 0)));
    component.onNoteSearch('nada');
    await render();

    expect(service.listAvailableDispatchNotes.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ search: 'nada', page: 1, limit: 15 }),
    );
    expect(component.notesPage()).toBe(1);
    expect(host().textContent).toContain('Sin remisiones');
    expect(stopIds()).toEqual([20]);
  });
});
