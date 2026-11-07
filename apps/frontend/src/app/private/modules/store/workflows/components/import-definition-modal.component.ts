import {
  Component,
  DestroyRef,
  computed,
  inject,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../shared/components/index';
import {
  WorkflowDefinitionV1,
  validateWorkflowDefinition,
} from '../../../../../shared/workflows/contract';
import {
  WorkflowDefinitionRow,
  WorkflowIssueView,
} from '../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../services/workflows-api.service';
import { toWorkflowError } from '../utils/workflow-errors.util';

/**
 * "Nuevo desde JSON": paste or pick a `vendix.workflow/v1` file, validate it
 * (structural pass in the browser, then the server with the store context) and
 * create the draft. Nothing is published here.
 */
@Component({
  selector: 'app-import-definition-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    TextareaComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      title="Nuevo flujo desde JSON"
      subtitle="Pega la definición o carga un archivo .json"
      size="lg"
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <input
            #picker
            type="file"
            class="hidden"
            accept=".json,application/json"
            (change)="onFilePicked($event)"
          />
          <app-button variant="outline" size="sm" (clicked)="picker.click()">
            <app-icon name="upload" [size]="14" slot="icon" />
            Cargar archivo .json
          </app-button>
          @if (fileName()) {
            <span class="text-xs text-text-secondary">{{ fileName() }}</span>
          }
        </div>

        <app-textarea
          label="Definición (vendix.workflow/v1)"
          placeholder='{ "schema": "vendix.workflow/v1", "key": "compras", "name": "Aprobación de compras", ... }'
          [rows]="12"
          customClass="font-mono text-xs"
          [ngModel]="text()"
          (ngModelChange)="onTextChange($event)"
        />

        @if (errors().length) {
          <div
            class="rounded-xl border border-error/30 bg-error/5 p-3"
            role="alert"
            data-testid="import-errors"
          >
            <p class="mb-1 text-sm font-semibold text-error">
              {{
                errors().length === 1
                  ? 'Hay 1 error'
                  : 'Hay ' + errors().length + ' errores'
              }}
              que corregir
            </p>
            <ul class="list-disc space-y-1 pl-5 text-sm text-text-primary">
              @for (line of errors(); track $index) {
                <li>{{ line }}</li>
              }
            </ul>
          </div>
        }

        @if (warnings().length) {
          <div class="rounded-xl border border-warning/30 bg-warning/5 p-3">
            <p class="mb-1 text-sm font-semibold text-text-primary">Avisos</p>
            <ul class="list-disc space-y-1 pl-5 text-sm text-text-secondary">
              @for (line of warnings(); track $index) {
                <li>{{ line }}</li>
              }
            </ul>
          </div>
        }

        @if (validated()) {
          <p class="flex items-center gap-2 text-sm text-success" role="status">
            <app-icon name="check-circle" [size]="16" />
            La definición es válida. Puedes crear el borrador.
          </p>
        }
      </div>

      <div
        slot="footer"
        class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end"
      >
        <app-button variant="outline" (clicked)="close()">Cancelar</app-button>
        <app-button
          variant="outline"
          [disabled]="!text().trim() || busy()"
          [loading]="validating()"
          (clicked)="validate()"
        >
          Validar
        </app-button>
        <app-button
          variant="primary"
          [disabled]="!validated() || busy()"
          [loading]="creating()"
          (clicked)="create()"
        >
          Crear borrador
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ImportDefinitionModalComponent {
  private readonly api = inject(WorkflowsApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly created = output<WorkflowDefinitionRow>();

  readonly text = signal('');
  readonly fileName = signal('');
  readonly errors = signal<string[]>([]);
  readonly warnings = signal<string[]>([]);
  readonly validated = signal(false);
  readonly validating = signal(false);
  readonly creating = signal(false);
  readonly busy = computed(() => this.validating() || this.creating());

  onOpenChange(open: boolean): void {
    this.isOpen.set(open);
    if (!open) this.reset();
  }

  close(): void {
    this.onOpenChange(false);
  }

  onTextChange(value: string): void {
    this.text.set(value ?? '');
    this.validated.set(false);
  }

  async onFilePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.text.set(await file.text());
      this.fileName.set(file.name);
      this.validated.set(false);
      this.errors.set([]);
      this.warnings.set([]);
    } catch {
      this.errors.set(['No se pudo leer el archivo seleccionado.']);
    } finally {
      input.value = '';
    }
  }

  validate(): void {
    const parsed = this.parse();
    if (parsed === undefined) return;

    // Structural pass in the browser. Template publication depends on the
    // store, so only the server can rule on it.
    const local = validateWorkflowDefinition(parsed);
    const localErrors = local.errors.filter(
      (e) => e.code !== 'TEMPLATE_NOT_PUBLISHED',
    );
    if (localErrors.length) {
      this.errors.set(localErrors.map((e) => e.message));
      this.warnings.set(local.warnings.map((w) => w.message));
      this.validated.set(false);
      return;
    }

    this.validating.set(true);
    this.api
      .validateDefinition(parsed)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.errors.set(
            result.errors.map((e: WorkflowIssueView) => e.message),
          );
          this.warnings.set(
            result.warnings.map((w: WorkflowIssueView) => w.message),
          );
          this.validated.set(result.valid);
          this.validating.set(false);
        },
        error: (error) => {
          this.validated.set(false);
          this.errors.set([toWorkflowError(error).message]);
          this.validating.set(false);
        },
      });
  }

  create(): void {
    const parsed = this.parse();
    if (parsed === undefined || !this.validated()) return;
    const def = parsed as Partial<WorkflowDefinitionV1>;
    this.creating.set(true);
    this.api
      .createDefinition({
        name: String(def.name ?? '').trim(),
        key: def.key,
        description: def.description,
        definition: parsed,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (row) => {
          this.creating.set(false);
          this.toast.success('Borrador creado. Publícalo cuando esté listo.');
          this.created.emit(row);
          this.close();
        },
        error: (error) => {
          this.creating.set(false);
          this.errors.set([toWorkflowError(error).message]);
        },
      });
  }

  /** Parsed JSON, or `undefined` after showing why it is not JSON. */
  private parse(): unknown | undefined {
    const raw = this.text().trim();
    if (!raw) {
      this.errors.set(['Pega una definición o carga un archivo .json.']);
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : '';
      this.errors.set([`El texto no es un JSON válido.${detail}`]);
      this.validated.set(false);
      return undefined;
    }
  }

  private reset(): void {
    this.text.set('');
    this.fileName.set('');
    this.errors.set([]);
    this.warnings.set([]);
    this.validated.set(false);
    this.validating.set(false);
    this.creating.set(false);
  }
}
