import {
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { Subject, catchError, of, switchMap } from 'rxjs';

import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { formatStoreDateTime, toStoreWallClock } from '../../../../../../shared/utils/date.util';
import { extractApiError } from '../../../../../../shared/utils/http-error.util';
import {
  CreateReminderPayload,
  Reminder,
  ReminderLinkOption,
  ReminderLinkType,
  RemindersService,
} from '../../services/reminders.service';
import {
  ReminderProgress,
  ReminderTimeTone,
  reminderProgress,
  sortReminders,
} from './reminders-log.util';

export interface ReminderRow {
  item: Reminder;
  progress: ReminderProgress | null;
  /** Parsed route of an available link: a plain string would encode `?invoiceId=`. */
  linkTree: UrlTree | null;
}

/** How often the time bars move forward. */
export const REMINDERS_CLOCK_MS = 60_000;

/** The link search starts at this many characters (the API requires it too). */
export const LINK_SEARCH_MIN_CHARS = 2;

/** The record chosen in the form: a search result, or the current link on edit. */
export interface ReminderLinkChoice {
  type: ReminderLinkType;
  type_label: string;
  id: number | null;
  label: string;
}

function sameLink(
  a: { type: ReminderLinkType; id: number | null } | null,
  b: { type: ReminderLinkType; id: number | null } | null,
): boolean {
  return (a?.type ?? null) === (b?.type ?? null) && (a?.id ?? null) === (b?.id ?? null);
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
    InputsearchComponent,
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
      } @else if (rows().length === 0) {
        <app-empty-state
          icon="notebook-pen"
          title="Sin recordatorios"
          description="Crea uno aquí o pídeselo a Vex"
          [showActionButton]="false"
          size="sm"
        />
      } @else {
        <ul class="space-y-2" data-testid="reminders-list">
          @for (row of rows(); track row.item.id) {
            <li
              class="p-3 rounded-xl border border-border bg-surface"
              [class.opacity-60]="row.item.status === 'done'"
              data-testid="reminder-row"
            >
              <div class="flex items-start gap-3">
                <div class="flex-1 min-w-0">
                  <p
                    class="text-sm font-medium text-text-primary truncate"
                    [class.line-through]="row.item.status === 'done'"
                    [title]="row.item.title"
                    data-testid="reminder-title"
                  >
                    {{ row.item.title }}
                  </p>
                  <p class="flex items-center gap-1 mt-0.5 text-xs text-text-secondary" data-testid="reminder-date">
                    <app-icon name="clock" [size]="12"></app-icon>
                    {{ row.item.remind_at ? formatDate(row.item.remind_at) : 'Sin fecha' }}
                  </p>
                  @if (row.item.link; as link) {
                    @if (row.linkTree) {
                      <a
                        [routerLink]="row.linkTree"
                        class="mt-1 inline-flex max-w-full items-center gap-1 text-xs font-medium text-primary hover:underline"
                        [attr.aria-label]="'Abrir ' + link.type_label + ': ' + link.label"
                        data-testid="reminder-link"
                      >
                        <app-icon name="link" [size]="12"></app-icon>
                        <span class="truncate">{{ link.type_label }} · {{ link.label }}</span>
                      </a>
                    } @else {
                      <p class="mt-1 flex items-center gap-1 text-xs text-text-secondary" data-testid="reminder-link">
                        <app-icon name="link" [size]="12"></app-icon>
                        <span class="truncate">{{ link.type_label }} · {{ link.label }}</span>
                        <span class="shrink-0 italic">(no disponible)</span>
                      </p>
                    }
                  }
                </div>
                <button
                  type="button"
                  class="shrink-0 min-h-[40px] sm:min-h-[44px] px-2.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition-colors flex items-center gap-1"
                  [attr.aria-label]="'Ver detalle de ' + row.item.title"
                  data-testid="reminder-detail-button"
                  (click)="openDetail(row.item)"
                >
                  <app-icon name="eye" [size]="14"></app-icon>
                  Ver detalle
                </button>
              </div>
              @if (row.progress; as progress) {
                <div class="mt-2 flex items-center gap-2">
                  <div
                    class="flex-1 h-1.5 rounded-full bg-border overflow-hidden"
                    role="progressbar"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    [attr.aria-valuenow]="progress.percent"
                    [attr.aria-valuetext]="progress.label"
                    [attr.aria-label]="'Tiempo transcurrido de ' + row.item.title"
                    data-testid="reminder-progress"
                  >
                    <div
                      class="h-full rounded-full transition-[width] duration-500"
                      [class]="toneBar[progress.tone]"
                      [style.width.%]="progress.percent"
                    ></div>
                  </div>
                  <span class="shrink-0 text-[11px] font-medium" [class]="toneText[progress.tone]">
                    {{ progress.label }}
                  </span>
                </div>
              }
            </li>
          }
        </ul>
      }
    </div>

    <app-modal
      [(isOpen)]="detailOpen"
      (closed)="detailId.set(null)"
      [title]="detail()?.title ?? 'Recordatorio'"
      subtitle="Detalle del recordatorio"
      size="md"
    >
      @if (detail(); as item) {
        <div class="space-y-4 text-sm" data-testid="reminder-detail">
          <div class="flex items-center gap-2 flex-wrap">
            <span
              class="text-xs font-semibold px-2 py-0.5 rounded-full"
              [class]="item.status === 'done' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'"
            >
              {{ item.status === 'done' ? 'Hecho' : 'Pendiente' }}
            </span>
            <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {{ sourceLabel(item.source) }}
            </span>
          </div>

          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
            <dt class="text-text-secondary">Fecha</dt>
            <dd class="text-text-primary">{{ item.remind_at ? formatDate(item.remind_at) : 'Sin fecha' }}</dd>
            @if (detailProgress(); as progress) {
              <dt class="text-text-secondary">Tiempo</dt>
              <dd [class]="toneText[progress.tone]">{{ progress.label }}</dd>
            }
            <dt class="text-text-secondary">Creado</dt>
            <dd class="text-text-primary">{{ formatDate(item.created_at) }}</dd>
            @if (item.completed_at) {
              <dt class="text-text-secondary">Completado</dt>
              <dd class="text-text-primary">{{ formatDate(item.completed_at) }}</dd>
            }
          </dl>

          <div>
            <p class="text-xs text-text-secondary mb-1">Nota</p>
            <p class="text-text-primary whitespace-pre-line break-words" data-testid="reminder-detail-note">
              {{ item.note || 'Sin nota' }}
            </p>
          </div>

          @if (item.link) {
            <div>
              <p class="text-xs text-text-secondary mb-1">Vinculado a</p>
              <p class="flex flex-wrap items-center gap-1.5">
                <app-icon name="link" [size]="14"></app-icon>
                <span class="text-text-secondary">{{ item.link.type_label }}:</span>
                @if (detailLinkTree(); as linkTree) {
                  <a
                    [routerLink]="linkTree"
                    class="text-primary hover:underline"
                    data-testid="reminder-detail-link"
                    (click)="detailOpen.set(false)"
                  >{{ item.link.label }}</a>
                } @else {
                  <span class="text-text-primary">{{ item.link.label }}</span>
                  <span class="text-xs italic text-text-secondary">(no disponible)</span>
                }
              </p>
            </div>
          }
        </div>
      }
      <div slot="footer" class="flex flex-wrap justify-end gap-2 sm:gap-3">
        @if (detail(); as item) {
          <app-button variant="outline-danger" (clicked)="confirmDelete(item)" [loading]="deleting()">
            <app-icon name="trash-2" [size]="14" slot="icon"></app-icon>
            Eliminar
          </app-button>
          <app-button variant="outline" (clicked)="editFromDetail(item)">
            <app-icon name="pencil" [size]="14" slot="icon"></app-icon>
            Editar
          </app-button>
          <app-button variant="primary" (clicked)="toggleStatus(item)" [loading]="toggling()">
            <app-icon [name]="item.status === 'done' ? 'rotate-ccw' : 'check'" [size]="14" slot="icon"></app-icon>
            {{ item.status === 'done' ? 'Marcar pendiente' : 'Marcar hecho' }}
          </app-button>
        }
      </div>
    </app-modal>

    <app-modal
      [(isOpen)]="modalOpen"
      [title]="editing() ? 'Editar recordatorio' : 'Nuevo recordatorio'"
      size="md"
    >
      <div class="space-y-4">
        <!-- formControlName carries the value (CVA); [control] only paints the errors. -->
        <form [formGroup]="form" class="space-y-4" (ngSubmit)="save()">
          <app-input
            label="Título"
            placeholder="Ej: Llamar al proveedor de lácteos"
            [required]="true"
            [maxlength]="200"
            formControlName="title"
            [control]="form.controls.title"
            [error]="titleError()"
          />
          <app-textarea
            label="Nota"
            placeholder="Detalles opcionales"
            [rows]="3"
            formControlName="note"
            [control]="form.controls.note"
            [error]="noteError()"
          />
          <app-input
            label="Fecha y hora"
            type="datetime-local"
            helperText="Opcional. Hora de la tienda."
            formControlName="remind_at"
            [control]="form.controls.remind_at"
          />
        </form>

        <!-- Outside the form: Enter in the search must not save the reminder. -->
        <div class="space-y-2" data-testid="reminder-link-field">
          <p class="text-sm font-medium text-text-primary">Vincular a</p>
          @if (selectedLink(); as link) {
            <div
              class="flex items-center gap-2 rounded-lg border border-border bg-surface p-2.5 text-sm"
              data-testid="reminder-link-selected"
            >
              <app-icon name="link" [size]="14"></app-icon>
              <span class="flex-1 min-w-0 truncate text-text-primary">{{ link.type_label }} · {{ link.label }}</span>
              <button
                type="button"
                class="shrink-0 min-h-[36px] px-2 rounded-lg text-xs font-medium text-text-secondary hover:text-error hover:bg-error/10 transition-colors flex items-center gap-1"
                [attr.aria-label]="'Quitar el vínculo con ' + link.label"
                (click)="clearLink()"
              >
                <app-icon name="x" [size]="14"></app-icon>
                Quitar
              </button>
            </div>
          } @else {
            <app-inputsearch
              placeholder="Buscar producto, orden, cliente, proveedor…"
              ariaLabel="Buscar un registro para vincular"
              (searchChange)="searchLink($event)"
            />
            @if (linkQuery().length < linkSearchMinChars) {
              <p class="text-xs text-text-secondary">Opcional. Escribe al menos 2 letras para buscar.</p>
            } @else if (linkSearching()) {
              <p class="text-xs text-text-secondary">Buscando…</p>
            } @else if (linkResults().length === 0) {
              <p class="text-xs text-text-secondary" data-testid="reminder-link-empty">Sin resultados en esta tienda.</p>
            } @else {
              <ul
                class="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border"
                aria-label="Registros para vincular"
              >
                @for (option of linkResults(); track option.type + ':' + option.id) {
                  <li>
                    <button
                      type="button"
                      class="w-full min-h-[44px] px-3 py-2 flex items-center gap-2 text-left text-sm hover:bg-primary/5 transition-colors"
                      data-testid="reminder-link-option"
                      (click)="selectLink(option)"
                    >
                      <span class="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        {{ option.type_label }}
                      </span>
                      <span class="flex-1 min-w-0 truncate text-text-primary">{{ option.label }}</span>
                    </button>
                  </li>
                }
              </ul>
            }
          }
        </div>
      </div>
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
  private readonly router = inject(Router);
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
  readonly detailOpen = signal(false);
  readonly detailId = signal<number | null>(null);
  readonly toggling = signal(false);
  readonly deleting = signal(false);
  /** Current instant; ticks every minute so the time bars advance. */
  readonly now = signal(Date.now());
  private readonly confirming = signal(false);

  readonly linkSearchMinChars = LINK_SEARCH_MIN_CHARS;
  readonly linkQuery = signal('');
  readonly linkResults = signal<ReminderLinkOption[]>([]);
  readonly linkSearching = signal(false);
  readonly selectedLink = signal<ReminderLinkChoice | null>(null);
  private readonly linkSearch$ = new Subject<string>(); // LEGÍTIMO — switchMap drops stale link searches

  readonly toneBar: Record<ReminderTimeTone, string> = {
    far: 'bg-success',
    near: 'bg-warning',
    overdue: 'bg-error',
  };
  readonly toneText: Record<ReminderTimeTone, string> = {
    far: 'text-success',
    near: 'text-warning',
    overdue: 'text-error',
  };

  /** True while a form, the detail or a confirmation is open: the host card must not rotate away. */
  readonly busy = computed(
    () =>
      this.modalOpen() ||
      this.detailOpen() ||
      this.confirming() ||
      this.saving() ||
      this.toggling() ||
      this.deleting(),
  );

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

  /** Compact rows: soonest due date first, then no date, then done. */
  readonly rows = computed<ReminderRow[]>(() => {
    const now = this.now();
    return sortReminders(this.items()).map((item) => ({
      item,
      progress: reminderProgress(item, now),
      linkTree: this.linkTree(item),
    }));
  });

  readonly detail = computed<Reminder | null>(() => {
    const id = this.detailId();
    return id === null ? null : (this.items().find((r) => r.id === id) ?? null);
  });

  readonly detailProgress = computed(() => {
    const item = this.detail();
    return item ? reminderProgress(item, this.now()) : null;
  });

  readonly detailLinkTree = computed(() => {
    const item = this.detail();
    return item ? this.linkTree(item) : null;
  });

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const timer = setInterval(() => this.now.set(Date.now()), REMINDERS_CLOCK_MS);
      this.destroyRef.onDestroy(() => clearInterval(timer));
    }
    this.linkSearch$
      .pipe(
        switchMap((q) =>
          q.length < LINK_SEARCH_MIN_CHARS
            ? of<ReminderLinkOption[]>([])
            : this.remindersService.searchLinks(q).pipe(
                catchError((err) => {
                  this.toast.error(extractApiError(err).message ?? 'No se pudo buscar el registro');
                  return of<ReminderLinkOption[]>([]);
                }),
              ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => {
        this.linkResults.set(results);
        this.linkSearching.set(false);
      });
  }

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

  /** The server answers a URL only for links the user may open; it may carry a query. */
  private linkTree(item: Reminder): UrlTree | null {
    const url = item.link?.available ? item.link.url : null;
    return url ? this.router.parseUrl(url) : null;
  }

  formatDate(iso: string): string {
    return formatStoreDateTime(iso, this.timezone());
  }

  /** De dónde salió el recordatorio: manual, Vex o el calendario tributario. */
  sourceLabel(source: Reminder['source']): string {
    switch (source) {
      case 'vex':
        return 'Creado por Vex';
      case 'fiscal':
        return 'Del calendario tributario';
      default:
        return 'Creado manualmente';
    }
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
          this.now.set(Date.now());
          this.loading.set(false);
          // The reminder shown in the detail is gone (deleted or hidden as done).
          if (this.detailOpen() && !this.detail()) this.closeDetail();
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(extractApiError(err).message ?? 'No se pudieron cargar los recordatorios');
        },
      });
  }

  openDetail(item: Reminder): void {
    this.detailId.set(item.id);
    this.detailOpen.set(true);
  }

  closeDetail(): void {
    this.detailOpen.set(false);
    this.detailId.set(null);
  }

  editFromDetail(item: Reminder): void {
    this.closeDetail();
    this.openEdit(item);
  }

  openCreate(): void {
    this.editing.set(null);
    this.submitted.set(false);
    this.form.reset({ title: '', note: '', remind_at: '' });
    this.selectedLink.set(null);
    this.resetLinkSearch();
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
    this.selectedLink.set(
      item.link
        ? { type: item.link.type, type_label: item.link.type_label, id: item.link.id, label: item.link.label }
        : null,
    );
    this.resetLinkSearch();
    this.modalOpen.set(true);
  }

  /** Called by the search box (already debounced). */
  searchLink(raw: string): void {
    const q = raw.trim();
    this.linkQuery.set(q);
    this.linkSearching.set(q.length >= LINK_SEARCH_MIN_CHARS);
    this.linkSearch$.next(q);
  }

  selectLink(option: ReminderLinkOption): void {
    this.selectedLink.set({
      type: option.type,
      type_label: option.type_label,
      id: option.id,
      label: option.label,
    });
    this.resetLinkSearch();
  }

  clearLink(): void {
    this.selectedLink.set(null);
    this.resetLinkSearch();
  }

  /** Empties the search and drops any request still in flight. */
  private resetLinkSearch(): void {
    this.linkQuery.set('');
    this.linkResults.set([]);
    this.linkSearching.set(false);
    this.linkSearch$.next('');
  }

  save(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const payload: CreateReminderPayload = {
      title: raw.title.trim(),
      note: raw.note.trim() || null,
      remind_at: raw.remind_at || null,
    };
    if (!payload.title) {
      this.form.controls.title.setValue('');
      return;
    }
    const current = this.editing();
    const link = this.selectedLink();
    // On edit an untouched link is omitted (stays as is); a removed one is sent as null.
    if (current ? !sameLink(link, current.link) : link !== null) {
      payload.link_type = link?.type ?? null;
      payload.link_id = link?.id ?? null;
    }
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
    if (this.toggling()) return;
    const status = item.status === 'done' ? 'pending' : 'done';
    this.toggling.set(true);
    this.remindersService
      .update(item.id, { status })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toggling.set(false);
          this.toast.success(status === 'done' ? 'Recordatorio marcado como hecho' : 'Recordatorio reabierto');
          this.load();
        },
        error: (err) => {
          this.toggling.set(false);
          this.toast.error(extractApiError(err).message ?? 'No se pudo actualizar el recordatorio');
        },
      });
  }

  async confirmDelete(item: Reminder): Promise<void> {
    if (this.deleting() || this.confirming()) return;
    this.confirming.set(true);
    let confirmed = false;
    try {
      confirmed = await this.dialog.confirm({
        title: 'Eliminar recordatorio',
        message: `¿Eliminar "${item.title}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      });
    } finally {
      this.confirming.set(false);
    }
    if (!confirmed) return;
    this.deleting.set(true);
    this.remindersService
      .remove(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.deleting.set(false);
          this.toast.success('Recordatorio eliminado');
          this.closeDetail();
          this.load();
        },
        error: (err) => {
          this.deleting.set(false);
          this.toast.error(extractApiError(err).message ?? 'No se pudo eliminar el recordatorio');
        },
      });
  }
}
