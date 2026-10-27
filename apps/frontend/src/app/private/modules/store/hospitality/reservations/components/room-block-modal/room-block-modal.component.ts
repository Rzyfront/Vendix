import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { addDays, format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import {
  CreateInventoryBlockRequest,
  INVENTORY_BLOCK_REASON_LABELS,
  RackBlock,
} from '../../interfaces/reservation.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

/** What the modal opens on: a new block (optionally on a room) or an existing one. */
export type RoomBlockTarget =
  | { mode: 'create'; unit_id?: number; from_date: string }
  | { mode: 'view'; block: RackBlock; unit_label: string };

const REASON_OPTIONS: SelectorOption[] = [
  { value: 'maintenance', label: INVENTORY_BLOCK_REASON_LABELS.maintenance },
  { value: 'owner_use', label: INVENTORY_BLOCK_REASON_LABELS.owner_use },
];

const longDate = (date: string) => format(parseISO(date), "d 'de' MMM yyyy", { locale: es });

/**
 * Hospitality Suite (H5.3) — block a room for maintenance or owner use with
 * dates and reason, so it is not sold while repaired; or view an active block
 * and release it when the ticket is closed. Opened from the rack.
 */
@Component({
  selector: 'app-room-block-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [isOpen]="target() !== null"
      (isOpenChange)="!$event && close()"
      (cancel)="close()"
      [size]="'md'"
      [dialog]="true"
      [title]="viewed() ? 'Habitación bloqueada' : 'Bloquear habitación'"
      [subtitle]="viewed() ? viewed()!.unit_label : 'No se vende mientras esté bloqueada'"
    >
      @if (viewed(); as view) {
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm" data-testid="room-block-detail">
          <dt class="text-text-secondary">Motivo</dt>
          <dd class="font-medium">{{ reasonLabel(view.block.reason) }}</dd>
          <dt class="text-text-secondary">Desde</dt>
          <dd>{{ formatDate(view.block.from_date) }}</dd>
          <dt class="text-text-secondary">Vuelve a la venta</dt>
          <dd>{{ formatDate(view.block.to_date) }}</dd>
          @if (view.block.notes) {
            <dt class="text-text-secondary">Notas</dt>
            <dd class="whitespace-pre-line">{{ view.block.notes }}</dd>
          }
        </dl>
      } @else {
        <form [formGroup]="form" class="grid grid-cols-2 gap-3 text-sm" data-testid="room-block-form">
          <app-selector
            class="col-span-2"
            formControlName="unit_id"
            label="Habitación"
            placeholder="Selecciona una habitación"
            [options]="units()"
          />
          <app-input
            formControlName="from_date"
            label="Desde"
            type="date"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="to_date"
            label="Vuelve a la venta"
            type="date"
            customWrapperClass="mt-0"
          />
          <app-selector
            class="col-span-2"
            formControlName="reason"
            label="Motivo"
            [options]="reasonOptions"
          />
          <app-textarea
            class="col-span-2"
            formControlName="notes"
            label="Notas"
            placeholder="Ej.: fuga en el baño, cambio de colchón"
            [rows]="2"
          />
          @if (error()) {
            <p class="col-span-2 font-medium text-error" data-testid="room-block-error">{{ error() }}</p>
          }
        </form>
      }

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="close()">Cancelar</app-button>
        @if (viewed(); as view) {
          <app-button
            variant="primary"
            [loading]="saving()"
            [disabled]="view.block.reason === 'ical'"
            (clicked)="release(view.block.id)"
          >
            <app-icon slot="icon" name="unlock" [size]="16" />
            Liberar habitación
          </app-button>
        } @else {
          <app-button
            variant="primary"
            [loading]="saving()"
            [disabled]="!canSave()"
            (clicked)="create()"
          >
            <app-icon slot="icon" name="lock" [size]="16" />
            Bloquear
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class RoomBlockModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Block to view or create; `null` keeps the modal closed. */
  readonly target = input<RoomBlockTarget | null>(null);
  /** Rooms the manager can block (from the rack). */
  readonly units = input<SelectorOption[]>([]);
  readonly closed = output<void>();
  /** Emitted after creating or releasing a block. */
  readonly changed = output<void>();

  readonly reasonOptions = REASON_OPTIONS;
  readonly saving = signal(false);
  readonly error = signal('');

  readonly form = this.fb.group({
    unit_id: this.fb.control<number | null>(null),
    from_date: this.fb.nonNullable.control(''),
    to_date: this.fb.nonNullable.control(''),
    reason: this.fb.nonNullable.control<CreateInventoryBlockRequest['reason']>('maintenance'),
    notes: this.fb.nonNullable.control(''),
  });

  private readonly formValue = signal(this.form.getRawValue());

  readonly viewed = computed(() => {
    const target = this.target();
    return target?.mode === 'view' ? target : null;
  });

  readonly canSave = computed(() => {
    const { unit_id, from_date, to_date } = this.formValue();
    return unit_id !== null && !!from_date && !!to_date && to_date > from_date;
  });

  constructor() {
    effect(() => {
      const target = this.target();
      if (target?.mode === 'create') untracked(() => this.open(target));
    });
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.formValue.set(this.form.getRawValue());
        this.error.set('');
      });
  }

  reasonLabel(reason: RackBlock['reason']): string {
    return INVENTORY_BLOCK_REASON_LABELS[reason];
  }

  formatDate(date: string): string {
    return longDate(date);
  }

  private open(target: { unit_id?: number; from_date: string }): void {
    this.error.set('');
    this.form.reset({
      unit_id: target.unit_id ?? null,
      from_date: target.from_date,
      to_date: format(addDays(parseISO(target.from_date), 1), 'yyyy-MM-dd'),
      reason: 'maintenance',
      notes: '',
    });
  }

  create(): void {
    if (!this.canSave()) return;
    const { unit_id, from_date, to_date, reason, notes } = this.form.getRawValue();
    this.saving.set(true);
    this.reservationsService
      .createBlock({
        unit_id: Number(unit_id),
        from_date,
        to_date,
        reason,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.done('Habitación bloqueada'),
        error: (message: unknown) => {
          this.saving.set(false);
          this.error.set(typeof message === 'string' ? message : 'No se pudo bloquear la habitación');
        },
      });
  }

  release(blockId: number): void {
    this.saving.set(true);
    this.reservationsService
      .releaseBlock(blockId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.done('Habitación liberada'),
        error: (message: unknown) => {
          this.saving.set(false);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudo liberar la habitación',
          );
        },
      });
  }

  private done(message: string): void {
    this.saving.set(false);
    this.toastService.success(message);
    this.changed.emit();
    this.close();
  }

  close(): void {
    this.error.set('');
    this.closed.emit();
  }
}
