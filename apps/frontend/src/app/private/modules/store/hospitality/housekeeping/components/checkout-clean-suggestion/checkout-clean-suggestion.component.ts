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
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import {
  CheckoutCleanResultRow,
  CheckoutCleanRoom,
  CheckoutCleanStaff,
  CLEANING_ROLE_LABEL,
} from '../../interfaces/housekeeping.interface';
import { LodgingHousekeepingService } from '../../services/housekeeping.service';

/** `0` stands for "Sin asignar" in the selector (options need a value). */
const UNASSIGNED = 0;

type State = 'loading' | 'error' | 'ready' | 'saved' | 'skipped';

interface RoomDraft {
  room: CheckoutCleanRoom;
  userId: number;
  note: FormControl<string>;
}

/**
 * Agenda unificada (F3) — last step of the check-out: the clean of each room
 * the guest left, prefilled (room, priority, note) with a recommended person
 * (the fixed cleaning role first, lighter load first). The desk accepts,
 * changes the person or skips; skipping creates nothing. It never blocks the
 * check-out, which is already closed: a failure only says so.
 */
@Component({
  selector: 'app-checkout-clean-suggestion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    SpinnerComponent,
    TextareaComponent,
  ],
  template: `
    @if (reservationId() !== null && (state() !== 'ready' || drafts().length > 0 || doneRooms().length > 0)) {
      <section
        class="space-y-3 rounded-2xl border border-primary/25 bg-primary/5 p-3 text-sm"
        aria-labelledby="checkout-clean-title"
        data-testid="checkout-clean"
      >
        <header class="flex items-start gap-2">
          <app-icon name="sparkles" [size]="16" class="mt-0.5 text-primary" />
          <div class="min-w-0">
            <h3 id="checkout-clean-title" class="font-semibold text-text-primary">
              ¿Asignar la limpieza de salida?
            </h3>
            <p class="text-xs text-text-secondary">
              La habitación quedó sucia. Asígnala ahora y aparece en las tareas de {{ roleLabel }}.
            </p>
          </div>
        </header>

        @switch (state()) {
          @case ('loading') {
            <app-spinner size="sm" text="Preparando la limpieza…" />
          }
          @case ('error') {
            <div class="flex flex-wrap items-center justify-between gap-2" role="alert" data-testid="checkout-clean-error">
              <span class="text-xs text-error">No pudimos preparar la limpieza. El check-out ya quedó registrado.</span>
              <app-button variant="outline" size="sm" customClasses="min-h-11 sm:min-h-0" (clicked)="load()">
                <app-icon slot="icon" name="refresh-cw" [size]="14" />
                Reintentar
              </app-button>
            </div>
          }
          @case ('saved') {
            <ul class="space-y-1" role="status" data-testid="checkout-clean-saved">
              @for (row of saved(); track row.unit_id) {
                <li class="flex items-center gap-2 text-success">
                  <app-icon name="check-circle" [size]="14" />
                  <span>{{ savedLabel(row) }}</span>
                </li>
              }
            </ul>
          }
          @case ('skipped') {
            <p class="text-xs text-text-secondary" role="status" data-testid="checkout-clean-skipped">
              Sin tarea por ahora. Puedes crearla luego en Hotelería › Limpieza.
            </p>
          }
          @default {
            @for (room of doneRooms(); track room.unit_id) {
              <p class="text-xs text-text-secondary">Hab. {{ room.code }}: ya está limpia hoy.</p>
            }
            @if (staff().length === 0) {
              <p class="text-xs text-text-secondary" data-testid="checkout-clean-no-staff">
                No hay personal con el rol {{ roleLabel }}. Créalo en Configuración › Usuarios; mientras tanto la
                tarea queda sin asignar.
              </p>
            }
            <div class="space-y-3">
              @for (draft of drafts(); track draft.room.unit_id) {
                <div class="space-y-2 rounded-xl border border-border bg-surface p-3" data-testid="checkout-clean-room">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <p class="font-semibold text-text-primary">
                      Hab. {{ draft.room.code }}
                      <span class="font-normal text-text-secondary">
                        · {{ draft.room.unit_type_name }}{{ draft.room.floor ? ' · Piso ' + draft.room.floor : '' }}
                      </span>
                    </p>
                    <app-badge
                      [variant]="draft.room.priority === 'high' ? 'warning' : 'neutral'"
                      badgeStyle="outline"
                      size="xs"
                      data-testid="checkout-clean-priority"
                    >
                      {{ draft.room.priority === 'high' ? 'Prioridad alta' : 'Prioridad normal' }}
                    </app-badge>
                  </div>
                  <app-selector
                    label="Asignar a"
                    [options]="staffOptions()"
                    [value]="draft.userId"
                    [helpText]="helpFor(draft)"
                    (valueChange)="pick(draft, $event)"
                  />
                  <app-textarea
                    label="Nota"
                    placeholder="Ej.: revisar el minibar"
                    [rows]="2"
                    [formControl]="draft.note"
                    [control]="draft.note"
                  />
                </div>
              }
            </div>
            @if (drafts().length > 0) {
              <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <app-button
                  variant="ghost"
                  customClasses="w-full min-h-11 sm:w-auto sm:min-h-0"
                  [disabled]="busy()"
                  (clicked)="skip()"
                  data-testid="checkout-clean-skip"
                >
                  Omitir
                </app-button>
                <app-button
                  variant="outline"
                  customClasses="w-full min-h-11 sm:w-auto sm:min-h-0"
                  [loading]="busy()"
                  (clicked)="accept()"
                  data-testid="checkout-clean-accept"
                >
                  <app-icon slot="icon" name="user-check" [size]="14" />
                  {{ drafts().length === 1 ? 'Asignar limpieza' : 'Asignar ' + drafts().length + ' limpiezas' }}
                </app-button>
              </div>
            }
          }
        }
      </section>
    }
  `,
})
export class CheckoutCleanSuggestionComponent {
  private readonly housekeeping = inject(LodgingHousekeepingService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Reservation that just checked out; null shows nothing. */
  readonly reservationId = input<number | null>(null);
  /** The clean was created or assigned. */
  readonly assigned = output<CheckoutCleanResultRow[]>();
  /** The desk skipped it: nothing was created. */
  readonly skipped = output<void>();

  protected readonly roleLabel = CLEANING_ROLE_LABEL;
  readonly state = signal<State>('loading');
  readonly busy = signal(false);
  readonly staff = signal<CheckoutCleanStaff[]>([]);
  readonly drafts = signal<RoomDraft[]>([]);
  readonly doneRooms = signal<CheckoutCleanRoom[]>([]);
  readonly saved = signal<CheckoutCleanResultRow[]>([]);

  /** Recommended order as the API ranks it, then "Sin asignar". */
  readonly staffOptions = computed<SelectorOption[]>(() => [
    ...this.staff().map((s) => ({
      value: s.id,
      label: s.is_cleaning_role ? `${s.name} · ${CLEANING_ROLE_LABEL}` : s.name,
      description: `${s.is_cleaning_role ? 'Recomendada' : 'Otro personal'} · ${pendingLabel(s.pending_tasks)}`,
    })),
    { value: UNASSIGNED, label: 'Sin asignar' },
  ]);

  constructor() {
    effect(() => {
      const id = this.reservationId();
      untracked(() => (id !== null ? this.load() : this.clear()));
    });
  }

  load(): void {
    const id = this.reservationId();
    if (id === null) return;
    this.clear();
    this.state.set('loading');
    this.housekeeping
      .checkoutCleanSuggestion(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (suggestion) => {
          this.staff.set(suggestion.staff);
          this.doneRooms.set(suggestion.rooms.filter((r) => r.existing_task?.status === 'done'));
          this.drafts.set(
            suggestion.rooms
              .filter((r) => r.existing_task?.status !== 'done')
              .map((room) => ({
                room,
                userId: room.suggested_user_id ?? UNASSIGNED,
                note: new FormControl(room.suggested_note ?? '', { nonNullable: true }),
              })),
          );
          this.state.set('ready');
        },
        error: () => this.state.set('error'),
      });
  }

