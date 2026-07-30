import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { Action } from '@ngrx/store';
import { Observable, Subject } from 'rxjs';

import { StoreUserCreateModalComponent } from './store-user-create-modal.component';
import * as StoreUsersActions from '../state/actions/store-users.actions';
import { initialStoreUsersState } from '../state/store-users.state';

/**
 * QUI-554 — Regresión de la causa raíz.
 *
 * El modal llamaba `StoreUsersManagementService.createUser()` por HTTP directo,
 * así que la acción nunca se despachaba y el effect `mutationSuccess$` no
 * recargaba la lista. Estos casos fallan si alguien reintroduce ese atajo:
 * el submit debe producir UNA acción `createUser` y CERO peticiones HTTP.
 */
describe('StoreUserCreateModalComponent (QUI-554)', () => {
  let component: StoreUserCreateModalComponent;
  let store: MockStore;
  let httpMock: HttpTestingController;
  let actions$: Subject<Action>;

  const validUser = {
    first_name: 'Qui554',
    last_name: 'Spec',
    username: '',
    email: 'qui554.spec@roku.test',
    password: 'Repro554@x',
  };

  beforeEach(() => {
    actions$ = new Subject<Action>();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({
          initialState: { storeUsers: initialStoreUsersState },
        }),
        provideMockActions(() => actions$ as Observable<Action>),
      ],
    });

    store = TestBed.inject(MockStore);
    httpMock = TestBed.inject(HttpTestingController);

    component = TestBed.runInInjectionContext(
      () => new StoreUserCreateModalComponent(TestBed.inject(FormBuilder)),
    );
  });

  afterEach(() => {
    // Ninguna prueba de este spec debe generar tráfico HTTP desde el componente.
    httpMock.verify();
  });

  it('despacha createUser en un submit válido y no hace ninguna petición HTTP', () => {
    const dispatch = spyOn(store, 'dispatch');
    component.userForm.setValue(validUser);

    component.onSubmit();

    expect(dispatch).toHaveBeenCalledTimes(1);
    const dispatched = dispatch.calls.mostRecent().args[0] as any;
    expect(dispatched.type).toBe(StoreUsersActions.createUser.type);
    // `username` vacío no viaja en el payload.
    expect(dispatched.user).toEqual({
      first_name: validUser.first_name,
      last_name: validUser.last_name,
      email: validUser.email,
      password: validUser.password,
    });
    httpMock.expectNone(() => true);
  });

  it('no despacha nada si el formulario es inválido', () => {
    const dispatch = spyOn(store, 'dispatch');
    component.userForm.setValue({ ...validUser, email: 'no-es-un-email' });

    component.onSubmit();

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('cierra y avisa al padre sólo cuando llega createUserSuccess', () => {
    let notified = 0;
    component.onUserCreated.subscribe(() => notified++);
    component.isOpen.set(true);
    component.userForm.setValue(validUser);

    component.onSubmit();
    // Aún sin respuesta del effect: el modal sigue abierto.
    expect(component.isOpen()).toBeTrue();
    expect(notified).toBe(0);

    actions$.next(
      StoreUsersActions.createUserSuccess({ user: { id: 1 } as any }),
    );

    expect(component.isOpen()).toBeFalse();
    expect(notified).toBe(1);
    expect(component.userForm.get('email')?.value).toBeFalsy();
  });

  it('ante createUserFailure deja el modal abierto y conserva lo tecleado', () => {
    component.isOpen.set(true);
    component.userForm.setValue(validUser);

    component.onSubmit();
    actions$.next(StoreUsersActions.createUserFailure({ error: 'duplicado' }));

    expect(component.isOpen()).toBeTrue();
    expect(component.userForm.get('email')?.value).toBe(validUser.email);
    expect(component.userForm.get('password')?.value).toBe(validUser.password);
  });
});
