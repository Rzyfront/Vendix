import { Routes } from '@angular/router';
import { SupportComponent } from './support.component';
import { SuperadminTicketDetailComponent } from './components/superadmin-ticket-detail/superadmin-ticket-detail.component';
import { SuperadminPqrsComponent } from './pqrs.component';
import { SuperadminPqrDetailComponent } from './components/superadmin-pqr-detail/superadmin-pqr-detail.component';

export const SUPPORT_ROUTES: Routes = [
  // Redirect the bare /super-admin/support URL to the explicit tickets
  // subroute. Why: Angular's `routerLinkActive` does prefix matching by
  // default, so a Tickets item with `routerLink="/super-admin/support"`
  // would stay highlighted when navigating to `/super-admin/support/pqrs`
  // (sibling route). By making Tickets and PQRs symmetric siblings —
  // `/tickets` and `/pqrs` — neither route's prefix matches the other,
  // and only the actual active item is highlighted in the sidebar.
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'tickets',
  },
  {
    path: 'tickets',
    component: SupportComponent,
  },
  {
    path: 'tickets/:id',
    component: SuperadminTicketDetailComponent,
  },
  // Global PQR oversight (Peticiones / Quejas / Reclamos). Separate from
  // Soporte/Tickets to keep the two domains visually distinct — the
  // support view filters PQRs out (see superadmin/support/support.service.ts
  // findAll comment).
  {
    path: 'pqrs',
    component: SuperadminPqrsComponent,
  },
  // Read-only PQR detail for compliance oversight. Mutation endpoints
  // (status change / comments / assignment) are intentionally NOT
  // exposed to super-admin — response work happens at the store-admin
  // level. The component reads only, and surfaces the owning org /
  // store + SLA legal status + status history.
  {
    path: 'pqrs/:id',
    component: SuperadminPqrDetailComponent,
  },
];
