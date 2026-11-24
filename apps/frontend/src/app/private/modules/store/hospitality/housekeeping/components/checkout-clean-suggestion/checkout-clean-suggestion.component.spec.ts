import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';

import { CheckoutCleanSuggestionComponent } from './checkout-clean-suggestion.component';
import { LodgingHousekeepingService } from '../../services/housekeeping.service';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { CheckoutCleanSuggestion } from '../../interfaces/housekeeping.interface';
import { HOSPITALITY_TERMS } from '../../../shared/hospitality-labels';

/**
 * Agenda unificada (F3) — the check-out suggests the room's clean with the
 * recommended person (fixed cleaning role first). Accepting creates it with
 * the chosen person; skipping creates nothing.
 */
describe('CheckoutCleanSuggestionComponent — limpieza sugerida al check-out', () => {
  let fixture: ComponentFixture<CheckoutCleanSuggestionComponent>;
  let component: CheckoutCleanSuggestionComponent;
  let service: jasmine.SpyObj<LodgingHousekeepingService>;

  const suggestion = (): CheckoutCleanSuggestion => ({
    reservation_id: 9,
    business_date: '2026-11-23',
    // The API ranks it: cleaning role first, then other staff.
    staff: [
      { id: 2, name: 'Luz Gómez', is_cleaning_role: true, pending_tasks: 1 },
      { id: 1, name: 'Ana Admin', is_cleaning_role: false, pending_tasks: 0 },
    ],
    rooms: [
      {
        unit_id: 7,
        code: '101',
        floor: '1',
        unit_type_name: 'Doble',
        priority: 'high',
        priority_reason: 'Prioridad alta: llega un huésped hoy a esta habitación',
        suggested_note: 'Prioridad alta: llega un huésped hoy a esta habitación',
        suggested_user_id: 2,
        existing_task: null,
      },
    ],
  });

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    service = jasmine.createSpyObj<LodgingHousekeepingService>('LodgingHousekeepingService', [
      'checkoutCleanSuggestion',
      'assignCheckoutClean',
    ]);
    service.checkoutCleanSuggestion.and.returnValue(of(suggestion()));
    service.assignCheckoutClean.and.returnValue(
      of([{ unit_id: 7, code: '101', task_id: 50, assigned_user_id: 1, outcome: 'created' as const }]),
    );

    TestBed.configureTestingModule({
      imports: [CheckoutCleanSuggestionComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: LodgingHousekeepingService, useValue: service },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info', 'warning']),
        },
      ],
    });
    fixture = TestBed.createComponent(CheckoutCleanSuggestionComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('reservationId', 9);
    await render();
  });

  it('ofrece la tarea de limpieza prellenada de la habitación', () => {
    expect(service.checkoutCleanSuggestion).toHaveBeenCalledWith(9);
    expect(host().querySelector('[data-testid="checkout-clean"]')).not.toBeNull();
    const room = host().querySelector('[data-testid="checkout-clean-room"]')!;
    expect(room.textContent).toContain('Hab. 101');
    expect(room.textContent).toContain('Prioridad alta');
    const draft = component.drafts()[0];
    expect(draft.userId).toBe(2);
    expect(draft.note.value).toContain('llega un huésped hoy');
  });

  it('pone primero al personal del rol de limpieza en la lista recomendada', () => {
    const options = component.staffOptions();
    expect(options.map((o) => o.value)).toEqual([2, 1, 0]);
    // The role is named as in Configuración › Usuarios (hospitality glossary).
    expect(options[0].label).toBe(`Luz Gómez · ${HOSPITALITY_TERMS.housekeeper}`);
    expect(options[0].description).toContain('Recomendada');
    expect(options[1].description).toContain('Otro personal');
    expect(options[2].label).toBe('Sin asignar');
  });

  it('aceptar crea la tarea con la persona elegida', async () => {
    const assigned = jasmine.createSpy('assigned');
    component.assigned.subscribe(assigned);
    component.pick(component.drafts()[0], 1);
    component.drafts()[0].note.setValue('  Revisar minibar ');

    component.accept();
    await render();

    expect(service.assignCheckoutClean).toHaveBeenCalledOnceWith(9, [
      { unit_id: 7, assigned_user_id: 1, notes: 'Revisar minibar' },
    ]);
    expect(assigned).toHaveBeenCalled();
    expect(host().querySelector('[data-testid="checkout-clean-saved"]')?.textContent).toContain(
      'limpieza asignada a Ana Admin',
    );
  });

  it('omitir no crea nada', async () => {
    const skipped = jasmine.createSpy('skipped');
    component.skipped.subscribe(skipped);
    (host().querySelector('[data-testid="checkout-clean-skip"] button') as HTMLButtonElement).click();
    await render();

    expect(service.assignCheckoutClean).not.toHaveBeenCalled();
    expect(skipped).toHaveBeenCalledTimes(1);
    expect(host().querySelector('[data-testid="checkout-clean-skipped"]')).not.toBeNull();
  });

  it('una habitación ya limpia hoy no se vuelve a ofrecer', async () => {
    const done = suggestion();
    done.rooms[0].existing_task = { id: 40, status: 'done', assigned_user_id: 2 };
    service.checkoutCleanSuggestion.and.returnValue(of(done));
    component.load();
    await render();

    expect(component.drafts().length).toBe(0);
    expect(host().querySelector('[data-testid="checkout-clean-accept"]')).toBeNull();
    expect(host().textContent).toContain('ya está limpia hoy');
  });

  it('sin nadie del rol de limpieza deja «Sin asignar» y avisa con el nombre del rol', async () => {
    const none = suggestion();
    none.staff = [{ id: 1, name: 'Ana Admin', is_cleaning_role: false, pending_tasks: 0 }];
    none.rooms[0].suggested_user_id = null;
    service.checkoutCleanSuggestion.and.returnValue(of(none));
    component.load();
    await render();

    expect(component.drafts()[0].userId).toBe(0);
    const notice = host().querySelector('[data-testid="checkout-clean-no-staff"]');
    expect(notice?.textContent).toContain(`«${HOSPITALITY_TERMS.housekeeper}»`);
    expect(notice?.textContent).toContain('Configuración › Usuarios');
    // The rest of the staff stays a manual choice.
    expect(component.staffOptions().map((o) => o.value)).toEqual([1, 0]);
  });

  it('con personal del rol de limpieza no muestra el aviso', () => {
    expect(host().querySelector('[data-testid="checkout-clean-no-staff"]')).toBeNull();
  });
});
