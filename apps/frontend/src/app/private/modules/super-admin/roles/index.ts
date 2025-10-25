// Components
export { RolesComponent } from './roles.component';
export { EditRoleModalComponent } from './components/edit-role-modal/edit-role-modal.component';
export { DeleteRoleModalComponent } from './components/delete-role-modal/delete-role-modal.component';
export { RolePermissionsModalComponent } from './components/role-permissions-modal/role-permissions-modal.component';
export { RoleStatsComponent } from './components/role-stats/role-stats.component';
export { RoleEmptyStateComponent } from './components/role-empty-state.component';

// Services
export { RolesService } from './services/roles.service';

// Interfaces
export type {
  Role,
  PaginatedRolesResponse
} from './interfaces/role.interface';