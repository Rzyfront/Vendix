import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { Action } from '@ngrx/store';
import { Observable, Subject, of } from 'rxjs';

import { StoreUsersEffects } from './store-users.effects';
import * as StoreUsersActions from '../actions/store-users.actions';
import { initialStoreUsersState } from '../store-users.state';
import { StoreUsersManagementService } from '../../services/store-users-management.service';
import { StoreRolesService } from '../../../roles/services/store-roles.service';
import { ToastService } from '../../../../../../../shared/components/index';

/**
 * QUI-554 — Regresión del refresh post-mutación.
 *
 * El bug original no fue que `mutationSuccess$` estuviera mal escrito: estaba
 * bien y nunca se ejecutaba, porque el create modal hacía HTTP directo y
 * `createUserSuccess` no se emitía nunca. Este spec fija el contrato del
 * effect; el del create modal fija que la acción sí se despache.
 */
describe('StoreUsersEffects — mutationSuccess$ (QUI-554)', () => {
  let actions$: Subject<Action>;
  let effects: StoreUsersEffects;

  const usersServiceStub: Partial<StoreUsersManagementService> = {
    getUsers: () => of({ data: [], pagination: null }) as any,
    getStats: () => of(null) as any,
  };
  const rolesServiceStub: Partial<StoreRolesService> = {
    getRoles: () => of([]) as any,
  };
  const toastStub: Partial<ToastService> = {
    success: () => undefined as any,
    error: () => undefined as any,
  };

  beforeEach(() => {
    actions$ = new Subject<Action>();

    TestBed.configureTestingModule({
      providers: [
        StoreUsersEffects,
        provideMockActions(() => actions$ as Observable<Action>),
        provideMockStore({
          initialState: { storeUsers: initialStoreUsersState },
        }),
        { provide: StoreUsersManagementService, useValue: usersServiceStub },
        { provide: StoreRolesService, useValue: rolesServiceStub },
        { provide: ToastService, useValue: toastStub },
      ],
    });

    effects = TestBed.inject(StoreUsersEffects);
  });

  /** Recolecta lo que emite el effect mientras se despacha `trigger`. */
  function emissionsFor(trigger: Action): Action[] {
    const emitted: Action[] = [];
    const sub = effects.mutationSuccess$.subscribe((a) => emitted.push(a));
    actions$.next(trigger);
    sub.unsubscribe();
    return emitted;
  }

  it('recarga lista y stats tras createUserSuccess', () => {
    const emitted = emissionsFor(
      StoreUsersActions.createUserSuccess({ user: { id: 1 } as any }),
    );

    expect(emitted.map((a) => a.type)).toEqual([
      StoreUsersActions.loadUsers.type,
      StoreUsersActions.loadStats.type,
    ]);
  });

  it('recarga lista y stats tras updateUserSuccess', () => {
    const emitted = emissionsFor(
      StoreUsersActions.updateUserSuccess({ user: { id: 1 } as any }),
    );

    expect(emitted.map((a) => a.type)).toEqual([
      StoreUsersActions.loadUsers.type,
      StoreUsersActions.loadStats.type,
    ]);
  });

  it('recarga lista y stats tras desactivar y tras reactivar', () => {
    expect(
      emissionsFor(StoreUsersActions.deactivateUserSuccess()).map((a) => a.type),
    ).toEqual([
      StoreUsersActions.loadUsers.type,
      StoreUsersActions.loadStats.type,
    ]);

    expect(
      emissionsFor(StoreUsersActions.reactivateUserSuccess()).map((a) => a.type),
    ).toEqual([
      StoreUsersActions.loadUsers.type,
      StoreUsersActions.loadStats.type,
    ]);
  });

  it('no recarga con la acción de intención createUser (sólo con su success)', () => {
    const emitted = emissionsFor(
      StoreUsersActions.createUser({ user: {} as any }),
    );

    expect(emitted).toEqual([]);
  });
});
