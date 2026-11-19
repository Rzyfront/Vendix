import {Component, OnInit, ChangeDetectionStrategy, signal, inject, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Router } from '@angular/router';
import { DataCollectionTemplatesService } from '../services/data-collection-templates.service';
import { DataCollectionTemplate } from '../interfaces/data-collection-template.interface';
import { ENTITY_TYPE_LABELS } from '../interfaces/metadata-field.interface';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { SpinnerComponent } from '../../../../../shared/components/spinner/spinner.component';
import { EmptyStateComponent } from '../../../../../shared/components/empty-state/empty-state.component';
import { BadgeComponent } from '../../../../../shared/components/badge/badge.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';

@Component({
  selector: 'app-templates',
  standalone: true,
  imports: [
    ButtonComponent,
    SpinnerComponent,
    EmptyStateComponent,
    BadgeComponent,
    IconComponent
],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <!-- The module header (layout) is the page header; this is the list bar. -->
      <div class="p-4 sm:p-6">
      <div class="flex items-center justify-between gap-2 mb-4">
        <h2 class="text-lg font-semibold text-text-primary">
          Plantillas de formulario
          @if (!loading()) {
            <span class="text-text-secondary font-normal">({{ templates().length }})</span>
          }
        </h2>
        <!-- The empty state carries its own create button -->
        @if (loading() || templates().length > 0) {
          <app-button variant="primary" size="sm" (clicked)="openNewTemplate()">
            <app-icon name="plus" [size]="16" slot="icon"></app-icon>
            Nueva plantilla
          </app-button>
        }
      </div>
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
          (actionClick)="openNewTemplate()"
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
                  {{ entityTypeLabel(template.entity_type) }}
                </span>
                @if (template.is_default) {
                  <span
                    class="flex items-center gap-1"
                    style="color: var(--color-primary)"
                  >
                    <app-icon name="star" [size]="12"></app-icon>
                    Reservas
                  </span>
                }
                @if (template.is_crm_default) {
                  <span
                    class="flex items-center gap-1"
                    style="color: var(--color-primary)"
                  >
                    <app-icon name="star" [size]="12"></app-icon>
                    CRM
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
                <app-button variant="ghost" size="xsm" (clicked)="openEditor(template.id)">
                  <app-icon name="pencil" [size]="12" slot="icon" ></app-icon>
                  Editar
                </app-button>
                @if (canUseInCrm(template)) {
                  <app-button variant="ghost" size="xsm" (clicked)="useInCrm(template)">
                    <app-icon name="star" [size]="12" slot="icon" ></app-icon>
                    Usar en el CRM
                  </app-button>
                }
                <app-button variant="ghost" size="xsm" (clicked)="duplicateTemplate(template.id)">
                  <app-icon name="copy" [size]="12" slot="icon" ></app-icon>
                  Duplicar
                </app-button>
                <app-button variant="ghost" size="xsm" (clicked)="confirmDeleteTemplate(template)">
                  <app-icon name="trash-2" [size]="12" slot="icon" ></app-icon>
                </app-button>
              </div>
            </div>
          }
        </div>
      }
      </div>
    </div>
  `,
})
export class TemplatesComponent implements OnInit {
  entityTypeLabel(type: string): string {
    return (ENTITY_TYPE_LABELS as Record<string, string>)[type] ?? type;
  }

  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private templatesService = inject(DataCollectionTemplatesService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);

  templates = signal<DataCollectionTemplate[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.loadTemplates();
  }

  loadTemplates() {
    this.loading.set(true);
    this.templatesService.getAll().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

  openNewTemplate() {
    this.router.navigate(['/admin', 'data-collection', 'templates', 'new', 'edit']);
  }

  canUseInCrm(template: DataCollectionTemplate): boolean {
    return (
      template.entity_type === 'customer' &&
      template.status === 'active' &&
      !template.is_crm_default
    );
  }

  useInCrm(template: DataCollectionTemplate) {
    this.templatesService
      .update(template.id, { is_crm_default: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Plantilla predeterminada del CRM actualizada');
          this.loadTemplates();
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
    this.templatesService.duplicate(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

    this.templatesService.delete(template.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
