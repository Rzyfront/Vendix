import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { apiErrorMessage } from '../../../workflows/utils/workflow-errors.util';
import { TemplateKind } from '../../interfaces/document-template.interfaces';
import { DocumentTemplatesApiService } from '../../services/document-templates-api.service';

const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,79}$/;

/** `Contrato laboral` → `contrato-laboral` (accents and symbols dropped). */
function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** "Nueva plantilla": name, key and the way it is built (blocks or a base PDF). */
@Component({
  selector: 'app-templates-new-page',
  standalone: true,
  imports: [FormsModule, StickyHeaderComponent, CardComponent, InputComponent, ButtonComponent, IconComponent],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Nueva plantilla"
        subtitle="Define cómo se arma el documento"
        icon="file-plus"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/documents/templates"
      />

      <div class="mx-auto max-w-2xl p-2 md:p-4">
        <app-card [responsivePadding]="true" overflow="visible">
          <div class="flex flex-col gap-4">
            <app-input
              label="Nombre"
              placeholder="Contrato laboral"
              [required]="true"
              [ngModel]="name()"
              (ngModelChange)="onName($event)"
            />
            <app-input
              label="Clave"
              placeholder="contrato-laboral"
              helperText="Es la que usan los flujos para elegir la plantilla. No se puede cambiar después."
              [required]="true"
              [error]="keyError()"
              [ngModel]="key()"
              (ngModelChange)="onKey($event)"
            />

            <fieldset class="flex flex-col gap-2">
              <legend class="mb-1 text-sm font-medium text-text-primary">¿Cómo la armas?</legend>
              <div class="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de plantilla">
                @for (option of kinds; track option.value) {
                  <button
                    type="button"
                    role="radio"
                    class="flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors"
                    [class]="kind() === option.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'"
                    [attr.aria-checked]="kind() === option.value"
                    [attr.data-testid]="'kind-' + option.value"
                    (click)="kind.set(option.value)"
                  >
                    <span class="flex items-center gap-2 text-sm font-semibold text-text-primary">
                      <app-icon [name]="option.icon" [size]="16" />
                      {{ option.label }}
                    </span>
                    <span class="text-xs text-text-secondary">{{ option.description }}</span>
                  </button>
                }
              </div>
            </fieldset>

            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <app-button variant="outline" (clicked)="cancel()">Cancelar</app-button>
              <app-button variant="primary" [disabled]="!canCreate()" [loading]="saving()" (clicked)="create()">
                Crear y diseñar
              </app-button>
            </div>
          </div>
        </app-card>
      </div>
    </div>
  `,
})
export class TemplatesNewPageComponent {
  private readonly api = inject(DocumentTemplatesApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly kinds: Array<{ value: TemplateKind; label: string; icon: string; description: string }> = [
    {
      value: 'blocks',
      label: 'Por bloques',
      icon: 'layout',
      description: 'Títulos, párrafos, tablas y casillas de firma con variables del flujo.',
    },
    {
      value: 'base_pdf',
      label: 'Desde un PDF base',
      icon: 'upload-cloud',
      description: 'Subes el formato oficial en PDF y ubicas encima los campos y las firmas.',
    },
  ];

  readonly name = signal('');
  readonly key = signal('');
  readonly kind = signal<TemplateKind>('blocks');
  readonly saving = signal(false);
  private keyTouched = false;

  readonly keyError = computed(() =>
    this.key() === '' || KEY_PATTERN.test(this.key())
      ? undefined
      : 'Usa minúsculas, números, "-" o "_" (2 a 80 caracteres).',
  );
  readonly canCreate = computed(
    () => this.name().trim().length >= 2 && KEY_PATTERN.test(this.key()) && !this.saving(),
  );

  onName(value: string): void {
    this.name.set(value ?? '');
    if (!this.keyTouched) this.key.set(slugify(this.name()));
  }

  onKey(value: string): void {
    this.keyTouched = true;
    this.key.set((value ?? '').trim().toLowerCase());
  }

  cancel(): void {
    this.router.navigate(['/admin/documents/templates']);
  }

  create(): void {
    if (!this.canCreate()) return;
    this.saving.set(true);
    this.api
      .create({ key: this.key(), name: this.name().trim(), kind: this.kind() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (template) => {
          this.saving.set(false);
          this.toast.success('Plantilla creada');
          this.router.navigate(['/admin/documents/templates', template.id]);
        },
        error: (error) => {
          this.saving.set(false);
          this.toast.error(apiErrorMessage(error));
        },
      });
  }
}
