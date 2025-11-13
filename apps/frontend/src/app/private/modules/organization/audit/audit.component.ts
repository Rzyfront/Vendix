import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-audit',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Audit & Compliance</h1>

      <!-- Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <a
          routerLink="/organization/audit/logs"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Audit Logs</h3>
          <p class="text-gray-600">View system audit logs</p>
        </a>

        <a
          routerLink="/organization/audit/compliance"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Compliance Reports</h3>
          <p class="text-gray-600">Compliance monitoring</p>
        </a>

        <a
          routerLink="/organization/audit/legal-docs"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Legal Documents</h3>
          <p class="text-gray-600">Manage legal documents</p>
        </a>

        <a
          routerLink="/organization/audit/backup"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Backup & Recovery</h3>
          <p class="text-gray-600">Data backup management</p>
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
export class AuditComponent {}
