import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { NEVER, Subject, of } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/index';
import {
  BoardAllCard,
  BoardAllData,
  WorkflowLiveEvent,
} from '../../interfaces/workflow-board.interfaces';
import { WorkflowBoardApiService } from '../../services/workflow-board-api.service';
import { WorkflowLiveService } from '../../services/workflow-live.service';
import { BoardAllPageComponent } from './board-all-page.component';

const card = (over: Partial<BoardAllCard> = {}): BoardAllCard => ({
  id: 11,
  reference: 'FLU-000011',
  title: 'Compra de laptops',
  status: 'active',
  definition: { id: 1, name: 'Compras' },
  stage_key: 'manager',
  stage_name: 'Gerencia',
  assignee: { type: 'role', id: 2, name: 'manager' },
  stage_due_at: null,
  overdue: false,
  location: { id: 1, name: 'Bodega principal' },
  ...over,
});

const data = (cards: BoardAllCard[] = [card()]): BoardAllData => ({
  columns: [
    { key: 'pending', name: 'Por atender', count: cards.length, cards, next_cursor: null },
    { key: 'in_progress', name: 'En curso', count: 0, cards: [], next_cursor: null },
    { key: 'system', name: 'En espera (sistema)', count: 0, cards: [], next_cursor: null },
    { key: 'closed', name: 'Cerradas (30 días)', count: 0, cards: [], next_cursor: null },
  ],
});

describe('BoardAllPageComponent', () => {
  let fixture: ComponentFixture<BoardAllPageComponent>;
  let api: jasmine.SpyObj<WorkflowBoardApiService>;
  let live: Subject<WorkflowLiveEvent>;
  let navigate: jasmine.Spy;

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const render = async () => {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };

  beforeEach(() => {
    api = jasmine.createSpyObj('WorkflowBoardApiService', ['getBoard', 'getFilters']);
    api.getBoard.and.returnValue(of(data()));
    api.getFilters.and.returnValue(
      of({
        definitions: [{ id: 1, name: 'Compras' }],
        roles: [{ id: 2, name: 'manager' }],
        locations: [{ id: 1, name: 'Bodega principal' }],
      }),
    );
    live = new Subject<WorkflowLiveEvent>();
    TestBed.configureTestingModule({
      imports: [BoardAllPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: WorkflowBoardApiService, useValue: api },
        { provide: WorkflowLiveService, useValue: { changes: () => live.asObservable() } },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
      ],
    });
    navigate = spyOn(TestBed.inject(Router), 'navigate');
    fixture = TestBed.createComponent(BoardAllPageComponent);
  });

  it('muestra las cuatro columnas y la tarjeta con flujo, referencia, etapa, responsable y sede', async () => {
    await render();
    for (const name of ['Por atender', 'En curso', 'En espera (sistema)', 'Cerradas (30 días)']) {
      expect(text()).toContain(name);
    }
    const t = text();
    expect(t).toContain('FLU-000011');
    expect(t).toContain('Compras');
    expect(t).toContain('Gerencia');
    expect(t).toContain('manager');
    expect(t).toContain('Bodega principal');
  });

  it('al elegir rol y sede pide el tablero con esos ids', async () => {
    await render();
    const c = fixture.componentInstance;
    c.onRole('2');
    c.onLocation('1');
    expect(api.getBoard.calls.mostRecent().args[0]).toEqual({ role_id: 2, location_id: 1 });
    c.onOverdue(true);
    expect(api.getBoard.calls.mostRecent().args[0]).toEqual({ role_id: 2, location_id: 1, overdue: true });
  });

  it('abrir una tarjeta lleva al detalle', async () => {
    await render();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="card-11"]')!.click();
    expect(navigate).toHaveBeenCalledWith(['/admin/workflows/instances', 11]);
  });

  it('un evento en vivo vuelve a leer el tablero sin mostrar el aviso de carga', async () => {
    await render();
    const before = api.getBoard.calls.count();
    api.getBoard.and.returnValue(of(data([card(), card({ id: 12, reference: 'FLU-000012' })])));
    live.next({ kind: 'task', instance_id: 12, task_id: 3 });
    fixture.detectChanges();
    expect(api.getBoard.calls.count()).toBe(before + 1);
    expect(fixture.componentInstance.loading()).toBeFalse();
    expect(text()).toContain('FLU-000012');
  });

  it('sin tarjetas muestra el estado vacío', async () => {
    api.getBoard.and.returnValue(of({ columns: data([]).columns }));
    await render();
    expect(text()).toContain('No hay solicitudes con estos filtros');
  });

  it('mientras carga muestra el aviso', async () => {
    api.getBoard.and.returnValue(NEVER);
    await render();
    expect(text()).toContain('Cargando...');
  });
});
