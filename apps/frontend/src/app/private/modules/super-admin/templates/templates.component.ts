import {Component, OnInit, OnDestroy, signal, DestroyRef, inject} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import {
  TemplatesService,
  CreateTemplateDto,
  UpdateTemplateDto,
} from './services/templates.service';
import {
  TemplateListItem,
  TemplateConfigType,
} from './interfaces/template.interface';

// Import components
import {
  TemplateStatsComponent,
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
  PaginationComponent,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  TableColumn,
  TableAction,
  EmptyStateComponent,
} from '../../../../shared/components/index';

// Import styles
import './templates.component.css';

@Component({
  selector: 'app-templates',
  standalone: true,
  imports: [
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    TemplateStatsComponent,
    EmptyStateComponent,
    TemplateCreateModalComponent,
    TemplateEditModalComponent,
    InputsearchComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    ButtonComponent,
  ],
  providers: [TemplatesService],
  template: `
    <div class="space-y-6">
      <!-- Stats Cards -->
      <app-template-stats [stats]="stats()"></app-template-stats>

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
                  [disabled]="isLoading()"
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
        @if (isLoading()) {
          <div class="p-8 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Loading templates...</p>
          </div>
        }

        <!-- Empty State -->
        @if (!isLoading() && templates().length === 0) {
          <app-empty-state
            icon="file-text"
            [title]="getEmptyStateTitle()"
            [description]="getEmptyStateDescription()"
            actionButtonText="Crear Template"
            (actionClick)="openCreateTemplateModal()"
          >
          </app-empty-state>
        }

        <!-- Templates Table -->
        @if (!isLoading() && templates().length > 0) {
          <div class="p-6">
            <app-responsive-data-view
              [data]="templates()"
              [columns]="tableColumns"
              [cardConfig]="cardConfig"
              [actions]="tableActions"
              [loading]="isLoading()"
              emptyMessage="No hay plantillas"
              emptyIcon="file-text"
            >
            </app-responsive-data-view>
            <!-- Pagination -->
            <div class="mt-6 flex justify-center">
              <app-pagination
                [currentPage]="pagination.page"
                [totalPages]="pagination.totalPages"
                [total]="pagination.total"
                [limit]="pagination.limit"
                infoStyle="range"
                (pageChange)="changePage($event)"
              />
            </div>
          </div>
        }
      </div>

      @defer (when isCreateModalOpen()) {
        <app-template-create-modal
          [(isOpen)]="isCreateModalOpen"
          [isSubmitting]="isCreatingTemplate()"
          (submit)="createTemplate($event)"
        ></app-template-create-modal>
      }

      @defer (when isEditModalOpen()) {
        <app-template-edit-modal
          [(isOpen)]="isEditModalOpen"
          [isSubmitting]="isUpdatingTemplate()"
          [template]="selectedTemplate"
          (submit)="updateTemplate($event)"
        ></app-template-edit-modal>
      }
    </div>
  `,
})
export class TemplatesComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  readonly templates = signal<TemplateListItem[]>([]);
  readonly isLoading = signal(false);
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
      variant: 'info',
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
    badgeTransform: (val: boolean) => (val ? 'Active' : 'Inactive'),
    detailKeys: [
      {
        key: 'is_system',
        label: 'Type',
        transform: (val: boolean) => (val ? 'System' : 'Custom'),
      },
      {
        key: 'created_at',
        label: 'Created',
        transform: (val: string) => this.formatDate(val),
      },
    ],
  };

  readonly stats = signal({
    totalTemplates: 0,
    activeTemplates: 0,
    systemTemplates: 0,
    customTemplates: 0,
  });

  pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  };

  readonly isCreateModalOpen = signal(false);
  readonly isCreatingTemplate = signal(false);

  readonly isEditModalOpen = signal(false);
  readonly isUpdatingTemplate = signal(false);
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
    this.isLoading.set(true);

    const query = {
      page: this.pagination.page,
      limit: this.pagination.limit,
      ...(this.searchTerm && { search: this.searchTerm }),
      ...(this.selectedConfigurationType && {
        configuration_type: this.selectedConfigurationType,
      }),
    };

    const sub = this.templatesService.getTemplates(query).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        if (response.success) {
          this.templates.set(response.data);
          this.pagination.total = response.meta.total;
          this.pagination.totalPages = response.meta.totalPages;
        }
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Error loading templates:', error);
        this.isLoading.set(false);
        this.toastService.error('Error loading templates');
      },
    });

    this.subscriptions.push(sub);
  }

  loadStats(): void {
    const sub = this.templatesService.getTemplateStats().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        if (response.success) {
          this.stats.set({
            totalTemplates: response.data.totalTemplates,
            activeTemplates: response.data.activeTemplates,
            systemTemplates: response.data.systemTemplates,
            customTemplates: response.data.customTemplates,
          });
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
    this.loadTemplates();
  }

  changePage(page: number): void {
    this.pagination.page = page;
    this.loadTemplates();
  }

  openCreateTemplateModal(): void {
    this.isCreateModalOpen.set(true);
  }

  onCreateModalCancel(): void {
    this.isCreateModalOpen.set(false);
  }

  createTemplate(templateData: CreateTemplateDto): void {
    this.isCreatingTemplate.set(true);

    const sub = this.templatesService.createTemplate(templateData).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        if (response.success) {
          this.isCreateModalOpen.set(false);
          this.loadTemplates();
          this.loadStats();
          this.toastService.success('Template created successfully');
        }
        this.isCreatingTemplate.set(false);
      },
      error: (error) => {
        console.error('Error creating template:', error);
        this.toastService.error('Error creating template');
        this.isCreatingTemplate.set(false);
      },
    });

    this.subscriptions.push(sub);
  }

  editTemplate(template: TemplateListItem): void {
    this.selectedTemplate = template;
    this.isEditModalOpen.set(true);
  }

  onEditModalCancel(): void {
    this.isEditModalOpen.set(false);
    this.selectedTemplate = undefined;
  }

  updateTemplate(templateData: UpdateTemplateDto): void {
    if (!this.selectedTemplate) return;

    this.isUpdatingTemplate.set(true);

    const sub = this.templatesService
      .updateTemplate(this.selectedTemplate.id, templateData)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (response) => {
          if (response.success) {
            this.isEditModalOpen.set(false);
            this.selectedTemplate = undefined;
            this.loadTemplates();
            this.toastService.success('Template updated successfully');
          }
          this.isUpdatingTemplate.set(false);
        },
        error: (error) => {
          console.error('Error updating template:', error);
          this.toastService.error('Error updating template');
          this.isUpdatingTemplate.set(false);
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
            .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

  viewTemplate(template: TemplateListItem): void {}

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
