import { Component, DestroyRef, inject, model, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  InputComponent,
  ModalComponent,
  ToastService,
} from '../../../../../shared/components/index';
import { WorkflowDefinitionRow } from '../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../services/workflows-api.service';
import { toWorkflowError } from '../utils/workflow-errors.util';

/**
 * P5.1 "Nuevo flujo": only a name. The backend creates a valid skeleton draft
 * and the editor opens on the canvas, so a flow is built without JSON.
 */
@Component({
  selector: 'app-new-definition-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, InputComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      title="Nuevo flujo"
      subtitle="Ponle un nombre y ármalo en el lienzo"
      size="sm"
    >
      <div class="flex flex-col gap-3">
        <app-input
          label="Nombre del flujo"
          placeholder="Ej.: Aprobación de compras"
          [ngModel]="name()"
          (ngModelChange)="onNameChange($event)"
          [required]="true"
        />
        @if (error()) {
          <p class="text-sm text-error" role="alert">{{ error() }}</p>
        }
      </div>
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="close()">Cancelar</app-button>
        <app-button
          variant="primary"
          [disabled]="!name().trim() || creating()"
          [loading]="creating()"
          (clicked)="create()"
        >
          Crear y abrir el editor
        </app-button>
      </div>
    </app-modal>
  `,
})
export class NewDefinitionModalComponent {
  private readonly api = inject(WorkflowsApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly created = output<WorkflowDefinitionRow>();

  readonly name = signal('');
  readonly error = signal<string | null>(null);
  readonly creating = signal(false);

  onOpenChange(open: boolean): void {
    this.isOpen.set(open);
    if (!open) {
      this.name.set('');
      this.error.set(null);
    }
  }

  close(): void {
    this.onOpenChange(false);
  }

  onNameChange(value: string): void {
    this.name.set(value ?? '');
    this.error.set(null);
  }

  create(): void {
    const name = this.name().trim();
    if (!name || this.creating()) return;
    this.creating.set(true);
    this.api
      .createDefinition({ name })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (row) => {
          this.creating.set(false);
          this.toast.success('Flujo creado. Ármalo en el lienzo.');
          this.created.emit(row);
          this.close();
        },
        error: (e) => {
          this.creating.set(false);
          this.error.set(toWorkflowError(e).message);
        },
      });
  }
}
