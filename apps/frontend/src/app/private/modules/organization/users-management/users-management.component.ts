import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-users-management',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">User Management</h1>

      <!-- Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <a
          routerLink="/organization/users/global-users"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Global Users</h3>
          <p class="text-gray-600">Manage organization users</p>
        </a>

        <a
          routerLink="/organization/users/roles-permissions"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Roles & Permissions</h3>
          <p class="text-gray-600">Configure user roles</p>
        </a>

        <a
          routerLink="/organization/users/store-assignments"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Store Assignments</h3>
          <p class="text-gray-600">Assign users to stores</p>
        </a>

        <a
          routerLink="/organization/users/access-audit"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Access Audit</h3>
          <p class="text-gray-600">View access logs</p>
        </a>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class UsersManagementComponent {}
