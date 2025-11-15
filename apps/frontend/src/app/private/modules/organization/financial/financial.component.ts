import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-financial',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Financial Management</h1>

      <!-- Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <a
          routerLink="/organization/financial/reports"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Reports</h3>
          <p class="text-gray-600">View financial reports and analytics</p>
        </a>

        <a
          routerLink="/organization/financial/billing"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Billing & Subscriptions</h3>
          <p class="text-gray-600">Manage invoices and subscriptions</p>
        </a>

        <a
          routerLink="/organization/financial/cost-analysis"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Cost Analysis</h3>
          <p class="text-gray-600">Analyze costs and margins</p>
        </a>

        <a
          routerLink="/organization/financial/cash-flow"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Cash Flow</h3>
          <p class="text-gray-600">Monitor organizational cash flow</p>
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
export class FinancialComponent {}
