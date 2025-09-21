import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Role {
  id: number;
  name: string;
  description?: string;
  is_system_role: boolean;
  created_at: string;
  updated_at: string;
  role_permissions: Array<{
    id: number;
    role_id: number;
    permission_id: number;
    permissions: {
      id: number;
      name: string;
      description?: string;
      resource: string;
      action: string;
      created_at: string;
      updated_at: string;
    };
  }>;
}

export interface Permission {
  id: number;
  name: string;
  description?: string;
  resource: string;
  action: string;
  created_at: string;
  updated_at: string;
}

export interface CreateRoleDto {
  name: string;
  description?: string;
  is_system_role?: boolean;
}

export interface UpdateRoleDto {
  name?: string;
  description?: string;
}

export interface AssignPermissionsDto {
  permissionIds: number[];
}

export interface AssignRoleToUserDto {
  userId: number;
  roleId: number;
}

export interface RolesListResponse {
  data: Role[];
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface PermissionsListResponse {
  data: Permission[];
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable({
  providedIn: 'root'
})
export class RoleService {
  private readonly API_URL = `${environment.apiUrl}/api`;
  private readonly ROLES_URL = `${this.API_URL}/roles`;
  private readonly PERMISSIONS_URL = `${this.API_URL}/permissions`;

  constructor(private http: HttpClient) {}

  // Role CRUD operations
  createRole(roleData: CreateRoleDto): Observable<Role> {
    return this.http.post<Role>(this.ROLES_URL, roleData);
  }

  getRoles(): Observable<RolesListResponse> {
    return this.http.get<RolesListResponse>(this.ROLES_URL);
  }

  getRole(roleId: number): Observable<Role> {
    return this.http.get<Role>(`${this.ROLES_URL}/${roleId}`);
  }

  updateRole(roleId: number, roleData: UpdateRoleDto): Observable<Role> {
    return this.http.patch<Role>(`${this.ROLES_URL}/${roleId}`, roleData);
  }

  deleteRole(roleId: number): Observable<any> {
    return this.http.delete(`${this.ROLES_URL}/${roleId}`);
  }

  // Permission management for roles
  assignPermissionsToRole(roleId: number, data: AssignPermissionsDto): Observable<any> {
    return this.http.post(`${this.ROLES_URL}/${roleId}/permissions`, data);
  }

  removePermissionsFromRole(roleId: number, data: AssignPermissionsDto): Observable<any> {
    return this.http.delete(`${this.ROLES_URL}/${roleId}/permissions`, { body: data });
  }

  // User-Role assignment
  assignRoleToUser(data: AssignRoleToUserDto): Observable<any> {
    return this.http.post(`${this.ROLES_URL}/assign-to-user`, data);
  }

  removeRoleFromUser(data: AssignRoleToUserDto): Observable<any> {
    return this.http.post(`${this.ROLES_URL}/remove-from-user`, data);
  }

  getUserRoles(userId: number): Observable<any> {
    return this.http.get(`${this.ROLES_URL}/user/${userId}/roles`);
  }

  getUserPermissions(userId: number): Observable<any> {
    return this.http.get(`${this.ROLES_URL}/user/${userId}/permissions`);
  }

  // Permissions (if there's a separate permissions endpoint)
  getPermissions(): Observable<PermissionsListResponse> {
    return this.http.get<PermissionsListResponse>(this.PERMISSIONS_URL);
  }
}