import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  signal,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { DataCollectionTemplatesService } from '../services/data-collection-templates.service';
import { DataCollectionTemplate } from '../interfaces/data-collection-template.interface';
import { MetadataField } from '../interfaces/metadata-field.interface';
import { MetadataFieldsService } from '../services/metadata-fields.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { StickyHeaderComponent, StickyHeaderActionButton } from '../../../../../shared/components/sticky-header/sticky-header.component';
import { SpinnerComponent } from '../../../../../shared/components/spinner/spinner.component';
import { EmptyStateComponent } from '../../../../../shared/components/empty-state/empty-state.component';
import { BadgeComponent } from '../../../../../shared/components/badge/badge.component';
import { TemplateModalComponent } from './template-modal/template-modal.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { environment } from '../../../../../../environments/environment';

@Component({
  selector: 'app-templates',
  standalone: true,
  imports: [
    CommonModule,
    StickyHeaderComponent,
    ButtonComponent,
    SpinnerComponent,
    EmptyStateComponent,
    BadgeComponent,
    TemplateModalComponent,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <app-sticky-header
        title="Plantillas de Formulario"
        subtitle="Configura los formularios de recolección de datos"
        icon="layout-template"
        [actions]="headerActions"
        (actionClicked)="onHeaderAction($event)"
      />

      <div class="p-4 sm:p-6">
      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <app-spinner size="md" />
        </div>
      } @else if (templates().length === 0) {
        <app-empty-state
          icon="layout-template"
          title="No hay plantillas"
          description="Crea tu primera plantilla para comenzar a recolectar datos de clientes."
          [showActionButton]="true"
          actionButtonText="Nueva Plantilla"
          actionButtonIcon="plus"
          (actionClick)="openCreateModal()"
        />
      } @else {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          @for (template of templates(); track template.id) {
            <div
              class="border rounded-xl p-4 transition-shadow hover:shadow-md"
              style="border-color: var(--color-border); background: var(--color-surface)"
            >
              <div class="flex items-center justify-between mb-2">
                <h3
                  class="font-semibold text-sm truncate"
                  style="color: var(--color-text)"
                >
                  {{ template.name }}
                </h3>
                <app-badge [variant]="getStatusBadgeVariant(template.status)">
                  {{ getStatusLabel(template.status) }}
                </app-badge>
              </div>
              @if (template.description) {
                <p
                  class="text-xs mb-3 line-clamp-2"
                  style="color: var(--color-text-muted)"
                >
                  {{ template.description }}
                </p>
              }
              <div
                class="flex items-center gap-3 text-xs"
                style="color: var(--color-text-muted)"
              >
                <span class="flex items-center gap-1">
                  <app-icon name="layers" [size]="12"></app-icon>
                  {{ template.sections.length || 0 }} secciones
                </span>
                <span class="flex items-center gap-1">
                  <app-icon name="tag" [size]="12"></app-icon>
                  {{ template.entity_type }}
                </span>
                @if (template.is_default) {
                  <span
                    class="flex items-center gap-1"
                    style="color: var(--color-primary)"
                  >
                    <app-icon name="star" [size]="12"></app-icon>
                    Default
                  </span>
                }
                @if (template.products?.length) {
                  <span class="flex items-center gap-1">
                    <app-icon name="package" [size]="12"></app-icon>
                    {{ template.products!.length }} producto(s)
                  </span>
                }
              </div>
              <div
                class="flex gap-2 mt-3 pt-3"
                style="border-top: 1px solid var(--color-border)"
              >
                <app-button variant="ghost" size="xsm" (clicked)="openEditModal(template)">
                  <app-icon name="pencil" [size]="12" slot="icon"></app-icon>
                  Editar
                </app-button>
                <app-button variant="ghost" size="xsm" (clicked)="openEditor(template.id)">
                  <app-icon name="settings-2" [size]="12" slot="icon"></app-icon>
                  Editor
                </app-button>
                <app-button variant="ghost" size="xsm" (clicked)="duplicateTemplate(template.id)">
                  <app-icon name="copy" [size]="12" slot="icon"></app-icon>
                  Duplicar
                </app-button>
                <app-button variant="ghost" size="xsm" (clicked)="confirmDeleteTemplate(template)">
                  <app-icon name="trash-2" [size]="12" slot="icon"></app-icon>
                </app-button>
              </div>
            </div>
          }
        </div>
      }
      </div>
    </div>

    @if (isModalOpen()) {
      <app-template-modal
        [template]="selectedTemplate()"
        [availableFields]="availableFields()"
        [availableProducts]="availableProducts()"
        (save)="onSaveTemplate($event)"
        (close)="closeModal()"
      />
    }
  `,
})
export class TemplatesComponent implements OnInit {
  private router = inject(Router);
  private templatesService = inject(DataCollectionTemplatesService);
  private fieldsService = inject(MetadataFieldsService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private http = inject(HttpClient);

  templates = signal<DataCollectionTemplate[]>([]);
  loading = signal(true);
  isModalOpen = signal(false);
  selectedTemplate = signal<DataCollectionTemplate | null>(null);
  availableFields = signal<MetadataField[]>([]);
  availableProducts = signal<any[]>([]);

  headerActions: StickyHeaderActionButton[] = [
    { id: 'new', label: 'Nueva Plantilla', variant: 'primary', icon: 'plus' },
  ];

  onHeaderAction(actionId: string): void {
    if (actionId === 'new') this.openCreateModal();
  }

  ngOnInit() {
    this.loadTemplates();
    this.loadAvailableFields();
    this.loadAvailableProducts();
  }

  loadTemplates() {
    this.loading.set(true);
    this.templatesService.getAll().subscribe({
      next: (templates) => {
        this.templates.set(templates);
        this.loading.set(false);
      },
      error: (err) => {
        this.toastService.error(extractApiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  loadAvailableFields() {
    this.fieldsService.getFields().subscribe({
      next: (fields) => this.availableFields.set(fields),
      error: () => {},
    });
  }

  loadAvailableProducts() {
    this.http
      .get<any>(`${environment.apiUrl}/store/products?limit=200`)
      .pipe(map((r) => r.data))
      .subscribe({
        next: (products) => this.availableProducts.set(products),
        error: () => {},
      });
  }

  openCreateModal() {
    this.selectedTemplate.set(null);
    this.isModalOpen.set(true);
  }

  openEditModal(template: DataCollectionTemplate) {
    this.selectedTemplate.set(template);
    this.isModalOpen.set(true);
  }

  closeModal() {
    this.isModalOpen.set(false);
    this.selectedTemplate.set(null);
  }

  onSaveTemplate(data: any) {
    const selected = this.selectedTemplate();
    const productIds: number[] = data.product_ids || [];
    delete data.product_ids;

    const obs = selected
      ? this.templatesService.update(selected.id, data)
      : this.templatesService.create(data);

    obs.subscribe({
      next: (result: any) => {
        const templateId = selected?.id || result?.id;
        if (templateId && productIds.length > 0) {
          this.templatesService
            .assignProducts(templateId, productIds)
            .subscribe({
              next: () => {
                this.toastService.success(
                  selected ? 'Plantilla actualizada' : 'Plantilla creada',
                );
                this.closeModal();
                this.loadTemplates();
              },
              error: () => {
                this.toastService.warning(
                  'Plantilla guardada, pero hubo un error asignando productos',
                );
                this.closeModal();
                this.loadTemplates();
              },
            });
        } else if (templateId && productIds.length === 0 && selected) {
          // Clear existing product assignments when editing and no products selected
          this.templatesService.assignProducts(templateId, []).subscribe({
            next: () => {
              this.toastService.success('Plantilla actualizada');
              this.closeModal();
              this.loadTemplates();
            },
            error: () => {
              this.toastService.success('Plantilla actualizada');
              this.closeModal();
              this.loadTemplates();
            },
          });
        } else {
          this.toastService.success(
            selected ? 'Plantilla actualizada' : 'Plantilla creada',
          );
          this.closeModal();
          this.loadTemplates();
        }
      },
      error: (err) => {
        this.toastService.error(extractApiErrorMessage(err));
      },
    });
  }

  openEditor(templateId: number) {
    this.router.navigate([
      '/admin',
      'data-collection',
      'templates',
      templateId,
      'edit',
    ]);
  }

  duplicateTemplate(id: number) {
    this.templatesService.duplicate(id).subscribe({
      next: () => {
        this.toastService.success('Plantilla duplicada');
        this.loadTemplates();
      },
      error: (err) => {
        this.toastService.error(extractApiErrorMessage(err));
      },
    });
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Activo',
      inactive: 'Inactivo',
      archived: 'Archivado',
    };
    return labels[status] || status;
  }

  getStatusBadgeVariant(
    status: string,
  ): 'success' | 'neutral' | 'error' | 'primary' | 'warning' {
    const variants: Record<
      string,
      'success' | 'neutral' | 'error' | 'primary' | 'warning'
    > = {
      active: 'success',
      inactive: 'neutral',
      archived: 'error',
    };
    return variants[status] || 'neutral';
  }

  async confirmDeleteTemplate(template: DataCollectionTemplate) {
    const value = await this.dialogService.prompt({
      title: 'Eliminar plantilla',
      message: `Para confirmar la eliminacion de "${template.name}", escribe la palabra "eliminar".`,
      placeholder: 'eliminar',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
    });

    if (value?.trim().toLowerCase() !== 'eliminar') {
      if (value !== undefined) {
        this.toastService.error('Debes escribir "eliminar" para confirmar');
      }
      return;
    }

    this.templatesService.delete(template.id).subscribe({
      next: () => {
        this.toastService.success('Plantilla eliminada');
        this.loadTemplates();
      },
      error: (err) => {
        this.toastService.error(extractApiErrorMessage(err));
      },
    });
  }
}
