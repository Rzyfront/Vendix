import { Routes } from '@angular/router';

export const CONSULTATIONS_ROUTES: Routes = [
  {
    path: ':bookingId/attend',
    loadComponent: () =>
      import('./consultation-attend/consultation-attend.component').then(c => c.ConsultationAttendComponent),
  },
];
