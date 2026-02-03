import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import {
  TemplatesService,
  CreateTemplateDto,
  UpdateTemplateDto,
} from './services/templates.service';
import { TemplateListItem, TemplateConfigType } from './interfaces/template.interface';

// Import components
import {
  TemplateStatsComponent,
  TemplatePaginationComponent,
  TemplateEmptyStateComponent,
  TemplateCreateModalComponent,
  TemplateEditModalComponent,
} from './components/index';

// Import shared components
import {
  ModalComponent,
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
  DialogService,
  ToastService,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  TableColumn,
  TableAction,
} from '../../../../shared/components/index';

// Import styles
import './templates.component.css';

@Component({
  selector: 'app-templates',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    TemplateStatsComponent,
    TemplatePaginationComponent,
    TemplateEmptyStateComponent,
    TemplateCreateModalComponent,
    TemplateEditModalComponent,
    InputsearchComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
  ],
  providers: [TemplatesService],
  template: `
    <div class="space-y-6">
      <!-- Stats Cards -->
      <app-template-stats [stats]="stats"></app-template-stats>

      <!-- Templates List -->
      <div class="bg-surface rounded-card shadow-card border border-border">
        <div class="px-6 py-4 border-b border-border">
          <div
            class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
          >
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                All Templates ({{ pagination.total }})
              </h2>
            </div>

            <div
              class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto"
            >
              <app-inputsearch
                class="w-full sm:w-64"
                size="sm"
                placeholder="Search templates..."
                [debounceTime]="1000"
                (searchChange)="onSearchChange($event)"
              ></app-inputsearch>

              <div class="flex gap-2 items-center">
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="refreshTemplates()"
                  [disabled]="isLoading"
                  title="Refresh"
                >
                  <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
                </app-button>
                <app-button
                  variant="primary"
                  size="sm"
                  (clicked)="openCreateTemplateModal()"
                  title="New Template"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  <span class="hidden sm:inline">New Template</span>
                </app-button>
              </div>
            </div>

            <div class="flex items-center gap-2 mt-2 sm:mt-0">
              <span class="text-sm text-text-secondary">
                Page {{ pagination.page }} of {{ pagination.totalPages }}
              </span>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="isLoading" class="p-8 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-text-secondary">Loading templates...</p>
        </div>

        <!-- Empty State -->
        <app-template-empty-state
          *ngIf="!isLoading && templates.length === 0"
          [title]="getEmptyStateTitle()"
          [description]="getEmptyStateDescription()"
          (actionClick)="openCreateTemplateModal()"
        >
        </app-template-empty-state>

        <!-- Templates Table -->
        <div *ngIf="!isLoading && templates.length > 0" class="p-6">
          <app-responsive-data-view
            [data]="templates"
            [columns]="tableColumns"
            [cardConfig]="cardConfig"
            [actions]="tableActions"
            [loading]="isLoading"
            emptyMessage="No hay plantillas"
            emptyIcon="file-text"
          >
          </app-responsive-data-view>

          <!-- Pagination -->
          <div class="mt-6 flex justify-center">
            <app-template-pagination
              [pagination]="pagination"
              (pageChange)="changePage($event)"
            >
            </app-template-pagination>
          </div>
        </div>
      </div>

      <!-- Create Template Modal -->
      <app-template-create-modal
        [(isOpen)]="isCreateModalOpen"
        [isSubmitting]="isCreatingTemplate"
        (submit)="createTemplate($event)"
      ></app-template-create-modal>

      <!-- Edit Template Modal -->
      <app-template-edit-modal
        [(isOpen)]="isEditModalOpen"
        [isSubmitting]="isUpdatingTemplate"
        [template]="selectedTemplate"
        (submit)="updateTemplate($event)"
      ></app-template-edit-modal>
    </div>
  `,
})
export class TemplatesComponent implements OnInit, OnDestroy {
  templates: TemplateListItem[] = [];
  isLoading = false;
  searchTerm = '';
  selectedConfigurationType: TemplateConfigType | null = null;

  tableColumns: TableColumn[] = [
    {
      key: 'template_name',
      label: 'Template Name',
      sortable: true,
      width: '250px',
      priority: 1,
    },
    {
      key: 'configuration_type',
      label: 'Type',
      sortable: true,
      width: '180px',
      priority: 1,
      transform: (value: string) => this.formatConfigurationType(value),
    },
    {
      key: 'description',
      label: 'Description',
      sortable: false,
      width: '300px',
      priority: 2,
    },
    {
      key: 'is_system',
      label: 'System',
      sortable: true,
      width: '80px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: boolean) => (value ? 'System' : 'Custom'),
    },
    {
      key: 'is_active',
      label: 'Status',
      sortable: true,
      width: '100px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: boolean) => (value ? 'Active' : 'Inactive'),
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      width: '150px',
      priority: 3,
      transform: (value: string) => this.formatDate(value),
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Edit',
      icon: 'edit',
      action: (template) => this.editTemplate(template),
      variant: 'success',
    },
    {
      label: 'Delete',
      icon: 'trash-2',
      action: (template) => this.deleteTemplate(template),
      variant: 'danger',
    },
  ];

