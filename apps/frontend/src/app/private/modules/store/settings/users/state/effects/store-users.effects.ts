import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, switchMap, catchError, withLatestFrom } from 'rxjs/operators';
import { ToastService } from '../../../../../../../shared/components/index';
import { StoreUsersManagementService } from '../../services/store-users-management.service';
import * as StoreUsersActions from '../actions/store-users.actions';
import { selectStoreUsersState } from '../selectors/store-users.selectors';

@Injectable()
export class StoreUsersEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private usersService = inject(StoreUsersManagementService);
  private toastService = inject(ToastService);

  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(StoreUsersActions.loadUsers),
      withLatestFrom(this.store.select(selectStoreUsersState)),
      switchMap(([, state]) =>
        this.usersService
          .getUsers({
            page: state.page,
            limit: state.limit,
            search: state.search || undefined,
            state: state.state_filter || undefined,
          })
          .pipe(
            map((response) =>
              StoreUsersActions.loadUsersSuccess({
                users: response.data,
                meta: response.pagination,
              }),
            ),
            catchError((error) =>
              of(
                StoreUsersActions.loadUsersFailure({
                  error: error.error?.message || 'Error loading users',
                }),
              ),
            ),
          ),
      ),
    ),
  );

  loadStats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(StoreUsersActions.loadStats),
      switchMap(() =>
        this.usersService.getStats().pipe(
          map((stats) => StoreUsersActions.loadStatsSuccess({ stats })),
          catchError((error) =>
            of(
              StoreUsersActions.loadStatsFailure({
                error: error.error?.message || 'Error loading stats',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  loadUserDetail$ = createEffect(() =>
    this.actions$.pipe(
      ofType(StoreUsersActions.loadUserDetail),
      switchMap(({ id }) =>
        this.usersService.getUserDetail(id).pipe(
          map((user) => StoreUsersActions.loadUserDetailSuccess({ user })),
          catchError((error) =>
            of(
              StoreUsersActions.loadUserDetailFailure({
                error: error.error?.message || 'Error loading user detail',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  createUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(StoreUsersActions.createUser),
      switchMap(({ user }) =>
        this.usersService.createUser(user).pipe(
          map((response) => {
            this.toastService.success('Usuario creado exitosamente');
            return StoreUsersActions.createUserSuccess({ user: response });
          }),
          catchError((error) => {
            this.toastService.error(error.error?.message || 'Error al crear usuario');
            return of(
              StoreUsersActions.createUserFailure({
                error: error.error?.message || 'Error creating user',
              }),
            );
          }),
        ),
      ),
    ),
  );

  updateUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(StoreUsersActions.updateUser),
      switchMap(({ id, user }) =>
        this.usersService.updateUser(id, user).pipe(
          map((response) => {
            this.toastService.success('Usuario actualizado exitosamente');
            return StoreUsersActions.updateUserSuccess({ user: response });
          }),
          catchError((error) => {
            this.toastService.error(error.error?.message || 'Error al actualizar usuario');
            return of(
              StoreUsersActions.updateUserFailure({
                error: error.error?.message || 'Error updating user',
              }),
            );
          }),
        ),
      ),
    ),
  );

  deactivateUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(StoreUsersActions.deactivateUser),
      switchMap(({ id }) =>
        this.usersService.deactivateUser(id).pipe(
          map(() => {
            this.toastService.success('Usuario desactivado exitosamente');
            return StoreUsersActions.deactivateUserSuccess();
          }),
          catchError((error) => {
            this.toastService.error(error.error?.message || 'Error al desactivar usuario');
            return of(
              StoreUsersActions.deactivateUserFailure({
                error: error.error?.message || 'Error',
              }),
            );
          }),
        ),
      ),
    ),
  );

  reactivateUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(StoreUsersActions.reactivateUser),
      switchMap(({ id }) =>
        this.usersService.reactivateUser(id).pipe(
          map(() => {
            this.toastService.success('Usuario reactivado exitosamente');
            return StoreUsersActions.reactivateUserSuccess();
          }),
          catchError((error) => {
            this.toastService.error(error.error?.message || 'Error al reactivar usuario');
            return of(
              StoreUsersActions.reactivateUserFailure({
                error: error.error?.message || 'Error',
              }),
            );
          }),
        ),
      ),
    ),
  );

  updateUserRoles$ = createEffect(() =>
    this.actions$.pipe(
      ofType(StoreUsersActions.updateUserRoles),
      switchMap(({ id, role_ids }) =>
        this.usersService.updateUserRoles(id, role_ids).pipe(
          map((user) => {
            this.toastService.success('Roles actualizados exitosamente');
            return StoreUsersActions.updateUserRolesSuccess({ user });
          }),
          catchError((error) => {
            this.toastService.error(error.error?.message || 'Error al actualizar roles');
            return of(
              StoreUsersActions.updateUserRolesFailure({
                error: error.error?.message || 'Error',
              }),
            );
          }),
        ),
      ),
    ),
  );

  updateUserPanelUI$ = createEffect(() =>
    this.actions$.pipe(
      ofType(StoreUsersActions.updateUserPanelUI),
      switchMap(({ id, panel_ui }) =>
        this.usersService.updateUserPanelUI(id, panel_ui).pipe(
          map((user) => {
            this.toastService.success('Configuracion de menu actualizada');
            return StoreUsersActions.updateUserPanelUISuccess({ user });
          }),
          catchError((error) => {
            this.toastService.error(error.error?.message || 'Error al actualizar panel UI');
            return of(
              StoreUsersActions.updateUserPanelUIFailure({
                error: error.error?.message || 'Error',
              }),
            );
          }),
        ),
      ),
    ),
  );

  resetPassword$ = createEffect(() =>
    this.actions$.pipe(
      ofType(StoreUsersActions.resetPassword),
      switchMap(({ id, new_password, confirm_password }) =>
        this.usersService.resetPassword(id, { new_password, confirm_password }).pipe(
          map(() => {
            this.toastService.success('Contrasena restablecida exitosamente');
            return StoreUsersActions.resetPasswordSuccess();
          }),
          catchError((error) => {
            this.toastService.error(error.error?.message || 'Error al restablecer contrasena');
            return of(
              StoreUsersActions.resetPasswordFailure({
                error: error.error?.message || 'Error',
              }),
            );
          }),
        ),
      ),
    ),
  );

  loadAvailableRoles$ = createEffect(() =>
    this.actions$.pipe(
      ofType(StoreUsersActions.loadAvailableRoles),
      switchMap(() =>
        this.usersService.getAvailableRoles().pipe(
          map((roles) => StoreUsersActions.loadAvailableRolesSuccess({ roles })),
          catchError((error) =>
            of(
              StoreUsersActions.loadAvailableRolesFailure({
                error: error.error?.message || 'Error loading roles',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // Reload after mutations
  mutationSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        StoreUsersActions.createUserSuccess,
        StoreUsersActions.updateUserSuccess,
        StoreUsersActions.deactivateUserSuccess,
        StoreUsersActions.reactivateUserSuccess,
      ),
      switchMap(() => [StoreUsersActions.loadUsers(), StoreUsersActions.loadStats()]),
    ),
  );

  // Filter changes reload
  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        StoreUsersActions.setSearch,
        StoreUsersActions.setPage,
        StoreUsersActions.setStateFilter,
      ),
      map(() => StoreUsersActions.loadUsers()),
    ),
  );
}
