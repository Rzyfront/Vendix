import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { expensesReducer } from './state/reducers/expenses.reducer';
import { ExpensesEffects } from './state/effects/expenses.effects';

export const expensesRoutes: Routes = [
    {
        path: '',
        providers: [
            provideState({ name: 'expenses', reducer: expensesReducer }),
            provideEffects(ExpensesEffects),
        ],
        children: [
            {
                path: '',
                pathMatch: 'full',
                loadComponent: () =>
                    import('./expenses.component').then((c) => c.ExpensesComponent),
            },
        ],
    },
];
