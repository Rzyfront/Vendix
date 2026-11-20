import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, model, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { BadgeComponent } from '../../../../../../shared/components/badge/badge.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import {
  DataCollectionTemplatesService,
  TemplateImportDryRun,
} from '../../services/data-collection-templates.service';
import { ENTITY_TYPE_LABELS, FIELD_TYPE_LABELS } from '../../interfaces/metadata-field.interface';
import { buildExampleTemplateJson, validateTemplateJson } from '../../utils/template-json.contract';
import {
  ImportServerError,
  parseTemplateJsonText,
  readImportServerError,
  summarizeTemplateJson,
} from '../../utils/template-json-import.util';
import { copyTextToClipboard, downloadTextFile } from '../../utils/browser-file.util';

/** Maximum size of a `.json` file read in the browser. */
const MAX_FILE_BYTES = 1024 * 1024;

/**
 * "Crear desde JSON": paste or upload a template JSON, see live validation by
 * path and a structure preview, optionally check it against the server (dry
 * run) and import it as an inactive template.
 */
@Component({
  selector: 'app-template-json-import-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent, BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      title="Crear plantilla desde JSON"
      subtitle="Pega el JSON, súbelo como archivo o parte del ejemplo. Se importa como inactiva para que la revises."
      size="xl"
    >
      <div class="space-y-4">
        <div class="flex flex-wrap gap-2">
          <app-button variant="outline" size="sm" (clicked)="fileInput.click()">
            <app-icon name="upload" [size]="14" slot="icon"></app-icon>
            Subir .json
          </app-button>
          <app-button variant="outline" size="sm" (clicked)="showExample.set(!showExample())">
            <app-icon name="file-text" [size]="14" slot="icon"></app-icon>
            {{ showExample() ? 'Ocultar JSON de ejemplo' : 'Ver JSON de ejemplo' }}
          </app-button>
          <input #fileInput type="file" accept=".json,application/json" class="hidden" (change)="onFileSelected($event)" />
        </div>

        @if (showExample()) {
          <div class="rounded-xl p-3 space-y-2" style="border: 1px dashed var(--color-primary); background: var(--color-surface)">
            <p class="text-xs" style="color: var(--color-text-muted)">
              Ejemplo con todos los tipos de campo, incluido «Documentos / adjuntos».
            </p>
            <textarea
              readonly
              rows="8"
              class="w-full p-3 rounded-xl text-xs font-mono"
              style="border: 1px solid var(--color-border); background: var(--color-surface-secondary); color: var(--color-text)"
              aria-label="JSON de ejemplo"
              [value]="exampleText"
            ></textarea>
            <div class="flex flex-wrap gap-2">
              <app-button variant="outline" size="sm" (clicked)="copy(exampleText)">
                <app-icon name="copy" [size]="14" slot="icon"></app-icon>
                Copiar
              </app-button>
              <app-button variant="outline" size="sm" (clicked)="downloadExample()">
                <app-icon name="download" [size]="14" slot="icon"></app-icon>
                Descargar
              </app-button>
              <app-button variant="primary" size="sm" (clicked)="useExample()">Usar como punto de partida</app-button>
            </div>
          </div>
        }

        <div>
          <label for="template-json-text" class="block text-xs font-medium mb-1" style="color: var(--color-text)">
            JSON de la plantilla
          </label>
          <textarea
            id="template-json-text"
            rows="12"
            spellcheck="false"
            class="w-full p-3 rounded-xl text-xs font-mono"
            style="border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text)"
            placeholder='{ "schema": "vendix.data-collection-template/v1", "name": "…" }'
            [value]="text()"
            (input)="onTextInput($any($event.target).value)"
          ></textarea>
        </div>

        <!-- Live validation -->
        @if (text().trim()) {
          @if (syntaxError(); as message) {
            <p class="text-sm" role="alert" style="color: var(--color-error)">{{ message }}</p>
          } @else if (validationErrors().length) {
            <div class="rounded-xl p-3" role="alert" style="border: 1px solid var(--color-error)">
              <p class="text-sm font-semibold mb-1" style="color: var(--color-error)">
                {{ validationErrors().length }} error(es) en el JSON
              </p>
              <ul class="space-y-1 text-xs max-h-40 overflow-y-auto" style="color: var(--color-text)">
                @for (e of validationErrors(); track $index) {
                  <li>
                    @if (e.path) {
                      <code class="font-mono px-1 rounded" style="background: var(--color-surface-secondary)">{{ e.path }}</code>
                    }
                    {{ e.message }}
                  </li>
                }
              </ul>
            </div>
          }
        }

        <!-- Server errors -->
        @if (serverError(); as server) {
          <div class="rounded-xl p-3" role="alert" style="border: 1px solid var(--color-error)">
            <p class="text-sm font-semibold mb-1" style="color: var(--color-error)">{{ server.message }}</p>
            @if (server.errors.length) {
              <ul class="space-y-1 text-xs max-h-40 overflow-y-auto" style="color: var(--color-text)">
                @for (e of server.errors; track $index) {
                  <li>
                    @if (e.path) {
                      <code class="font-mono px-1 rounded" style="background: var(--color-surface-secondary)">{{ e.path }}</code>
                    }
                    {{ e.message }}
                  </li>
                }
              </ul>
            }
          </div>
        }

        <!-- Structure preview -->
        @if (summary(); as s) {
          <div class="rounded-xl p-3 space-y-3" style="border: 1px solid var(--color-border); background: var(--color-surface)">
            <div class="flex flex-wrap items-center gap-2">
              <app-icon name="check-circle" [size]="16" color="var(--color-success)"></app-icon>
              <span class="text-sm font-semibold" style="color: var(--color-text)">{{ s.name }}</span>
              <app-badge variant="neutral">{{ entityLabel(s.entity_type) }}</app-badge>
              <span class="text-xs" style="color: var(--color-text-muted)">
                {{ s.steps.length }} paso(s) · {{ s.total_sections }} sección(es) · {{ s.total_fields }} campo(s)
              </span>
            </div>
            <div class="space-y-3 max-h-64 overflow-y-auto">
              @for (step of s.steps; track $index) {
                <div>
                  @if (s.steps.length > 1) {
                    <p class="text-xs font-bold uppercase tracking-wider mb-1" style="color: var(--color-text-muted)">
                      Paso {{ $index + 1 }}: {{ step.title }}
                    </p>
                  }
                  @for (section of step.sections; track $index) {
                    <div class="mb-2" [style.margin-left.px]="section.depth * 16">
                      <p class="text-sm font-semibold" style="color: var(--color-text)">{{ section.title }}</p>
                      <ul class="mt-1 space-y-0.5">
                        @for (f of section.fields; track $index) {
                          <li class="text-xs" style="color: var(--color-text)">
                            {{ f.label }}
                            <span style="color: var(--color-text-muted)">· {{ fieldTypeLabel(f.type) }}</span>
                            @if (f.required) {
                              <span style="color: var(--color-error)"> · obligatorio</span>
                            }
                            @if (f.documents) {
                              <span class="block" style="color: var(--color-text-muted)">{{ f.documents }}</span>
                            }
                          </li>
                        }
                      </ul>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        }

        <!-- Dry run result -->
        @if (dryRun(); as result) {
          <div class="rounded-xl p-3" style="border: 1px solid var(--color-primary); background: var(--color-surface)">
            <p class="text-sm font-semibold mb-1" style="color: var(--color-text)">
              El servidor aceptó el JSON: {{ newFieldsCount() }} campo(s) nuevo(s), {{ result.fields.length - newFieldsCount() }} existente(s) se reutilizan.
            </p>
            <ul class="space-y-0.5 text-xs max-h-40 overflow-y-auto">
              @for (f of result.fields; track $index) {
                <li style="color: var(--color-text)">
                  <app-badge [variant]="f.status === 'new' ? 'primary' : 'neutral'">{{ f.status === 'new' ? 'Nuevo' : 'Existente' }}</app-badge>
                  <code class="font-mono ml-1">{{ f.key }}</code>
                  <span style="color: var(--color-text-muted)"> · {{ fieldTypeLabel(f.type) }}</span>
                </li>
              }
            </ul>
          </div>
        }
      </div>

      <div slot="footer" class="flex flex-col-reverse sm:flex-row justify-end gap-2">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cancelar</app-button>
        <app-button variant="outline" [disabled]="!canSubmit() || importing()" [loading]="checking()" (clicked)="verify()">
          Verificar con el servidor
        </app-button>
        <app-button variant="primary" [disabled]="!canSubmit() || checking()" [loading]="importing()" (clicked)="importNow()">
          <app-icon name="upload" [size]="16" slot="icon"></app-icon>
          Importar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class TemplateJsonImportModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly templatesService = inject(DataCollectionTemplatesService);
  private readonly toast = inject(ToastService);

  readonly isOpen = model<boolean>(false);

  readonly text = signal('');
  readonly showExample = signal(false);
  readonly checking = signal(false);
  readonly importing = signal(false);
  readonly dryRun = signal<TemplateImportDryRun | null>(null);
  readonly serverError = signal<ImportServerError | null>(null);

  readonly exampleText = JSON.stringify(buildExampleTemplateJson(), null, 2);

  private readonly parsed = computed(() => parseTemplateJsonText(this.text()));
  private readonly validation = computed(() => {
    const parsed = this.parsed();
    return parsed.ok ? validateTemplateJson(parsed.value) : null;
  });

  /** Friendly syntax message; empty text is not an error yet. */
  readonly syntaxError = computed(() => {
    const parsed = this.parsed();
    return !parsed.ok && this.text().trim() ? parsed.message : null;
  });
  readonly validationErrors = computed(() => {
    const v = this.validation();
    return v && !v.ok ? v.errors : [];
  });
  readonly summary = computed(() => {
    const v = this.validation();
    return v?.ok ? summarizeTemplateJson(v.value) : null;
  });
  readonly canSubmit = computed(() => this.validation()?.ok === true);
  readonly newFieldsCount = computed(() => this.dryRun()?.fields.filter((f) => f.status === 'new').length ?? 0);

  entityLabel(type: string): string {
    return (ENTITY_TYPE_LABELS as Record<string, string>)[type] ?? type;
  }

  fieldTypeLabel(type: string): string {
    return (FIELD_TYPE_LABELS as Record<string, string>)[type] ?? type;
  }

  onTextInput(value: string): void {
    this.text.set(value);
    // Server answers belong to the previous text.
    this.dryRun.set(null);
    this.serverError.set(null);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      this.toast.error('El archivo es demasiado grande (máximo 1 MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => this.onTextInput(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => this.toast.error('No se pudo leer el archivo.');
    reader.readAsText(file);
  }

  useExample(): void {
    this.onTextInput(this.exampleText);
    this.showExample.set(false);
  }

  async copy(text: string): Promise<void> {
    if (await copyTextToClipboard(text)) this.toast.success('JSON copiado');
    else this.toast.error('No se pudo copiar; selecciona el texto y cópialo manualmente.');
  }

  downloadExample(): void {
    downloadTextFile('plantilla-ejemplo.json', this.exampleText);
  }

  verify(): void {
    const v = this.validation();
    if (!v?.ok) return;
    this.checking.set(true);
    this.serverError.set(null);
    this.templatesService
      .importDryRun(v.value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.dryRun.set(result);
          this.checking.set(false);
        },
        error: (err) => {
          this.serverError.set(readImportServerError(err));
          this.dryRun.set(null);
          this.checking.set(false);
        },
      });
  }

  importNow(): void {
    const v = this.validation();
    if (!v?.ok) return;
    this.importing.set(true);
    this.serverError.set(null);
    this.templatesService
      .importTemplate(v.value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.importing.set(false);
          this.toast.success('Plantilla importada como inactiva; revísala y actívala');
          this.isOpen.set(false);
          this.router.navigate(['/admin', 'data-collection', 'templates', created.id, 'edit']);
        },
        error: (err) => {
          this.serverError.set(readImportServerError(err));
          this.importing.set(false);
        },
      });
  }
}
