import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { promotionsReducer } from './state/reducers/promotions.reducer';
import { PromotionsEffects } from './state/effects/promotions.effects';

export const promotionsRoutes: Routes = [
  {
    path: '',
    providers: [
      provideState({ name: 'promotions', reducer: promotionsReducer }),
      provideEffects(PromotionsEffects),
    ],
    loadComponent: () =>
      import('./promotions.component').then((c) => c.PromotionsComponent),
  },
];
