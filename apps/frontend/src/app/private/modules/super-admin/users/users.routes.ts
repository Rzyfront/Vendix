
import { Route } from '@angular/router';
import { UsersComponent } from './users.component';
import { UserRolesComponent } from './user-roles.component';
import { PermissionsComponent } from './permissions.component';

export const USERS_ROUTES: Route[] = [
  {
    path: '',
    component: UsersComponent
  },
  {
    path: 'roles',
    component: UserRolesComponent
  },
  {
    path: 'permissions',
    component: PermissionsComponent
  }
];
