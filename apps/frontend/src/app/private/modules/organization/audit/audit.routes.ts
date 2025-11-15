import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuditComponent } from './audit.component';

const routes: Routes = [
  {
    path: '',
    component: AuditComponent,
    children: [
      {
        path: 'logs',
        loadComponent: () =>
          import('./logs/logs.component').then((m) => m.LogsComponent),
      },
      {
        path: 'compliance',
        loadComponent: () =>
          import('./compliance/compliance.component').then(
            (m) => m.ComplianceComponent,
          ),
      },
      {
        path: 'legal-docs',
        loadComponent: () =>
          import('./legal-docs/legal-docs.component').then(
            (m) => m.LegalDocsComponent,
          ),
      },
      {
        path: 'backup',
        loadComponent: () =>
          import('./backup/backup.component').then((m) => m.BackupComponent),
      },
      {
        path: '',
        redirectTo: 'logs',
        pathMatch: 'full',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AuditRoutingModule {}
