import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { extractApiError } from '../../../../../../shared/utils/http-error.util';
import {
  Reminder,
  ReminderBucket,
  RemindersService,
} from '../../services/reminders.service';

interface ReminderGroup {
  bucket: ReminderBucket;
  label: string;
  tone: string;
  items: Reminder[];
}

const GROUP_ORDER: { bucket: ReminderBucket; label: string; tone: string }[] = [
  { bucket: 'overdue', label: 'Vencidos', tone: 'text-error' },
  { bucket: 'today', label: 'Hoy', tone: 'text-primary' },
  { bucket: 'upcoming', label: 'Próximos', tone: 'text-text-secondary' },
  { bucket: 'no_date', label: 'Sin fecha', tone: 'text-text-secondary' },
  { bucket: 'done', label: 'Hechos', tone: 'text-text-secondary' },
];

/** Store-local wall clock `YYYY-MM-DDTHH:mm` of a UTC instant (for datetime-local inputs). */
function toStoreWallClock(iso: string, tz: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const map: Record<string, string> = {};
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const hour = map['hour'] === '24' ? '00' : map['hour'];
  return `${map['year']}-${map['month']}-${map['day']}T${hour}:${map['minute']}`;
}

@Component({
  selector: 'app-reminders-log',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    TextareaComponent,
  ],
  template: `
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          class="text-xs font-medium text-text-secondary hover:text-primary transition-colors flex items-center gap-1.5 min-h-[36px]"
          [attr.aria-pressed]="showDone()"
          (click)="toggleDone()"
        >
          <app-icon [name]="showDone() ? 'eye-off' : 'eye'" [size]="14"></app-icon>
          {{ showDone() ? 'Ocultar hechos' : 'Ver hechos' }}
        </button>
        <app-button variant="primary" size="sm" (clicked)="openCreate()">
          <app-icon name="plus" [size]="14" slot="icon"></app-icon>
          Nuevo
        </app-button>
      </div>

      @if (loading()) {
        <div class="h-40 flex items-center justify-center">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      } @else if (groups().length === 0) {
        <app-empty-state
          icon="notebook-pen"
          title="Sin recordatorios"
          description="Crea uno aquí o pídeselo a Vex"
          [showActionButton]="false"
          size="sm"
        />
      } @else {
        @for (group of groups(); track group.bucket) {
          <section>
            <h4 class="text-xs font-semibold uppercase tracking-wide mb-2" [class]="group.tone">
              {{ group.label }} ({{ group.items.length }})
            </h4>
            <ul class="space-y-2">
              @for (item of group.items; track item.id) {
                <li
                  class="flex items-start gap-3 p-3 rounded-xl border border-border bg-surface"
                  [class.opacity-60]="item.status === 'done'"
                >
                  <button
                    type="button"
                    class="mt-0.5 shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors"
                    [class]="item.status === 'done' ? 'bg-primary border-primary text-white' : 'border-border hover:border-primary'"
                    [attr.aria-label]="item.status === 'done' ? 'Reabrir recordatorio' : 'Marcar como hecho'"
                    (click)="toggleStatus(item)"
                  >
                    @if (item.status === 'done') {
                      <app-icon name="check" [size]="14"></app-icon>
                    }
                  </button>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <p
                        class="text-sm font-medium text-text-primary break-words"
                        [class.line-through]="item.status === 'done'"
                      >
                        {{ item.title }}
                      </p>
                      @if (item.source === 'vex') {
                        <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">Vex</span>
                      }
                    </div>
                    @if (item.note) {
                      <p class="text-xs text-text-secondary mt-0.5 break-words">{{ item.note }}</p>
                    }
                    <div class="flex items-center gap-3 flex-wrap mt-1 text-xs text-text-secondary">
                      @if (item.remind_at) {
                        <span class="flex items-center gap-1">
                          <app-icon name="clock" [size]="12"></app-icon>
                          {{ formatDate(item.remind_at) }}
                        </span>
                      }
                      @if (item.link) {
                        <span class="flex items-center gap-1">
                          <app-icon name="link" [size]="12"></app-icon>
                          @if (item.link.url) {
                            <a [routerLink]="item.link.url" class="text-primary hover:underline">{{ item.link.label }}</a>
                          } @else {
                            <span>{{ item.link.label }}</span>
                          }
                        </span>
                      }
                    </div>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      class="w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-primary transition-colors"
                      aria-label="Editar recordatorio"
                      (click)="openEdit(item)"
                    >
                      <app-icon name="pencil" [size]="14"></app-icon>
                    </button>
                    <button
                      type="button"
                      class="w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary hover:bg-error/10 hover:text-error transition-colors"
                      aria-label="Eliminar recordatorio"
                      (click)="confirmDelete(item)"
                    >
                      <app-icon name="trash-2" [size]="14"></app-icon>
                    </button>
                  </div>
                </li>
              }
            </ul>
          </section>
        }
      }
    </div>

    <app-modal
      [(isOpen)]="modalOpen"
      [title]="editing() ? 'Editar recordatorio' : 'Nuevo recordatorio'"
      size="md"
    >
      <form [formGroup]="form" class="space-y-4" (ngSubmit)="save()">
        <app-input
          label="Título"
          placeholder="Ej: Llamar al proveedor de lácteos"
          [required]="true"
          [maxlength]="200"
          [control]="form.controls.title"
          [error]="titleError()"
        />
        <app-textarea
          label="Nota"
          placeholder="Detalles opcionales"
          [rows]="3"
          [control]="form.controls.note"
          [error]="noteError()"
        />
        <app-input
          label="Fecha y hora"
          type="datetime-local"
          helperText="Opcional. Hora de la tienda."
          [control]="form.controls.remind_at"
        />
      </form>
      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="outline" (clicked)="modalOpen.set(false)" [disabled]="saving()">
          Cancelar
        </app-button>
        <app-button variant="primary" (clicked)="save()" [loading]="saving()">
          Guardar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class RemindersLogComponent implements OnInit {
  private readonly remindersService = inject(RemindersService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly items = signal<Reminder[]>([]);
  readonly timezone = signal('America/Bogota');
  readonly loading = signal(true);
  readonly showDone = signal(false);
  readonly saving = signal(false);
  readonly modalOpen = signal(false);
  readonly editing = signal<Reminder | null>(null);
  readonly submitted = signal(false);

  readonly form = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    note: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    remind_at: new FormControl('', { nonNullable: true }),
  });

  /** Form status as a signal so the error computeds react while typing (zoneless). */
  private readonly formStatus = toSignal(this.form.statusChanges, {
    initialValue: this.form.status,
  });

  readonly groups = computed<ReminderGroup[]>(() => {
    const all = this.items();
    return GROUP_ORDER.map((g) => ({
      ...g,
      items: all.filter((r) => (g.bucket === 'done' ? r.status === 'done' : r.status === 'pending' && r.bucket === g.bucket)),
    })).filter((g) => g.items.length > 0);
  });

  readonly titleError = computed(() => {
    this.formStatus();
    if (!this.submitted()) return undefined;
    const ctrl = this.form.controls.title;
    if (ctrl.hasError('required')) return 'El título es obligatorio';
    if (ctrl.hasError('maxlength')) return 'Máximo 200 caracteres';
    return undefined;
  });

  readonly noteError = computed(() => {
    this.formStatus();
    if (!this.submitted()) return undefined;
    return this.form.controls.note.hasError('maxlength') ? 'Máximo 500 caracteres' : undefined;
  });

  ngOnInit(): void {
    this.load();
  }

  formatDate(iso: string): string {
    return formatStoreDateTime(iso, this.timezone());
  }

  toggleDone(): void {
    this.showDone.update((v) => !v);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.remindersService
      .list(this.showDone() ? 'all' : 'pending')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.items.set(res.items);
          this.timezone.set(res.timezone || this.timezone());
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(extractApiError(err).message ?? 'No se pudieron cargar los recordatorios');
        },
      });
  }

  openCreate(): void {
    this.editing.set(null);
    this.submitted.set(false);
    this.form.reset({ title: '', note: '', remind_at: '' });
    this.modalOpen.set(true);
  }

  openEdit(item: Reminder): void {
    this.editing.set(item);
    this.submitted.set(false);
    this.form.reset({
      title: item.title,
      note: item.note ?? '',
      remind_at: item.remind_at ? toStoreWallClock(item.remind_at, this.timezone()) : '',
    });
    this.modalOpen.set(true);
  }

  save(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const payload = {
      title: raw.title.trim(),
      note: raw.note.trim() || null,
      remind_at: raw.remind_at || null,
    };
    if (!payload.title) {
      this.form.controls.title.setValue('');
      return;
    }
    const current = this.editing();
    this.saving.set(true);
    const request$ = current
      ? this.remindersService.update(current.id, payload)
      : this.remindersService.create(payload);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.modalOpen.set(false);
        this.toast.success(current ? 'Recordatorio actualizado' : 'Recordatorio creado');
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(extractApiError(err).message ?? 'No se pudo guardar el recordatorio');
      },
    });
  }

  toggleStatus(item: Reminder): void {
    const status = item.status === 'done' ? 'pending' : 'done';
    this.remindersService
      .update(item.id, { status })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.load(),
        error: (err) =>
          this.toast.error(extractApiError(err).message ?? 'No se pudo actualizar el recordatorio'),
      });
  }

  async confirmDelete(item: Reminder): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Eliminar recordatorio',
      message: `¿Eliminar "${item.title}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.remindersService
      .remove(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Recordatorio eliminado');
          this.load();
        },
        error: (err) =>
          this.toast.error(extractApiError(err).message ?? 'No se pudo eliminar el recordatorio'),
      });
  }
}
