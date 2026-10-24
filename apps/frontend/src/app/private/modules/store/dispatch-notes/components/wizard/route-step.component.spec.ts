import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import {
  RouteStepComponent,
  isRouteAssignable,
} from './route-step.component';
import { PlanillasRutasService } from '../../../planillas-rutas/services/planillas-rutas.service';
import { DispatchRoute } from '../../../planillas-rutas/interfaces/planilla.interface';
import {
  DispatchNoteWizardService,
  WizardRouteMode,
} from '../../services/dispatch-note-wizard.service';

describe('isRouteAssignable', () => {
  it('is true for draft and dispatched', () => {
    expect(isRouteAssignable({ status: 'draft' })).toBeTrue();
    expect(isRouteAssignable({ status: 'dispatched' })).toBeTrue();
  });

  it('is false for in_transit, closed and voided', () => {
    expect(isRouteAssignable({ status: 'in_transit' })).toBeFalse();
    expect(isRouteAssignable({ status: 'closed' })).toBeFalse();
    expect(isRouteAssignable({ status: 'voided' })).toBeFalse();
  });
});

describe('RouteStepComponent', () => {
  const draft = { id: 1, status: 'draft', route_number: 'P1' } as DispatchRoute;
  const closed = { id: 2, status: 'closed', route_number: 'P2' } as DispatchRoute;

  let listSpy: jasmine.Spy;
  let wizardStub: {
    routeMode: ReturnType<typeof signal<WizardRouteMode>>;
    selectedRouteId: ReturnType<typeof signal<number | null>>;
    newRouteDraft: ReturnType<typeof signal<null>>;
    setRouteMode: (m: WizardRouteMode) => void;
    setSelectedRouteId: (id: number | null) => void;
    setNewRouteDraft: jasmine.Spy;
  };

  beforeEach(() => {
    listSpy = jasmine.createSpy('list').and.returnValue(of({ data: [draft, closed] }));
    wizardStub = {
      routeMode: signal<WizardRouteMode>('none'),
      selectedRouteId: signal<number | null>(null),
      newRouteDraft: signal(null),
      setRouteMode(m) {
        this.routeMode.set(m);
      },
      setSelectedRouteId(id) {
        this.selectedRouteId.set(id);
      },
      setNewRouteDraft: jasmine.createSpy('setNewRouteDraft'),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: PlanillasRutasService, useValue: { list: listSpy } },
        { provide: DispatchNoteWizardService, useValue: wizardStub },
      ],
    });
    TestBed.overrideComponent(RouteStepComponent, {
      set: { template: '', imports: [] },
    });
  });

  it('lists routes without a status filter', () => {
    const cmp = TestBed.createComponent(RouteStepComponent).componentInstance;
    cmp.onModeChange('existing');

    expect(listSpy).toHaveBeenCalled();
    const arg = listSpy.calls.mostRecent().args[0];
    expect('status' in arg).toBeFalse();
    expect(cmp.routes().length).toBe(2);
  });

  it('ignores non-assignable routes and selects assignable ones', () => {
    const cmp = TestBed.createComponent(RouteStepComponent).componentInstance;
    cmp.onModeChange('existing');

    cmp.onPickRoute(closed);
    expect(wizardStub.selectedRouteId()).toBeNull();

    cmp.onPickRoute(draft);
    expect(wizardStub.selectedRouteId()).toBe(1);
  });
});
