import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Role, PaginatedRolesResponse } from '../interfaces/role.interface';

@Injectable({
  providedIn: 'root'
})
export class RolesService {

  private apiUrl = '/api/roles'; // TODO: use environment variable

  constructor(private http: HttpClient) { }

  getRoles(): Observable<PaginatedRolesResponse> {
    return this.http.get<PaginatedRolesResponse>(this.apiUrl);
  }

  getRoleById(id: number): Observable<Role> {
    return this.http.get<Role>(`${this.apiUrl}/${id}`);
  }

  createRole(role: any): Observable<Role> {
    return this.http.post<Role>(this.apiUrl, role);
  }

  updateRole(id: number, role: any): Observable<Role> {
    return this.http.patch<Role>(`${this.apiUrl}/${id}`, role);
  }

  deleteRole(id: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${id}`);
  }

  assignPermissionsToRole(roleId: number, permissionIds: number[]): Observable<Role> {
    return this.http.post<Role>(`${this.apiUrl}/${roleId}/permissions`, { permissionIds });
  }

  removePermissionsFromRole(roleId: number, permissionIds: number[]): Observable<Role> {
    return this.http.delete<Role>(`${this.apiUrl}/${roleId}/permissions`, { body: { permissionIds } });
  }

  assignRoleToUser(userId: number, roleId: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/assign-to-user`, { userId, roleId });
  }

  removeRoleFromUser(userId: number, roleId: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/remove-from-user`, { userId, roleId });
  }

  getUserRoles(userId: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/user/${userId}/roles`);
  }

  getUserPermissions(userId: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/user/${userId}/permissions`);
  }
}
