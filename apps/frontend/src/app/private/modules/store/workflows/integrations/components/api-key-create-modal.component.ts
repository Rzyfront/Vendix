import { Component, DestroyRef, effect, inject, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  InputComponent,
  ModalComponent,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import { ApiKeyCreated, ApiKeyScope } from '../interfaces/integrations.interfaces';
import { IntegrationsApiService } from '../services/integrations-api.service';
import { API_KEY_SCOPES } from '../utils/integrations-labels.util';

/** "Nueva API key": name, scopes and optional expiration. */
@Component({
  selector: 'app-api-key-create-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, InputComponent, ToggleComponent],
  template: `
    <app-modal [(isOpen)]="isOpen" title="Nueva API key" size="md">
      <div class="flex flex-col gap-4">
        <app-input
          label="Nombre"
          [required]="true"
          placeholder="Ej.: Integración con el ERP"
          [ngModel]="name()"
          (ngModelChange)="name.set($event)"
        />
        <fieldset class="flex flex-col gap-2">
          <legend class="text-sm font-semibold text-text-primary">Permisos</legend>
          @for (scope of scopes; track scope.value) {
            <app-toggle
              [label]="scope.label + ' · ' + scope.hint"
              [checked]="selected().includes(scope.value)"
              (toggled)="toggleScope(scope.value, $event)"
            />
          }
        </fieldset>
        <app-input
          label="Expira en (días, opcional)"
          type="number"
          min="1"
          max="730"
          placeholder="Sin expiración"
          helperText="Entre 1 y 730 días. Vacío: no expira."
          [ngModel]="days()"
          (ngModelChange)="days.set($event)"
        />
        @if (errorMessage()) {
          <p class="text-sm text-error" role="alert">{{ errorMessage() }}</p>
        }
      </div>
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cancelar</app-button>
        <app-button variant="primary" [loading]="busy()" [disabled]="!canSubmit()" (clicked)="submit()">
          Crear API key
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ApiKeyCreateModalComponent {
  private readonly api = inject(IntegrationsApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly created = output<ApiKeyCreated>();

  readonly scopes = API_KEY_SCOPES;
  readonly name = signal('');
  readonly selected = signal<ApiKeyScope[]>(['workflows:read']);
  readonly days = signal<string | number | null>(null);
  readonly busy = signal(false);
  readonly errorMessage = signal('');

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.name.set('');
          this.selected.set(['workflows:read']);
          this.days.set(null);
          this.errorMessage.set('');
        });
      }
    });
  }

  canSubmit(): boolean {
    return this.name().trim().length > 0 && this.selected().length > 0 && !this.busy();
  }

  toggleScope(scope: ApiKeyScope, on: boolean): void {
    this.selected.update((current) =>
      on ? [...new Set([...current, scope])] : current.filter((s) => s !== scope),
    );
  }

  submit(): void {
    if (!this.canSubmit()) return;
    const raw = this.days();
    const days = raw === null || raw === '' ? undefined : Number(raw);
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 730)) {
      this.errorMessage.set('La expiración debe ser un número entero de días entre 1 y 730.');
      return;
    }
    this.busy.set(true);
    this.errorMessage.set('');
    this.api
      .createApiKey({
        name: this.name().trim(),
        scopes: this.selected(),
        ...(days !== undefined ? { expires_in_days: days } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (key) => {
          this.busy.set(false);
          this.isOpen.set(false);
          this.created.emit(key);
        },
        error: (error) => {
          this.busy.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }
}
