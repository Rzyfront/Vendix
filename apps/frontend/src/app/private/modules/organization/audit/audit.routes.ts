import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuditComponent } from './audit.component';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'logs',
    pathMatch: 'full',
  },
  {
    path: 'logs',
    loadComponent: () =>
      import('./logs/logs.component').then((m) => m.LogsComponent),
  },
  {
    path: 'login-attempts',
    loadComponent: () =>
      import('./login-attempts/login-attempts.component').then((m) => m.LoginAttemptsComponent),
  },
  {
    path: 'sessions',
    loadComponent: () =>
      import('./sessions/sessions.component').then((m) => m.SessionsComponent),
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AuditRoutingModule {}
