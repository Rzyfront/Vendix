import { Routes } from '@angular/router';

export const DUNNING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./dunning-board.component').then((m) => m.DunningBoardComponent),
  },
];