  // Card configuration for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'template_name',
    subtitleKey: 'configuration_type',
    subtitleTransform: (value: string) => this.formatConfigurationType(value),
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: boolean) => val ? 'Active' : 'Inactive',
    detailKeys: [
      { key: 'is_system', label: 'Type', transform: (val: boolean) => val ? 'System' : 'Custom' },
      { key: 'created_at', label: 'Created', transform: (val: string) => this.formatDate(val) },
    ],
  };

  stats = {
    totalTemplates: 0,
    activeTemplates: 0,
    systemTemplates: 0,
    customTemplates: 0,
  };

  pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  };

  isCreateModalOpen = false;
  isCreatingTemplate = false;

  isEditModalOpen = false;
  isUpdatingTemplate = false;
  selectedTemplate?: TemplateListItem;

  private subscriptions: Subscription[] = [];

  constructor(
    private templatesService: TemplatesService,
    private dialogService: DialogService,
    private toastService: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadTemplates();
    this.loadStats();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  loadTemplates(): void {
    this.isLoading = true;

    const query = {
      page: this.pagination.page,
      limit: this.pagination.limit,
      ...(this.searchTerm && { search: this.searchTerm }),
      ...(this.selectedConfigurationType && {
        configuration_type: this.selectedConfigurationType,
      }),
    };

    const sub = this.templatesService.getTemplates(query).subscribe({
      next: (response) => {
        if (response.success) {
          this.templates = response.data;
          this.pagination.total = response.meta.total;
          this.pagination.totalPages = response.meta.totalPages;
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading templates:', error);
        this.isLoading = false;
        this.toastService.error('Error loading templates');
      },
    });

    this.subscriptions.push(sub);
  }

  loadStats(): void {
    const sub = this.templatesService.getTemplateStats().subscribe({
      next: (response) => {
        if (response.success) {
          this.stats.totalTemplates = response.data.totalTemplates;
          this.stats.activeTemplates = response.data.activeTemplates;
          this.stats.systemTemplates = response.data.systemTemplates;
          this.stats.customTemplates = response.data.customTemplates;
        }
      },
      error: (error) => {
        console.error('Error loading template stats:', error);
      },
    });

    this.subscriptions.push(sub);
  }

  refreshTemplates(): void {
    this.loadTemplates();
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm = searchTerm;
    this.pagination.page = 1;
    this.loadTemplates();
  }

  onTableSort(sortEvent: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    console.log('Sort event:', sortEvent);
    this.loadTemplates();
  }

  changePage(page: number): void {
    this.pagination.page = page;
    this.loadTemplates();
  }

  openCreateTemplateModal(): void {
    this.isCreateModalOpen = true;
  }

  onCreateModalCancel(): void {
    this.isCreateModalOpen = false;
  }

  createTemplate(templateData: CreateTemplateDto): void {
    this.isCreatingTemplate = true;

    const sub = this.templatesService.createTemplate(templateData).subscribe({
      next: (response) => {
        if (response.success) {
          this.isCreateModalOpen = false;
          this.loadTemplates();
          this.loadStats();
          this.toastService.success('Template created successfully');
        }
        this.isCreatingTemplate = false;
      },
      error: (error) => {
        console.error('Error creating template:', error);
        this.toastService.error('Error creating template');
        this.isCreatingTemplate = false;
      },
    });

    this.subscriptions.push(sub);
  }

  editTemplate(template: TemplateListItem): void {
    this.selectedTemplate = template;
    this.isEditModalOpen = true;
  }

  onEditModalCancel(): void {
    this.isEditModalOpen = false;
    this.selectedTemplate = undefined;
  }

  updateTemplate(templateData: UpdateTemplateDto): void {
    if (!this.selectedTemplate) return;

    this.isUpdatingTemplate = true;

    const sub = this.templatesService
      .updateTemplate(this.selectedTemplate.id, templateData)
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.isEditModalOpen = false;
            this.selectedTemplate = undefined;
            this.loadTemplates();
            this.toastService.success('Template updated successfully');
          }
          this.isUpdatingTemplate = false;
        },
        error: (error) => {
          console.error('Error updating template:', error);
          this.toastService.error('Error updating template');
          this.isUpdatingTemplate = false;
        },
      });

    this.subscriptions.push(sub);
  }

  deleteTemplate(template: TemplateListItem): void {
    this.dialogService
      .confirm({
        title: 'Delete Template',
        message: `Are you sure you want to delete "${template.template_name}"? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          const sub = this.templatesService
            .deleteTemplate(template.id)
            .subscribe({
              next: (response) => {
                if (response.success) {
                  this.loadTemplates();
                  this.loadStats();
                  this.toastService.success('Template deleted successfully');
                }
              },
              error: (error) => {
                console.error('Error deleting template:', error);
                this.toastService.error('Error deleting template');
              },
            });

          this.subscriptions.push(sub);
        }
      });
  }

  viewTemplate(template: TemplateListItem): void {
    console.log('View template:', template);
  }

  formatConfigurationType(type: string): string {
    const typeMap: Record<string, string> = {
      domain: 'Domain',
      store_settings: 'Store Settings',
      ecommerce: 'E-commerce',
      payment_methods: 'Payment Methods',
      shipping: 'Shipping',
      tax: 'Tax',
      email: 'Email',
      notifications: 'Notifications',
      user_panel_ui: 'User Panel UI',
    };
    return typeMap[type] || type;
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  getEmptyStateTitle(): string {
    if (this.searchTerm || this.selectedConfigurationType) {
      return 'No templates match your filters';
    }
    return 'No templates found';
  }

  getEmptyStateDescription(): string {
    if (this.searchTerm || this.selectedConfigurationType) {
      return 'Try adjusting your search terms or filters';
    }
    return 'Get started by creating your first template.';
  }
}
