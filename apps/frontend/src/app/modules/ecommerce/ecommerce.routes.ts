import { Routes } from '@angular/router';
import { Component } from '@angular/core';

// Placeholder component for ecommerce routes
@Component({
  selector: 'app-ecommerce-placeholder',
  standalone: true,
  template: `
    <div class="min-h-screen bg-background p-8">
      <div class="max-w-4xl mx-auto">
        <h1 class="text-3xl font-bold text-text mb-6">E-commerce Dashboard</h1>
        <p class="text-text-secondary">E-commerce management functionality will be implemented in future updates.</p>
      </div>
    </div>
  `
})
export class EcommercePlaceholderComponent {}

export const ecommerceRoutes: Routes = [
  {
    path: '',
    component: EcommercePlaceholderComponent
  },
  {
    path: '**',
    redirectTo: ''
  }
];
