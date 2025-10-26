import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomainStats } from '../interfaces/domain.interface';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-domain-stats',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="space-y-6">
      <!-- Primary Stats - Total and Status -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <!-- Total Domains -->
        <div
          class="bg-surface rounded-card shadow-card border border-border p-4"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-secondary">
                Total Domains
              </p>
              <p class="text-2xl font-bold mt-1 text-text-primary">
                {{ stats.total_domains }}
              </p>
            </div>
            <div
              class="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/10"
            >
              <app-icon
                name="globe-2"
                [size]="24"
                class="text-primary"
              ></app-icon>
            </div>
          </div>
        </div>

        <!-- Active Domains -->
        <div
          class="bg-surface rounded-card shadow-card border border-border p-4"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-secondary">Active</p>
              <p class="text-2xl font-bold mt-1 text-green-600">
                {{ stats.active_domains }}
              </p>
            </div>
            <div
              class="w-12 h-12 rounded-lg flex items-center justify-center bg-green-100"
            >
              <app-icon
                name="check-circle"
                [size]="24"
                class="text-green-600"
              ></app-icon>
            </div>
          </div>
        </div>

        <!-- Pending Domains -->
        <div
          class="bg-surface rounded-card shadow-card border border-border p-4"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-secondary">Pending</p>
              <p class="text-2xl font-bold mt-1 text-yellow-600">
                {{ stats.pending_domains }}
              </p>
            </div>
            <div
              class="w-12 h-12 rounded-lg flex items-center justify-center bg-yellow-100"
            >
              <app-icon
                name="clock"
                [size]="24"
                class="text-yellow-600"
              ></app-icon>
            </div>
          </div>
        </div>

        <!-- Verified Domains -->
        <div
          class="bg-surface rounded-card shadow-card border border-border p-4"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-secondary">Verified</p>
              <p class="text-2xl font-bold mt-1 text-blue-600">
                {{ stats.verified_domains }}
              </p>
            </div>
            <div
              class="w-12 h-12 rounded-lg flex items-center justify-center bg-blue-100"
            >
              <app-icon
                name="shield-check"
                [size]="24"
                class="text-blue-600"
              ></app-icon>
            </div>
          </div>
        </div>
      </div>

      <!-- Ownership Stats -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <!-- Platform Subdomains -->
        <div
          class="bg-surface rounded-card shadow-card border border-border p-4"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-secondary">
                Platform Subdomains
              </p>
              <p class="text-2xl font-bold mt-1 text-text-primary">
                {{ stats.vendix_subdomains || stats.primary_domains }}
              </p>
            </div>
            <div
              class="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/10"
            >
              <app-icon
                name="globe-2"
                [size]="24"
                class="text-primary"
              ></app-icon>
            </div>
          </div>
        </div>

        <!-- Custom Domains -->
        <div
          class="bg-surface rounded-card shadow-card border border-border p-4"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-secondary">
                Custom Domains
              </p>
              <p class="text-2xl font-bold mt-1 text-purple-600">
                {{ stats.customer_custom_domains || stats.customer_domains }}
              </p>
            </div>
            <div
              class="w-12 h-12 rounded-lg flex items-center justify-center bg-purple-100"
            >
              <app-icon
                name="link-2"
                [size]="24"
                class="text-purple-600"
              ></app-icon>
            </div>
          </div>
        </div>

        <!-- Client Subdomains -->
        <div
          class="bg-surface rounded-card shadow-card border border-border p-4"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-secondary">
                Client Subdomains
              </p>
              <p class="text-2xl font-bold mt-1 text-indigo-600">
                {{ stats.customer_subdomains || stats.alias_domains }}
              </p>
            </div>
            <div
              class="w-12 h-12 rounded-lg flex items-center justify-center bg-indigo-100"
            >
              <app-icon
                name="database"
                [size]="24"
                class="text-indigo-600"
              ></app-icon>
            </div>
          </div>
        </div>

        <!-- Alias Domains -->
        <div
          class="bg-surface rounded-card shadow-card border border-border p-4"
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-text-secondary">
                Alias Domains
              </p>
              <p class="text-2xl font-bold mt-1 text-orange-600">
                {{ stats.alias_domains }}
              </p>
            </div>
            <div
              class="w-12 h-12 rounded-lg flex items-center justify-center bg-orange-100"
            >
              <app-icon
                name="link-2"
                [size]="24"
                class="text-orange-600"
              ></app-icon>
            </div>
          </div>
        </div>
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
export class DomainStatsComponent {
  @Input({ required: true }) stats!: DomainStats;
}
