import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-organization-settings',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-text-primary">Organization Settings</h1>
          <p class="text-sm mt-1 text-text-secondary">
            Configure global organization settings
          </p>
        </div>
        <button
          class="px-4 py-2 rounded-lg font-medium border border-border text-text-primary hover:bg-gray-50"
          routerLink="/super-admin/organizations">
          <i class="fas fa-arrow-left mr-2"></i>
          Back to Organizations
        </button>
      </div>

      <!-- Settings Content -->
      <div class="bg-white rounded-lg shadow-sm border border-border">
        <div class="p-6">
          <div class="text-center py-8">
            <div class="w-16 h-16 mx-auto mb-4 rounded-lg flex items-center justify-center bg-gray-100">
              <i class="fas fa-cog text-2xl text-text-muted"></i>
            </div>
            <h3 class="text-lg font-semibold mb-2 text-text-primary">Organization Settings</h3>
            <p class="text-sm mb-4 text-text-secondary">
              Global organization settings and configurations will be available here.
            </p>
            <p class="text-sm text-text-muted">
              This page is under development and will include features like:
            </p>
            <ul class="text-sm text-text-muted mt-2 list-disc list-inside">
              <li>Default organization templates</li>
              <li>Global feature toggles</li>
              <li>Billing and subscription settings</li>
              <li>Security policies</li>
              <li>Integration configurations</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class OrganizationSettingsComponent implements OnInit {
  constructor() { }

  ngOnInit(): void {
    // TODO: Load organization settings
  }
}