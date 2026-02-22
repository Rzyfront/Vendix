import { Routes } from '@angular/router';
import { SupportComponent } from './support.component';
import { SuperadminTicketDetailComponent } from './components/superadmin-ticket-detail/superadmin-ticket-detail.component';

export const SUPPORT_ROUTES: Routes = [
  {
    path: '',
    component: SupportComponent,
    pathMatch: 'full',
  },
  {
    path: 'tickets/:id',
    component: SuperadminTicketDetailComponent,
  },
];
