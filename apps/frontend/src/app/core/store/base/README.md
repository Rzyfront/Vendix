# Base Feature Store

Esta carpeta contiene la implementación base de NgRx que puede ser utilizada por cualquier módulo para crear su propio feature store de manera consistente.

## 📁 Estructura

```
base/
├── base.actions.ts      # Acciones genéricas CRUD
├── base.reducer.ts      # Reducer base con estado genérico
├── base.effects.ts      # Efectos base con logging
├── base.selectors.ts    # Selectores base y factory functions
├── base.facade.ts       # Facade base para componentes
├── index.ts            # Exports
└── README.md           # Este archivo
```

## 🚀 Uso

### 1. Crear un Feature Store

```typescript
// my-feature.actions.ts
import { createAction, props } from '@ngrx/store';
import * as BaseActions from '../base';

export const loadUsers = createAction(
  '[Users] Load Users',
  props<{ page?: number; limit?: number }>()
);

export const loadUsersSuccess = createAction(
  '[Users] Load Users Success',
  props<{ users: User[]; total: number }>()
);

// Extender acciones base
export const { loadData, createData, updateData, deleteData } = BaseActions;
```

### 2. Crear el Reducer

```typescript
// my-feature.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { createBaseReducer, BaseState } from '../base';
import * as MyFeatureActions from './my-feature.actions';

export interface MyFeatureState extends BaseState<User[]> {
  total: number;
  currentPage: number;
}

export const initialState: MyFeatureState = {
  ...initialBaseState,
  total: 0,
  currentPage: 1
};

export const myFeatureReducer = createReducer(
  initialState,

  // Usar reducer base
  ...createBaseReducer('myFeature'),

  // Añadir reducers específicos
  on(MyFeatureActions.loadUsers, (state) => ({
    ...state,
    loading: true
  })),

  on(MyFeatureActions.loadUsersSuccess, (state, { users, total }) => ({
    ...state,
    data: users,
    total,
    loading: false,
    error: null
  }))
);
```

### 3. Crear Effects

```typescript
// my-feature.effects.ts
import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { map, mergeMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { BaseEffects } from '../base';
import { MyFeatureService } from '../../services/my-feature.service';
import * as MyFeatureActions from './my-feature.actions';

@Injectable()
export class MyFeatureEffects extends BaseEffects {
  private myFeatureService = inject(MyFeatureService);

  // Override base effects
  override loadData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(MyFeatureActions.loadUsers),
      mergeMap(({ page = 1, limit = 10 }) =>
        this.myFeatureService.getUsers({ page, limit }).pipe(
          map(({ users, total }) =>
            MyFeatureActions.loadUsersSuccess({ users, total })
          ),
          catchError((error) =>
            of(MyFeatureActions.loadDataFailure({ error }))
          )
        )
      )
    )
  );

  // Añadir effects específicos
  createUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(MyFeatureActions.createData),
      mergeMap(({ data }) =>
        this.myFeatureService.createUser(data).pipe(
          map((user) => MyFeatureActions.createDataSuccess({ data: user })),
          catchError((error) => of(MyFeatureActions.createDataFailure({ error })))
        )
      )
    )
  );
}
```

### 4. Crear Selectors

```typescript
// my-feature.selectors.ts
import { createBaseSelectors } from '../base';
import { MyFeatureState } from './my-feature.reducer';

const baseSelectors = createBaseSelectors<MyFeatureState>('myFeature');

// Selectors específicos
export const selectUsers = createSelector(
  baseSelectors.selectData,
  (users) => users || []
);

export const selectTotalUsers = createSelector(
  (state: any) => state.myFeature.total,
  (total) => total
);

export const selectCurrentPage = createSelector(
  (state: any) => state.myFeature.currentPage,
  (page) => page
);
```

### 5. Crear Facade

```typescript
// my-feature.facade.ts
import { Injectable } from '@angular/core';
import { BaseFacade } from '../base';
import { MyFeatureState } from './my-feature.reducer';
import * as MyFeatureActions from './my-feature.actions';
import * as MyFeatureSelectors from './my-feature.selectors';

@Injectable({
  providedIn: 'root'
})
export class MyFeatureFacade extends BaseFacade<User[]> {
  // Override selectors
  override data$ = this.store.select(MyFeatureSelectors.selectUsers);
  readonly total$ = this.store.select(MyFeatureSelectors.selectTotalUsers);
  readonly currentPage$ = this.store.select(MyFeatureSelectors.selectCurrentPage);

  // Métodos específicos
  loadUsers(page = 1, limit = 10): void {
    this.store.dispatch(MyFeatureActions.loadUsers({ page, limit }));
  }

  createUser(user: Partial<User>): void {
    this.store.dispatch(MyFeatureActions.createData({ data: user }));
  }
}
```

### 6. Registrar en el Módulo

```typescript
// my-feature.routes.ts
import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';

export const myFeatureRoutes: Routes = [
  {
    path: '',
    providers: [
      provideState('myFeature', myFeatureReducer),
      provideEffects([MyFeatureEffects])
    ],
    loadComponent: () => import('./my-feature.component')
  }
];
```

## ✅ Beneficios

- **Consistencia**: Todos los módulos siguen el mismo patrón
- **Reutilización**: Código base compartido
- **Mantenibilidad**: Cambios en la base afectan todos los módulos
- **Type Safety**: Interfaces y tipos consistentes
- **Testing**: Base de pruebas incluida

## 📋 Checklist para Nuevo Feature Store

- [ ] Crear carpeta `store/` en el módulo
- [ ] Implementar actions específicas
- [ ] Crear reducer usando `createBaseReducer`
- [ ] Implementar effects extendiendo `BaseEffects`
- [ ] Crear selectors usando `createBaseSelectors`
- [ ] Implementar facade extendiendo `BaseFacade`
- [ ] Registrar en rutas con `provideState` y `provideEffects`
- [ ] Añadir tests unitarios
- [ ] Actualizar documentación del módulo