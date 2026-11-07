import {
  Component,
  DestroyRef,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
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
 * "Iniciar solicitud": asks for a title and starts an instance of the
 * published version. One `Idempotency-Key` per open dialog: a retry after a
 * network error reuses it, so the request is never created twice.
 */
@Component({
  selector: 'app-start-instance-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, InputComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      title="Iniciar solicitud"
      [subtitle]="definition()?.name ?? ''"
      size="sm"
    >
      <app-input
        label="Título de la solicitud"
        placeholder="Ej. Compra de 10 laptops"
        helperText="Opcional. Si lo dejas vacío se usa el nombre del flujo."
        [ngModel]="title()"
        (ngModelChange)="title.set($event ?? '')"
      />
      @if (errorMessage()) {
        <p class="mt-3 text-sm text-error" role="alert">{{ errorMessage() }}</p>
      }
      <div
        slot="footer"
        class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end"
      >
        <app-button variant="outline" (clicked)="onOpenChange(false)"
          >Cancelar</app-button
        >
        <app-button variant="primary" [loading]="busy()" (clicked)="start()">
          Iniciar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class StartInstanceModalComponent {
  private readonly api = inject(WorkflowsApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly definition = input<WorkflowDefinitionRow | null>(null);
  readonly started = output<number>();

  readonly title = signal('');
  readonly busy = signal(false);
  readonly errorMessage = signal('');
  /** Reused across retries of the same open dialog; cleared on a definitive outcome. */
  private idempotencyKey: string | null = null;

  onOpenChange(open: boolean): void {
    this.isOpen.set(open);
    if (!open) {
      this.title.set('');
      this.errorMessage.set('');
      this.idempotencyKey = null;
    }
  }

  start(): void {
    const definition = this.definition();
    if (!definition || this.busy()) return;
    this.idempotencyKey ??= crypto.randomUUID();
    this.busy.set(true);
    this.errorMessage.set('');
    const title = this.title().trim();
    this.api
      .startInstance(
        { definition_id: definition.id, ...(title ? { title } : {}) },
        this.idempotencyKey,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          this.toast.success('Solicitud iniciada');
          this.started.emit(result.id);
          this.onOpenChange(false);
        },
        error: (error) => {
          const parsed = toWorkflowError(error);
          this.busy.set(false);
          this.errorMessage.set(parsed.message);
          // A 4xx is a definitive refusal: the next attempt is a new action.
          if (
            parsed.status !== null &&
            parsed.status >= 400 &&
            parsed.status < 500
          ) {
            this.idempotencyKey = null;
          }
        },
      });
  }
}
