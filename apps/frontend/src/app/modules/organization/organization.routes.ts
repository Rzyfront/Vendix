import { Routes } from '@angular/router';
import { Component } from '@angular/core';

// Placeholder component for organization routes
@Component({
  selector: 'app-organization-placeholder',
  standalone: true,
  template: `
    <div class="min-h-screen bg-background p-8">
      <div class="max-w-4xl mx-auto">
        <h1 class="text-3xl font-bold text-text mb-6">Organization Dashboard</h1>
        <p class="text-text-secondary">Organization management functionality will be implemented in future updates.</p>
      </div>
    </div>
  `
})
export class OrganizationPlaceholderComponent {}

export const organizationRoutes: Routes = [
  {
    path: '',
    component: OrganizationPlaceholderComponent
  },
  {
    path: '**',
    redirectTo: ''
  }
];
