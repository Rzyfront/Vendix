import {
  Component,
  DestroyRef,
  OnInit,
  computed,
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
  SelectorComponent,
  ToastService,
} from '../../../../../shared/components/index';
import {
  BoardFilterOption,
  StartInstanceWithLocation,
} from '../interfaces/workflow-board.interfaces';
import { WorkflowDefinitionRow } from '../interfaces/workflow.interfaces';
import { WorkflowBoardApiService } from '../services/workflow-board-api.service';
import { WorkflowsApiService } from '../services/workflows-api.service';
import { isPlanLimit, toWorkflowError } from '../utils/workflow-errors.util';

const NO_LOCATION = 'none';

/**
 * "Iniciar solicitud": asks for a title and starts an instance of the
 * published version. One `Idempotency-Key` per open dialog: a retry after a
 * network error reuses it, so the request is never created twice.
 */
@Component({
  selector: 'app-start-instance-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, InputComponent, SelectorComponent],
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
      @if (locations().length > 0) {
        <div class="mt-3">
          <app-selector
            label="Sede"
            [options]="locationOptions()"
            [value]="locationId()"
            (valueChange)="onLocation($event)"
          />
        </div>
      }
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
export class StartInstanceModalComponent implements OnInit {
  private readonly api = inject(WorkflowsApiService);
  private readonly boardApi = inject(WorkflowBoardApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly definition = input<WorkflowDefinitionRow | null>(null);
  readonly started = output<number>();

  readonly title = signal('');
  /** P5.5: branches of the store; the select is hidden when there are none. */
  readonly locations = signal<BoardFilterOption[]>([]);
  readonly locationId = signal(NO_LOCATION);
  readonly locationOptions = computed(() => [
    { value: NO_LOCATION, label: 'Sin sede' },
    ...this.locations().map((l) => ({ value: String(l.id), label: l.name })),
  ]);
  readonly busy = signal(false);
  readonly errorMessage = signal('');
  /** Reused across retries of the same open dialog; cleared on a definitive outcome. */
  private idempotencyKey: string | null = null;

  ngOnInit(): void {
    this.boardApi
      .listLocations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.locations.set(rows),
        // Optional field: without the list the request starts with no branch.
        error: () => undefined,
      });
  }

  onLocation(value: unknown): void {
    this.locationId.set(value === null || value === undefined ? NO_LOCATION : String(value));
  }

  onOpenChange(open: boolean): void {
    this.isOpen.set(open);
    if (!open) {
      this.title.set('');
      this.locationId.set(NO_LOCATION);
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
    const body: StartInstanceWithLocation = {
      definition_id: definition.id,
      ...(title ? { title } : {}),
      ...(this.locationId() !== NO_LOCATION ? { location_id: Number(this.locationId()) } : {}),
    };
    this.api
      .startInstance(body, this.idempotencyKey)
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
          this.errorMessage.set(isPlanLimit(parsed) ? '' : parsed.message);
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
