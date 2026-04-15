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
import { TemplateModalComponent } from './template-modal/template-modal.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { environment } from '../../../../../../environments/environment';

@Component({
  selector: 'app-templates',
  standalone: true,
  imports: [CommonModule, IconComponent, TemplateModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-4 sm:p-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-lg font-bold" style="color: var(--color-text)">
            Plantillas de Formulario
          </h1>
          <p class="text-sm" style="color: var(--color-text-muted)">
            Configura los formularios de recoleccion de datos
          </p>
        </div>
        <button
          class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
          style="background: var(--color-primary)"
          (click)="openCreateModal()"
        >
          <app-icon name="plus" [size]="16"></app-icon>
          Nueva Plantilla
        </button>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <div
            class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"
          ></div>
        </div>
      } @else if (templates().length === 0) {
        <div
          class="text-center py-12 border rounded-lg"
          style="border-color: var(--color-border)"
        >
          <app-icon
            name="layout-template"
            [size]="32"
            color="var(--color-text-muted)"
          ></app-icon>
          <p class="text-sm mt-2" style="color: var(--color-text-muted)">
            No hay plantillas creadas
          </p>
        </div>
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
                <span
                  class="text-xs px-2 py-0.5 rounded-full"
                  [style.background]="
                    template.status === 'active' ? '#dcfce7' : '#fee2e2'
                  "
                  [style.color]="
                    template.status === 'active' ? '#166534' : '#991b1b'
                  "
                >
                  {{ template.status }}
                </span>
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
                class="flex gap-1 mt-3 pt-3"
                style="border-top: 1px solid var(--color-border)"
              >
                <button
                  class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style="color: var(--color-text-muted)"
                  (click)="openEditModal(template)"
                >
                  <app-icon name="pencil" [size]="12"></app-icon> Editar
                </button>
                <button
                  class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style="color: var(--color-primary)"
                  (click)="openEditor(template.id)"
                >
                  <app-icon name="settings-2" [size]="12"></app-icon> Editor
                </button>
                <button
                  class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style="color: var(--color-text-muted)"
                  (click)="duplicateTemplate(template.id)"
                >
                  <app-icon name="copy" [size]="12"></app-icon> Duplicar
                </button>
              </div>
            </div>
          }
        </div>
      }
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
  private http = inject(HttpClient);

  templates = signal<DataCollectionTemplate[]>([]);
  loading = signal(true);
  isModalOpen = signal(false);
  selectedTemplate = signal<DataCollectionTemplate | null>(null);
  availableFields = signal<MetadataField[]>([]);
  availableProducts = signal<any[]>([]);

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
}
