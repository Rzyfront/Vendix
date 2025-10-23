import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { OrganizationsService } from './services/organizations.service';
import { OrganizationListItem } from './interfaces/organization.interface';
import { Organization } from '../../../../core/models/organization.model';

// Import new components
import {
  OrganizationStatsComponent,
  OrganizationFiltersComponent,
  OrganizationCardComponent,
  OrganizationPaginationComponent,
  OrganizationEmptyStateComponent
} from './index';

// Import styles (CSS instead of SCSS to avoid loader issues)
import './organizations.component.css';

@Component({
  selector: 'app-organizations',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    OrganizationStatsComponent,
    OrganizationFiltersComponent,
    OrganizationCardComponent,
    OrganizationPaginationComponent,
    OrganizationEmptyStateComponent
  ],
  providers: [OrganizationsService],
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex justify-between items-center">
        <div>
          <h1 class="text-2xl font-bold text-text-primary">Organizations Management</h1>
          <p class="text-sm mt-1 text-text-secondary">
            Manage all organizations in the platform
          </p>
        </div>
        <div class="flex gap-3">
          <button
            class="px-4 py-2 rounded-lg font-medium border border-border text-text-primary hover:bg-gray-50 disabled:opacity-50"
            (click)="refreshOrganizations()"
            [disabled]="isLoading">
            <i class="fas fa-sync-alt mr-2"></i>
            Refresh
          </button>
          <button
            class="px-4 py-2 rounded-lg text-white font-medium bg-primary hover:bg-primary/90"
            routerLink="/super-admin/organizations/create">
            <i class="fas fa-plus mr-2"></i>
            Add Organization
          </button>
        </div>
      </div>

      <!-- Stats Cards -->
      <app-organization-stats [stats]="stats"></app-organization-stats>

      <!-- Filters and Search -->
      <app-organization-filters
        [searchTerm]="searchTerm"
        [selectedStatus]="selectedStatus"
        (searchChange)="onSearchChange($event)"
        (statusFilterChange)="onStatusFilterChange($event)"
        (filtersCleared)="onFiltersCleared()">
      </app-organization-filters>

      <!-- Organizations List -->
      <div class="bg-white rounded-lg shadow-sm border border-border">
        <div class="px-6 py-4 border-b border-border">
          <div class="flex justify-between items-center">
            <h2 class="text-lg font-semibold text-text-primary">
              All Organizations ({{ pagination.total }})
            </h2>
            <div class="flex items-center gap-2">
              <span class="text-sm text-text-secondary">
                Page {{ pagination.page }} of {{ pagination.totalPages }}
              </span>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="isLoading" class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Loading organizations...</p>
        </div>

        <!-- Empty State -->
        <app-organization-empty-state
          *ngIf="!isLoading && organizations.length === 0"
          [title]="getEmptyStateTitle()"
          [description]="getEmptyStateDescription()">
        </app-organization-empty-state>

        <!-- Organizations Grid -->
        <div *ngIf="!isLoading && organizations.length > 0" class="p-6">
          <div class="space-y-4">
            <app-organization-card
              *ngFor="let org of organizations"
              [organization]="org"
              (cardClick)="viewOrganization(org)"
              (view)="viewOrganization(org)"
              (edit)="editOrganization(org)"
              (delete)="deleteOrganization(org)">
            </app-organization-card>
          </div>

          <!-- Pagination -->
          <app-organization-pagination
            [pagination]="pagination"
            (pageChange)="changePage($event)">
          </app-organization-pagination>
        </div>
      </div>
    </div>
  `
})
export class OrganizationsComponent implements OnInit, OnDestroy {
  organizations: OrganizationListItem[] = [];
  isLoading = false;
  searchTerm = '';
  selectedStatus = '';

  stats = {
    total: 0,
    active: 0,
    inactive: 0,
    suspended: 0
  };

  pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  };

  private subscriptions: Subscription[] = [];

  constructor(private organizationsService: OrganizationsService) {}

  ngOnInit(): void {
    this.loadOrganizations();
    this.loadStats();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  loadOrganizations(): void {
    this.isLoading = true;

    const query = {
      page: this.pagination.page,
      limit: this.pagination.limit,
      ...(this.searchTerm && { search: this.searchTerm }),
      ...(this.selectedStatus && { state: this.selectedStatus as any })
    };

    const sub = this.organizationsService.getOrganizations(query).subscribe({
      next: (response) => {
        if (response.success) {
          this.organizations = response.data.map((org: any) => ({
            id: org.id,
            name: org.name,
            slug: org.slug,
            email: org.email,
            status: org.state || 'active',
            plan: 'premium' as any, // Default plan since backend doesn't have this field
            createdAt: org.created_at || new Date().toISOString(),
            settings: {
              maxStores: 5, // Default value
              maxUsers: 50, // Default value
              allowMultipleStores: true // Default value
            }
          }));

          this.pagination.total = response.meta.total;
          this.pagination.totalPages = response.meta.totalPages;
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading organizations:', error);
        this.isLoading = false;
        // TODO: Show error notification
      }
    });

    this.subscriptions.push(sub);
  }

  loadStats(): void {
    // For now, calculate stats from loaded data
    // In the future, this could be a separate API call
    this.updateStats();
  }

  updateStats(): void {
    this.stats.total = this.organizations.length;
    this.stats.active = this.organizations.filter(org => org.status === 'active').length;
    this.stats.inactive = this.organizations.filter(org => org.status === 'inactive').length;
    this.stats.suspended = this.organizations.filter(org => org.status === 'suspended').length;
  }

  refreshOrganizations(): void {
    this.loadOrganizations();
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm = searchTerm;
    this.pagination.page = 1;
    this.loadOrganizations();
  }

  onStatusFilterChange(status: string): void {
    this.selectedStatus = status;
    this.pagination.page = 1;
    this.loadOrganizations();
  }

  changePage(page: number): void {
    this.pagination.page = page;
    this.loadOrganizations();
  }

  deleteOrganization(org: OrganizationListItem): void {
    if (confirm('Are you sure you want to delete this organization? This action cannot be undone.')) {
      const sub = this.organizationsService.deleteOrganization(org.id).subscribe({
        next: (response) => {
          if (response.success) {
            this.loadOrganizations(); // Reload the list
            // TODO: Show success notification
          }
        },
        error: (error) => {
          console.error('Error deleting organization:', error);
          // TODO: Show error notification
        }
      });

      this.subscriptions.push(sub);
    }
  }

  viewOrganization(org: OrganizationListItem): void {
    // Navigate to organization details
    // TODO: Implement navigation when details page is created
    console.log('View organization:', org);
  }

  editOrganization(org: OrganizationListItem): void {
    // Navigate to organization edit page
    // TODO: Implement navigation when edit page is created
    console.log('Edit organization:', org);
  }

  onFiltersCleared(): void {
    this.searchTerm = '';
    this.selectedStatus = '';
    this.pagination.page = 1;
    this.loadOrganizations();
  }

  getEmptyStateTitle(): string {
    if (this.searchTerm || this.selectedStatus) {
      return 'No organizations match your filters';
    }
    return 'No organizations found';
  }

  getEmptyStateDescription(): string {
    if (this.searchTerm || this.selectedStatus) {
      return 'Try adjusting your search terms or filters';
    }
    return 'Get started by creating your first organization.';
  }
}