import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';

import { OrganizationsService, CreateOrganizationDto } from './services/organizations.service';
import { OrganizationListItem } from './interfaces/organization.interface';
import { Organization } from '../../../../core/models/organization.model';

// Import new components
import {
  OrganizationStatsComponent,
  OrganizationCardComponent,
  OrganizationPaginationComponent,
  OrganizationEmptyStateComponent,
  OrganizationCreateModalComponent,
  OrganizationEditModalComponent
} from './components/index';

// Import shared components
import { ModalComponent, InputsearchComponent, IconComponent } from '../../../../shared/components/index';

// Import styles (CSS instead of SCSS to avoid loader issues)
import './organizations.component.css';

@Component({
  selector: 'app-organizations',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    OrganizationStatsComponent,
    OrganizationCardComponent,
    OrganizationPaginationComponent,
    OrganizationEmptyStateComponent,
    OrganizationCreateModalComponent,
    OrganizationEditModalComponent,
    InputsearchComponent,
    IconComponent
  ],
  providers: [OrganizationsService],
  template: `
    <div class="space-y-6">
      <!-- Stats Cards -->
      <app-organization-stats [stats]="stats"></app-organization-stats>

      <!-- Organizations List -->
      <div class="bg-surface rounded-card shadow-card border border-border">
        <div class="px-6 py-4 border-b border-border">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                All Organizations ({{ pagination.total }})
              </h2>
            </div>
            
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <!-- Input de búsqueda compacto -->
              <app-inputsearch
                class="w-full sm:w-64"
                size="sm"
                placeholder="Search organizations..."
                [debounceTime]="1000"
                (searchChange)="onSearchChange($event)"
              ></app-inputsearch>
              
              <div class="flex gap-2">
                <button
                  class="px-3 py-2 rounded-button font-medium border border-border text-text-primary hover:bg-muted/20 disabled:opacity-50 text-sm"
                  (click)="refreshOrganizations()"
                  [disabled]="isLoading"
                  title="Refresh"
                >
                  <app-icon name="refresh" [size]="16"></app-icon>
                </button>
                <button
                  class="px-3 py-2 rounded-button text-white font-medium bg-primary hover:bg-primary/90 text-sm"
                  (click)="openCreateOrganizationModal()"
                  title="Add Organization"
                >
                  <i class="fas fa-plus mr-1"></i>
                  <span class="hidden sm:inline">Add</span>
                </button>
              </div>
            </div>
            
            <!-- Paginación info -->
            <div class="flex items-center gap-2 mt-2 sm:mt-0">
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
          [description]="getEmptyStateDescription()"
          (actionClick)="openCreateOrganizationModal()">
        </app-organization-empty-state>

        <!-- Organizations Grid -->
        <div *ngIf="!isLoading && organizations.length > 0" class="organizations-list-container p-6">
          <div class="space-y-4">
            <app-organization-card
              *ngFor="let org of organizations"
              [organization]="org"
              (cardClick)="editOrganization(org)"
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

      <!-- Create Organization Modal -->
      <app-organization-create-modal
        [isOpen]="isCreateModalOpen"
        [isSubmitting]="isCreatingOrganization"
        (openChange)="onCreateModalChange($event)"
        (submit)="createOrganization($event)"
        (cancel)="onCreateModalCancel()"
      ></app-organization-create-modal>

      <!-- Edit Organization Modal -->
      <app-organization-edit-modal
        [isOpen]="isEditModalOpen"
        [isSubmitting]="isUpdatingOrganization"
        [organization]="selectedOrganization"
        (openChange)="onEditModalChange($event)"
        (submit)="updateOrganization($event)"
        (cancel)="onEditModalCancel()"
      ></app-organization-edit-modal>
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

  // Modal state
  isCreateModalOpen = false;
  isCreatingOrganization = false;
  createOrganizationForm!: FormGroup;

  // Edit Modal state
  isEditModalOpen = false;
  isUpdatingOrganization = false;
  selectedOrganization?: OrganizationListItem;

  private subscriptions: Subscription[] = [];

  constructor(
    private organizationsService: OrganizationsService,
    private fb: FormBuilder
  ) {
    this.initializeCreateForm();
  }

  ngOnInit(): void {
    this.loadOrganizations();
    this.loadStats();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private initializeCreateForm(): void {
    this.createOrganizationForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      website: [''],
      description: [''],
      legalName: [''],
      taxId: [''],
      state: ['active']
    });
  }

  openCreateOrganizationModal(): void {
    this.isCreateModalOpen = true;
    this.createOrganizationForm.reset({
      name: '',
      email: '',
      phone: '',
      website: '',
      description: '',
      legalName: '',
      taxId: '',
      state: 'active'
    });
  }

  onCreateModalChange(isOpen: boolean): void {
    this.isCreateModalOpen = isOpen;
    if (!isOpen) {
      this.createOrganizationForm.reset();
    }
  }

  onCreateModalCancel(): void {
    this.isCreateModalOpen = false;
    this.createOrganizationForm.reset();
  }

  createOrganization(organizationData?: CreateOrganizationDto | Event): void {
    // If it's an Event, it means method was called from the new modal
    // If no data is provided, it means method was called from the old form
    // This maintains backward compatibility while transitioning to the new modal
    if (!organizationData || organizationData instanceof Event) {
      if (this.createOrganizationForm.invalid) {
        // Mark all fields as touched to trigger validation messages
        Object.keys(this.createOrganizationForm.controls).forEach(key => {
          this.createOrganizationForm.get(key)?.markAsTouched();
        });
        return;
      }

      const formData = this.createOrganizationForm.value;
      organizationData = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone || undefined,
        website: formData.website || undefined,
        description: formData.description || undefined,
        legal_name: formData.legalName || undefined,
        tax_id: formData.taxId || undefined,
        state: formData.state
      };
    }

    this.isCreatingOrganization = true;

    const sub = this.organizationsService.createOrganization(organizationData as CreateOrganizationDto).subscribe({
      next: (response) => {
        if (response.success) {
          this.isCreateModalOpen = false;
          this.loadOrganizations(); // Reload the list
          this.loadStats(); // Reload stats
          // TODO: Show success notification
          console.log('Organization created successfully:', response.data);
        }
        this.isCreatingOrganization = false;
      },
      error: (error) => {
        console.error('Error creating organization:', error);
        this.isCreatingOrganization = false;
        // TODO: Show error notification
      }
    });

    this.subscriptions.push(sub);
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
    this.selectedOrganization = org;
    this.isEditModalOpen = true;
  }

  onEditModalChange(isOpen: boolean): void {
    this.isEditModalOpen = isOpen;
    if (!isOpen) {
      this.selectedOrganization = undefined;
    }
  }

  onEditModalCancel(): void {
    this.isEditModalOpen = false;
    this.selectedOrganization = undefined;
  }

  updateOrganization(organizationData: any): void {
    if (!this.selectedOrganization) return;

    this.isUpdatingOrganization = true;

    // Transform data to match the UpdateOrganizationDto interface from backend
    const updateData = {
      name: organizationData.name,
      slug: this.selectedOrganization.slug, // Keep existing slug
      legal_name: organizationData.legalName,
      tax_id: organizationData.taxId,
      email: organizationData.email,
      phone: organizationData.phone,
      website: organizationData.website,
      description: organizationData.description,
      state: organizationData.state
    };

    const sub = this.organizationsService.updateOrganization(this.selectedOrganization.id, updateData).subscribe({
      next: (response) => {
        if (response.success) {
          this.isEditModalOpen = false;
          this.selectedOrganization = undefined;
          this.loadOrganizations(); // Reload the list
          this.loadStats(); // Reload stats
          // TODO: Show success notification
          console.log('Organization updated successfully:', response.data);
        }
        this.isUpdatingOrganization = false;
      },
      error: (error) => {
        console.error('Error updating organization:', error);
        this.isUpdatingOrganization = false;
        // TODO: Show error notification
      }
    });

    this.subscriptions.push(sub);
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