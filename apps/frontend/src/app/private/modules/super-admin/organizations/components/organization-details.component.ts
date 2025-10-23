import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

import { OrganizationsService } from '../services/organizations.service';
import { Organization } from '../../../../../core/models/organization.model';

@Component({
  selector: 'app-organization-details',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-text-primary">Organization Details</h1>
          <p class="text-sm mt-1 text-text-secondary">
            View and manage organization information
          </p>
        </div>
        <div class="flex gap-3">
          <button
            class="px-4 py-2 rounded-lg font-medium border border-border text-text-primary hover:bg-gray-50"
            routerLink="/super-admin/organizations">
            <i class="fas fa-arrow-left mr-2"></i>
            Back to Organizations
          </button>
          <button
            class="px-4 py-2 rounded-lg text-white font-medium bg-primary hover:bg-primary/90"
            [routerLink]="['/super-admin/organizations', organization?.id, 'edit']">
            <i class="fas fa-edit mr-2"></i>
            Edit Organization
          </button>
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="isLoading" class="p-8 text-center">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <p class="mt-2 text-text-secondary">Loading organization details...</p>
      </div>

      <!-- Organization Details -->
      <div *ngIf="!isLoading && organization" class="space-y-6">
        <!-- Basic Information -->
        <div class="bg-white rounded-lg shadow-sm border border-border">
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold text-text-primary mb-4">Basic Information</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p class="text-sm font-medium text-text-secondary">Organization Name</p>
                <p class="text-text-primary">{{ organization.name }}</p>
              </div>
              <div>
                <p class="text-sm font-medium text-text-secondary">Email</p>
                <p class="text-text-primary">{{ organization.contact.email }}</p>
              </div>
              <div>
                <p class="text-sm font-medium text-text-secondary">Status</p>
                <span class="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  {{ organization.status }}
                </span>
              </div>
              <div>
                <p class="text-sm font-medium text-text-secondary">Created Date</p>
                <p class="text-text-primary">{{ organization.createdAt | date:'medium' }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Settings -->
        <div class="bg-white rounded-lg shadow-sm border border-border">
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold text-text-primary mb-4">Settings</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p class="text-sm font-medium text-text-secondary">Max Stores</p>
                <p class="text-text-primary">{{ organization.settings.maxStores }}</p>
              </div>
              <div>
                <p class="text-sm font-medium text-text-secondary">Max Users</p>
                <p class="text-text-primary">{{ organization.settings.maxUsers }}</p>
              </div>
              <div>
                <p class="text-sm font-medium text-text-secondary">Allow Public Store</p>
                <p class="text-text-primary">{{ organization.settings.allowPublicStore ? 'Yes' : 'No' }}</p>
              </div>
              <div>
                <p class="text-sm font-medium text-text-secondary">Allow Multiple Stores</p>
                <p class="text-text-primary">{{ organization.settings.allowMultipleStores ? 'Yes' : 'No' }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Contact Information -->
        <div class="bg-white rounded-lg shadow-sm border border-border">
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold text-text-primary mb-4">Contact Information</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p class="text-sm font-medium text-text-secondary">Email</p>
                <p class="text-text-primary">{{ organization.contact.email }}</p>
              </div>
              <div>
                <p class="text-sm font-medium text-text-secondary">Phone</p>
                <p class="text-text-primary">{{ organization.contact.phone || 'Not provided' }}</p>
              </div>
            </div>
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
export class OrganizationDetailsComponent implements OnInit {
  organization: Organization | null = null;
  isLoading = false;
  private subscriptions: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private organizationsService: OrganizationsService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadOrganizationDetails(+id);
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  loadOrganizationDetails(id: number): void {
    this.isLoading = true;

    const sub = this.organizationsService.getOrganizationById(id).subscribe({
      next: (response) => {
        if (response.success) {
          this.organization = response.data;
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading organization details:', error);
        this.isLoading = false;
      }
    });

    this.subscriptions.push(sub);
  }
}