import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UsersManagementComponent } from './users-management.component';

const routes: Routes = [
  {
    path: '',
    component: UsersManagementComponent,
    children: [
      {
        path: 'global-users',
        loadComponent: () =>
          import('./global-users/global-users.component').then(
            (m) => m.GlobalUsersComponent,
          ),
      },
      {
        path: 'roles-permissions',
        loadComponent: () =>
          import('./roles-permissions/roles-permissions.component').then(
            (m) => m.RolesPermissionsComponent,
          ),
      },
      {
        path: 'store-assignments',
        loadComponent: () =>
          import('./store-assignments/store-assignments.component').then(
            (m) => m.StoreAssignmentsComponent,
          ),
      },
      {
        path: 'access-audit',
        loadComponent: () =>
          import('./access-audit/access-audit.component').then(
            (m) => m.AccessAuditComponent,
          ),
      },
      {
        path: '',
        redirectTo: 'global-users',
        pathMatch: 'full',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UsersManagementRoutingModule {}
