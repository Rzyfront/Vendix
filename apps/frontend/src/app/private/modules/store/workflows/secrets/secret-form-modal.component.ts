import { Component, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonComponent, InputComponent, ModalComponent } from '../../../../../shared/components/index';
import { WORKFLOW_SECRET_NAME_PATTERN } from '../../../../../shared/workflows/contract/workflow-contract';
import { toWorkflowError } from '../utils/workflow-errors.util';
import { WorkflowSecretsApiService } from './workflow-secrets-api.service';
import { WorkflowSecretRow } from './workflow-secrets.interfaces';

const VALUE_MAX = 4000;

/** Create a secret, or replace the value / description of an existing one. */
@Component({
  selector: 'app-secret-form-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, InputComponent],
  template: `
    <app-modal [(isOpen)]="isOpen" [title]="secret() ? 'Reemplazar secreto' : 'Nuevo secreto'" size="md">
      <div class="flex flex-col gap-4">
        @if (secret(); as current) {
          <p class="text-sm text-text-secondary">
            Secreto <span class="font-mono font-semibold text-text-primary">{{ current.name }}</span>. Escribe el nuevo
            valor para reemplazarlo; el actual no se puede ver.
          </p>
        } @else {
          <app-input
            label="Nombre"
            [required]="true"
            placeholder="CRM_TOKEN"
            [error]="nameError()"
            helperText="MAYÚSCULAS, números y _. Lo usas como {{ '{{secrets.NOMBRE}}' }}."
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
          />
        }
        <app-input
          label="Valor"
          type="password"
          [required]="!secret()"
          [maxlength]="maxValue"
          [helperText]="secret() ? 'Déjalo vacío para conservar el valor actual.' : 'Se guarda cifrado y no se vuelve a mostrar.'"
          [ngModel]="value()"
          (ngModelChange)="value.set($event)"
        />
        <app-input
          label="Descripción (opcional)"
          [maxlength]="200"
          [ngModel]="description()"
          (ngModelChange)="description.set($event)"
        />
        @if (errorMessage()) {
          <p class="text-sm text-error" role="alert">{{ errorMessage() }}</p>
        }
      </div>
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cancelar</app-button>
        <app-button variant="primary" [loading]="busy()" [disabled]="!canSubmit()" (clicked)="submit()">
          {{ secret() ? 'Guardar' : 'Crear secreto' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class SecretFormModalComponent {
  private readonly api = inject(WorkflowSecretsApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly secret = input<WorkflowSecretRow | null>(null);
  readonly saved = output<void>();

  readonly maxValue = VALUE_MAX;
  readonly name = signal('');
  readonly value = signal('');
  readonly description = signal('');
  readonly busy = signal(false);
  readonly errorMessage = signal('');

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const current = this.secret();
      if (!open) return;
      untracked(() => {
        this.name.set(current?.name ?? '');
        this.value.set('');
        this.description.set(current?.description ?? '');
        this.errorMessage.set('');
      });
    });
  }

  nameError(): string | undefined {
    const name = this.name();
    return name !== '' && !WORKFLOW_SECRET_NAME_PATTERN.test(name)
      ? 'Usa MAYÚSCULAS, números y _, empezando por una letra (máximo 60).'
      : undefined;
  }

  canSubmit(): boolean {
    if (this.busy()) return false;
    if (this.secret()) {
      return this.value() !== '' || this.description().trim() !== (this.secret()?.description ?? '');
    }
    return WORKFLOW_SECRET_NAME_PATTERN.test(this.name()) && this.value() !== '';
  }

  submit(): void {
    if (!this.canSubmit()) return;
    const current = this.secret();
    const description = this.description().trim();
    this.busy.set(true);
    this.errorMessage.set('');
    const request = current
      ? this.api.replace(current.id, {
          ...(this.value() !== '' ? { value: this.value() } : {}),
          description,
        })
      : this.api.create({
          name: this.name(),
          value: this.value(),
          ...(description ? { description } : {}),
        });
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        this.value.set('');
        this.isOpen.set(false);
        this.saved.emit();
      },
      error: (error) => {
        this.busy.set(false);
        this.errorMessage.set(toWorkflowError(error).message);
      },
    });
  }
}
