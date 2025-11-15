import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-roles-permissions',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Roles & Permissions</h1>

      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-gray-600">
          Role and permission management will be displayed here
        </p>
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
export class RolesPermissionsComponent {}