  pick(draft: RoomDraft, value: string | number | null): void {
    const userId = value === null ? UNASSIGNED : Number(value);
    this.drafts.update((list) =>
      list.map((d) => (d.room.unit_id === draft.room.unit_id ? { ...d, userId } : d)),
    );
  }

  helpFor(draft: RoomDraft): string {
    if (draft.room.priority_reason) return draft.room.priority_reason;
    const first = this.staff()[0];
    return first?.is_cleaning_role ? `Primero el personal de ${CLEANING_ROLE_LABEL}` : '';
  }

  accept(): void {
    const id = this.reservationId();
    if (id === null || this.busy()) return;
    this.busy.set(true);
    this.housekeeping
      .assignCheckoutClean(
        id,
        this.drafts().map((d) => ({
          unit_id: d.room.unit_id,
          assigned_user_id: d.userId === UNASSIGNED ? null : d.userId,
          ...(d.note.value.trim() ? { notes: d.note.value.trim() } : {}),
        })),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.busy.set(false);
          this.saved.set(rows);
          this.state.set('saved');
          this.assigned.emit(rows);
        },
        error: (message: string) => {
          this.busy.set(false);
          this.toast.error(typeof message === 'string' ? message : 'No se pudo asignar la limpieza');
        },
      });
  }

  skip(): void {
    if (this.busy()) return;
    this.state.set('skipped');
    this.skipped.emit();
  }

  savedLabel(row: CheckoutCleanResultRow): string {
    if (row.outcome === 'done') return `Hab. ${row.code}: ya estaba limpia`;
    const who = this.staff().find((s) => s.id === row.assigned_user_id)?.name;
    return who ? `Hab. ${row.code}: limpieza asignada a ${who}` : `Hab. ${row.code}: limpieza creada sin asignar`;
  }

  private clear(): void {
    this.staff.set([]);
    this.drafts.set([]);
    this.doneRooms.set([]);
    this.saved.set([]);
    this.busy.set(false);
  }
}

function pendingLabel(count: number): string {
  if (count === 0) return 'sin tareas pendientes hoy';
  return count === 1 ? '1 tarea pendiente hoy' : `${count} tareas pendientes hoy`;
}
