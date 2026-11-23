import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';

import { AddNotesModalComponent } from './add-notes-modal.component';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { OrdersService } from '../../../orders/services/orders.service';
import { DispatchNotesService } from '../../../dispatch-notes/services/dispatch-notes.service';

/**
 * "Agregar remisiones": el selector de remisiones disponibles pagina en el
 * servidor de a 15 con el paginador estándar, la selección sobrevive a los
 * cambios de página y de búsqueda, el contador es el total real y el vacío
 * solo sale cuando el servidor no tiene ninguna.
 */
describe('AddNotesModalComponent — remisiones disponibles paginadas', () => {
  let fixture: ComponentFixture<AddNotesModalComponent>;
  let component: AddNotesModalComponent;
  let service: jasmine.SpyObj<PlanillasRutasService>;

  const TOTAL = 40;
  const note = (id: number) => ({
    id,
    dispatch_number: `REM-${id}`,
    customer_name: `Cliente ${id}`,
    grand_total: 1000,
    status: 'confirmed',
  });
  /** Simula el endpoint: `TOTAL` remisiones, ids 1..TOTAL, de a `limit`. */
  const pageOf = (page: number, limit: number, total = TOTAL) => {
    const start = (page - 1) * limit + 1;
    const end = Math.min(page * limit, total);
    const data: ReturnType<typeof note>[] = [];
    for (let id = start; id <= end; id++) data.push(note(id));
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

  beforeEach(async () => {
    service = jasmine.createSpyObj<PlanillasRutasService>('PlanillasRutasService', [
      'listAvailableDispatchNotes',
      'addStops',
    ]);
    service.listAvailableDispatchNotes.and.callFake((q = {}) =>
      of(pageOf(q.page ?? 1, q.limit ?? 15)),
    );

    TestBed.configureTestingModule({
      imports: [AddNotesModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({ initialState: { tenant: {} } }),
        { provide: PlanillasRutasService, useValue: service },
        { provide: AuthFacade, useValue: { hasPermission: () => false } },
        { provide: OrdersService, useValue: {} },
        { provide: DispatchNotesService, useValue: {} },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info', 'warning']),
        },
      ],
    });
    fixture = TestBed.createComponent(AddNotesModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('routeId', 7);
    await render();
  });

  it('pide páginas de 15 y el contador muestra el total real del servidor', async () => {
    const query = service.listAvailableDispatchNotes.calls.mostRecent().args[0];
    expect(query).toEqual(jasmine.objectContaining({ page: 1, limit: 15 }));
    expect(component.availableNotes().length).toBe(15);
    expect(component.notesTotal()).toBe(TOTAL);
    expect(component.notesTotalPages()).toBe(3);
    expect(host().textContent).toContain(`Disponibles (${TOTAL})`);
    // Paginador estándar en lugar de "Cargar más".
    expect(host().querySelector('app-pagination nav')).not.toBeNull();
    expect(host().textContent).not.toContain('Cargar más');
  });

  it('cambiar de página no pierde la selección y la marca al volver', async () => {
    component.toggleNote(3);
    component.onNotesPageChange(2);
    await render();

    expect(service.listAvailableDispatchNotes.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ page: 2, limit: 15 }),
    );
    expect(component.availableNotes()[0].id).toBe(16);
    component.toggleNote(20);
    // El contador no se infla ni baja con la selección: sigue el total real.
    expect(component.notesTotal()).toBe(TOTAL);
    expect(component.selectedNotes().map((n) => n.id)).toEqual([3, 20]);

    component.onNotesPageChange(1);
    await render();
    expect(component.selectedNotes().map((n) => n.id)).toEqual([3, 20]);
    expect(component.isNoteSelected(3)).toBeTrue();
    const pressed = Array.from(
      host().querySelectorAll('button[aria-pressed="true"]'),
    ).map((b) => b.textContent ?? '');
    expect(pressed.length).toBe(1);
    expect(pressed[0]).toContain('REM-3');
  });

  it('buscar vuelve a la página 1 y conserva la selección', async () => {
    component.onNotesPageChange(3);
    await render();
    component.toggleNote(35);
    expect(component.notesPage()).toBe(3);

    component.onNoteSearch('REM-1');
    await render();

    expect(service.listAvailableDispatchNotes.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ search: 'REM-1', page: 1, limit: 15 }),
    );
    expect(component.notesPage()).toBe(1);
    expect(component.selectedNotes().map((n) => n.id)).toEqual([35]);
  });

  it('el aviso de vacío solo sale cuando el total del servidor es 0', async () => {
    // Con resultados (aunque todos los de la página estén elegidos) no hay vacío.
    for (const n of component.availableNotes()) component.toggleNote(n.id);
    await render();
    expect(host().textContent).not.toContain('Sin remisiones');

    service.listAvailableDispatchNotes.and.returnValue(of(pageOf(1, 15, 0)));
    component.onNoteSearch('no-existe');
    await render();
    expect(component.notesTotal()).toBe(0);
    expect(host().textContent).toContain('Sin remisiones');
    expect(host().querySelector('app-pagination nav')).toBeNull();
  });

  it('si la página pedida ya no existe va a la última con datos', async () => {
    service.listAvailableDispatchNotes.and.callFake((q = {}) =>
      of(pageOf(q.page ?? 1, q.limit ?? 15, 20)),
    );
    component.onNotesPageChange(3);
    await render();

    expect(component.notesPage()).toBe(2);
    expect(component.notesTotal()).toBe(20);
    expect(component.availableNotes().map((n) => n.id)).toEqual([16, 17, 18, 19, 20]);
  });
});
