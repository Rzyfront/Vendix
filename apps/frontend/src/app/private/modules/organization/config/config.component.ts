import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Organization Configuration</h1>

      <!-- Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <a
          routerLink="/organization/config/application"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Application Settings</h3>
          <p class="text-gray-600">General application configuration</p>
        </a>

        <a
          routerLink="/organization/config/policies"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Policies</h3>
          <p class="text-gray-600">Organizational policies and rules</p>
        </a>

        <a
          routerLink="/organization/config/integrations"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Integrations</h3>
          <p class="text-gray-600">Third-party integrations</p>
        </a>

        <a
          routerLink="/organization/config/taxes"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Taxes</h3>
          <p class="text-gray-600">Tax configuration and rates</p>
        </a>

        <a
          routerLink="/organization/config/domains"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Domains</h3>
          <p class="text-gray-600">Domain management</p>
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
export class ConfigComponent {}
