/**
 * Operaciones masivas de remisiones (S1, S2, S4).
 *
 * Acciones: Imprimir (un solo diálogo, formato `dispatch_note` de Print
 * Formats), Confirmar, Entregar y Anular. Las tres últimas reutilizan los
 * endpoints individuales de `DispatchNotesService` EN SERIE; el fallo de una
 * remisión no detiene las demás y cada una reporta su propio desenlace.
 *
 * - `selectedIds` vive aquí (no en el listado) y `noteCache` solo crece, así la
 *   selección sobrevive al paginado y al cambio de filtros.
 * - Los permisos son affordance de UI; el backend refuerza por nombre.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';

import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ModalComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StickyHeaderComponent,
  TableColumn,
  TextareaComponent,
  ToastService,
  type StickyHeaderActionButton,
} from '../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../shared/utils/date.util';
import {
  DIRECTION_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  SUBTYPE_COLORS,
  SUBTYPE_LABELS,
} from '../constants/dispatch-note.constants';
import {
  DispatchNote,
  DispatchNoteDirection,
  DispatchNoteQuery,
  DispatchNoteStatus,
  DispatchNoteSubtype,
} from '../interfaces/dispatch-note.interface';
import { DispatchNotePrintService } from '../services/dispatch-note-print.service';
import { DispatchNotesService } from '../services/dispatch-notes.service';

/** Máximo de remisiones por operación masiva. */
export const MAX_BULK_DISPATCH_NOTES = 100;
const PAGE_SIZE = 20;
const VOID_REASON_MAX = 500;

type MutatingActionId = 'confirm' | 'deliver' | 'void';

interface MutatingActionDef {
  id: MutatingActionId;
  label: string;
  /** Verbo en infinitivo para el título del modal. */
  verb: string;
  icon: string;
  variant: 'primary' | 'outline' | 'danger';
  permission: string;
  /** Texto del resultado exitoso por fila. */
  doneLabel: string;
  /** Motivo de omisión cuando la remisión no es elegible, o null si lo es. */
  skipReason: (note: DispatchNote) => string | null;
  warning: string;
}

/**
 * Reglas de elegibilidad. Calcan las del listado individual
 * (`dispatch-note-list.component.ts`: Confirmar = draft; Entregar = confirmed +
 * outbound) y, para anular, la regla de la spec S2: todo lo que no esté ya
 * anulado ni facturado.
 */
const MUTATING_ACTIONS: Record<MutatingActionId, MutatingActionDef> = {
  confirm: {
    id: 'confirm',
    label: 'Confirmar',
    verb: 'Confirmar',
    icon: 'check',
    variant: 'primary',
    permission: 'store:dispatch_notes:confirm',
    doneLabel: 'Confirmada',
    skipReason: (n) =>
      n.status === 'draft' ? null : 'Solo se confirman borradores',
    warning:
      'Las remisiones con líneas serializadas pueden requerir los seriales y fallarán; confírmalas desde su detalle.',
  },
  deliver: {
    id: 'deliver',
    label: 'Entregar',
    verb: 'Entregar',
    icon: 'truck',
    variant: 'primary',
    permission: 'store:dispatch_notes:deliver',
    doneLabel: 'Entregada',
    skipReason: (n) =>
      n.status !== 'confirmed'
        ? 'Solo se entregan remisiones confirmadas'
        : n.direction !== 'outbound'
          ? 'Solo se entregan remisiones de salida'
          : null,
    warning:
      'Entregar es irreversible: la mercancía sale de bodega, se descuenta el stock y se registra el costo de venta.',
  },
  void: {
    id: 'void',
    label: 'Anular',
    verb: 'Anular',
    icon: 'x-circle',
    variant: 'danger',
    permission: 'store:dispatch_notes:void',
    doneLabel: 'Anulada',
    skipReason: (n) =>
      n.status === 'voided'
        ? 'Ya está anulada'
        : n.status === 'invoiced'
          ? 'Está facturada y no se puede anular'
          : null,
    warning: 'Anular no se puede deshacer.',
  },
};

export interface BulkRowResult {
  id: number;
  number: string;
  outcome: 'ok' | 'error' | 'skipped';
  message: string;
}

type ModalStage = 'confirm' | 'running' | 'done';

@Component({
  selector: 'app-dispatch-notes-bulk-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputsearchComponent,
    ModalComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    StickyHeaderComponent,
    TextareaComponent,
  ],
  templateUrl: './dispatch-notes-bulk-page.component.html',
})
export class DispatchNotesBulkPageComponent {
  private readonly notesService = inject(DispatchNotesService);
  private readonly printService = inject(DispatchNotePrintService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly authFacade = inject(AuthFacade);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly maxIds = MAX_BULK_DISPATCH_NOTES;
  readonly voidReasonMax = VOID_REASON_MAX;
  readonly limit = PAGE_SIZE;

  // ── Listado (servidor) ────────────────────────────────────────────────────
  readonly notes = signal<DispatchNote[]>([]);
  readonly fetching = signal(false);
  readonly page = signal(1);
  readonly totalItems = signal(0);
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.limit)),
  );
  readonly searchTerm = signal('');
  readonly selectedStatus = signal('');

  readonly statusOptions: ReadonlyArray<{ value: string; label: string }> = [
    { value: '', label: 'Todos los estados' },
    ...(Object.keys(STATUS_LABELS) as DispatchNoteStatus[]).map((value) => ({
      value,
      label: STATUS_LABELS[value],
    })),
  ];

  // ── Selección ─────────────────────────────────────────────────────────────
  /** Modelo de `app-responsive-data-view`; la tabla y las tarjetas lo comparten. */
  readonly selectedIds = signal<Set<string | number>>(new Set());
  /** `id → remisión`; solo crece, para operar filas de páginas anteriores. */
  private readonly noteCache = signal<Map<number, DispatchNote>>(new Map());
  private lastSelection = new Set<number>();

  readonly selectedNotes = computed<DispatchNote[]>(() => {
    const cache = this.noteCache();
    const out: DispatchNote[] = [];
    for (const id of this.selectedIds()) {
      const note = cache.get(Number(id));
      if (note) out.push(note);
    }
    return out;
  });
  readonly selectedCount = computed(() => this.selectedIds().size);
  readonly overLimit = computed(() => this.selectedCount() > this.maxIds);

  // ── Permisos ──────────────────────────────────────────────────────────────
  readonly canPrint = computed(() =>
    this.authFacade.hasPermission('store:dispatch_notes:print'),
  );

  // ── Ejecución ─────────────────────────────────────────────────────────────
  readonly printing = signal(false);
  readonly running = signal(false);
  readonly modalOpen = signal(false);
  readonly modalStage = signal<ModalStage>('confirm');
  readonly activeAction = signal<MutatingActionDef | null>(null);
  readonly voidReason = signal('');
  readonly results = signal<BulkRowResult[]>([]);
  readonly progressDone = signal(0);

  /** Partición de la selección según la acción activa. */
  readonly plan = computed(() => {
    const action = this.activeAction();
    const eligible: DispatchNote[] = [];
    const skipped: BulkRowResult[] = [];
    if (!action) return { eligible, skipped };
    for (const note of this.selectedNotes()) {
      const reason = action.skipReason(note);
      if (reason) {
        skipped.push({
          id: note.id,
          number: note.dispatch_number,
          outcome: 'skipped',
          message: reason,
        });
      } else {
        eligible.push(note);
      }
    }
    return { eligible, skipped };
  });

  readonly voidReasonValid = computed(() => {
    const len = this.voidReason().trim().length;
    return len > 0 && len <= this.voidReasonMax;
  });

  readonly canRun = computed(() => {
    const action = this.activeAction();
    if (!action || this.running()) return false;
    if (this.plan().eligible.length === 0) return false;
    return action.id === 'void' ? this.voidReasonValid() : true;
  });

  readonly resultCounts = computed(() => {
    const r = this.results();
    return {
      ok: r.filter((x) => x.outcome === 'ok').length,
      error: r.filter((x) => x.outcome === 'error').length,
      skipped: r.filter((x) => x.outcome === 'skipped').length,
    };
  });

  // ── Header ────────────────────────────────────────────────────────────────
  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    { id: 'back', label: 'Volver', variant: 'outline', icon: 'arrow-left' },
    {
      id: 'print',
      label: 'Imprimir',
      variant: 'primary',
      icon: 'printer',
      visible: this.canPrint(),
      loading: this.printing(),
      disabled:
        this.selectedCount() === 0 ||
        this.overLimit() ||
        this.running() ||
        this.printing(),
    },
  ]);

  readonly headerMetadata = computed(() => {
    const n = this.selectedCount();
    return `${n} ${n === 1 ? 'seleccionada' : 'seleccionadas'} (máx. ${this.maxIds})`;
  });

  readonly blockedReason = computed(() => {
    if (this.selectedCount() === 0) {
      return 'Selecciona al menos una remisión para ejecutar una operación masiva';
    }
    if (this.overLimit()) {
      return `Máximo ${this.maxIds} remisiones por operación. Tienes ${this.selectedCount()} seleccionadas.`;
    }
    return '';
  });

  /** Botones de acción visibles según permisos. */
  readonly mutatingActions = computed<MutatingActionDef[]>(() =>
    (Object.values(MUTATING_ACTIONS) as MutatingActionDef[]).filter((a) =>
      this.authFacade.hasPermission(a.permission),
    ),
  );

  // ── Configuración del data view ───────────────────────────────────────────
  readonly columns: TableColumn[] = [
    { key: 'dispatch_number', label: 'No. Remisión', width: '130px', priority: 1 },
    {
      key: 'direction',
      label: 'Dir.',
      width: '90px',
      priority: 2,
      transform: (v: DispatchNoteDirection) => DIRECTION_LABELS[v] ?? v ?? '—',
    },
    {
      key: 'subtype',
      label: 'Tipo',
      priority: 3,
      badge: true,
      badgeConfig: { type: 'custom', size: 'sm', colorMap: SUBTYPE_COLORS },
      transform: (v: DispatchNoteSubtype) => SUBTYPE_LABELS[v] ?? v ?? '—',
    },
    { key: 'customer_name', label: 'Cliente', defaultValue: '-', priority: 2 },
    {
      key: 'emission_date',
      label: 'Fecha',
      priority: 3,
      transform: (v: string) => (v ? formatDateOnlyUTC(v) : '-'),
    },
    {
      key: 'grand_total',
      label: 'Total',
      align: 'right',
      priority: 2,
      transform: (v: unknown) => this.formatCurrency(v),
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      priority: 1,
      badgeConfig: { type: 'custom', size: 'sm', colorMap: STATUS_COLORS },
      transform: (v: DispatchNoteStatus) => STATUS_LABELS[v] ?? v,
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'dispatch_number',
    titleTransform: (item: DispatchNote) => `#${item.dispatch_number}`,
    subtitleTransform: (item: DispatchNote) => {
      const sub = item.subtype ? (SUBTYPE_LABELS[item.subtype] ?? '') : '';
      const name = item.customer_name || 'Sin cliente';
      return sub ? `${sub} · ${name}` : name;
    },
    avatarFallbackIcon: 'file-text',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: { type: 'custom', size: 'sm', colorMap: STATUS_COLORS },
    badgeTransform: (v: DispatchNoteStatus) => STATUS_LABELS[v] ?? v,
    footerKey: 'grand_total',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (v: unknown) => this.formatCurrency(v),
    detailKeys: [
      {
        key: 'emission_date',
        label: 'Fecha',
        transform: (v: string) => (v ? formatDateOnlyUTC(v) : '-'),
      },
    ],
  };

  constructor() {
    this.fetchPage();
  }

  // ── Carga ─────────────────────────────────────────────────────────────────
  private buildQuery(): DispatchNoteQuery {
    const query: DispatchNoteQuery = { page: this.page(), limit: this.limit };
    if (this.searchTerm()) query.search = this.searchTerm();
    if (this.selectedStatus()) {
      query.status = this.selectedStatus() as DispatchNoteStatus;
    }
    return query;
  }

  private fetchPage(): void {
    this.fetching.set(true);
    this.notesService
      .getDispatchNotes(this.buildQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          // El servicio ya desenvuelve `r.data || r`; tolera ambas formas.
          const raw = response as unknown as
            | DispatchNote[]
            | {
                data?: DispatchNote[];
                pagination?: { total?: number };
                meta?: { pagination?: { total?: number }; total?: number };
              };
          const rows = Array.isArray(raw) ? raw : (raw.data ?? []);
          const total = Array.isArray(raw)
            ? rows.length
            : (raw.pagination?.total ??
              raw.meta?.pagination?.total ??
              raw.meta?.total ??
              rows.length);
          this.notes.set(rows);
          this.totalItems.set(total);
          this.noteCache.update((prev) => {
            const next = new Map(prev);
            rows.forEach((n) => next.set(n.id, n));
            return next;
          });
          this.fetching.set(false);
        },
        error: (err: unknown) => {
          this.toast.error(extractApiErrorMessage(err));
          this.fetching.set(false);
        },
      });
  }

  // ── Handlers de UI ────────────────────────────────────────────────────────
  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    this.page.set(1);
    this.fetchPage();
  }

  onStatusChange(value: string): void {
    this.selectedStatus.set(value);
    this.page.set(1);
    this.fetchPage();
  }

  onPageChanged(page: number): void {
    this.page.set(page);
    this.fetchPage();
  }

  /**
   * Recibe la selección del data view y aplica el tope. Si el operador cruza
   * el máximo (p. ej. con "seleccionar todo"), se revierte a la selección
   * previa recortada hasta completar el cupo.
   */
  onSelectionChange(next: Set<string | number>): void {
    if (next.size <= this.maxIds) {
      this.selectedIds.set(next);
      this.lastSelection = new Set([...next].map(Number));
      return;
    }
    const kept = new Set<string | number>();
    for (const id of next) {
      if (kept.size >= this.maxIds) break;
      if (this.lastSelection.has(Number(id))) kept.add(id);
    }
    for (const id of next) {
      if (kept.size >= this.maxIds) break;
      kept.add(id);
    }
    this.selectedIds.set(kept);
    this.lastSelection = new Set([...kept].map(Number));
    this.toast.warning(
      `Llegaste al máximo de ${this.maxIds} remisiones. Quita alguna para seleccionar otra.`,
    );
  }

  onClearSelection(): void {
    this.selectedIds.set(new Set());
    this.lastSelection = new Set();
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'back') {
      void this.router.navigate(['/admin/orders/dispatch-notes']);
    } else if (actionId === 'print') {
      void this.runPrint();
    }
  }

  private async runPrint(): Promise<void> {
    if (this.printing() || this.selectedCount() === 0 || this.overLimit()) return;
    this.printing.set(true);
    try {
      // Muestra solo lo que el servicio necesita; él avisa omitidas y fallidas.
      const result = await this.printService.printDispatchNotes(
        this.selectedNotes(),
      );
      if (result.printed > 0) {
        this.toast.success(
          `${result.printed} ${result.printed === 1 ? 'remisión enviada' : 'remisiones enviadas'} a impresión`,
        );
      }
    } catch (err) {
      this.toast.error(extractApiErrorMessage(err));
    } finally {
      this.printing.set(false);
    }
  }

  openAction(id: MutatingActionId): void {
    if (this.running()) return;
    if (this.selectedCount() === 0) {
      this.toast.warning('Selecciona al menos una remisión');
      return;
    }
    if (this.overLimit()) {
      this.toast.warning(`Máximo ${this.maxIds} remisiones por operación`);
      return;
    }
    this.activeAction.set(MUTATING_ACTIONS[id]);
    this.voidReason.set('');
    this.results.set([]);
    this.progressDone.set(0);
    this.modalStage.set('confirm');
    this.modalOpen.set(true);
  }

  onModalOpenChange(open: boolean): void {
    // No se puede cerrar mientras corre la tanda.
    if (!open && this.running()) return;
    this.modalOpen.set(open);
  }

  closeModal(): void {
    if (this.running()) return;
    this.modalOpen.set(false);
  }

  // ── Ejecución en serie ────────────────────────────────────────────────────
  async runAction(): Promise<void> {
    const action = this.activeAction();
    if (!action || !this.canRun()) return;

    const { eligible, skipped } = this.plan();
    const reason = this.voidReason().trim();
    this.running.set(true);
    this.modalStage.set('running');
    this.progressDone.set(0);
    this.results.set([...skipped]);

    for (const note of eligible) {
      let row: BulkRowResult;
      try {
        await firstValueFrom(this.call(action.id, note.id, reason));
        row = {
          id: note.id,
          number: note.dispatch_number,
          outcome: 'ok',
          message: action.doneLabel,
        };
      } catch (err) {
        row = {
          id: note.id,
          number: note.dispatch_number,
          outcome: 'error',
          message: extractApiErrorMessage(err),
        };
      }
      this.results.update((prev) => [...prev, row]);
      this.progressDone.update((n) => n + 1);
    }

    this.notesService.invalidateCache();
    this.running.set(false);
    this.modalStage.set('done');

    // Quita de la selección las que salieron bien; las fallidas/omitidas quedan.
    const okIds = new Set(
      this.results()
        .filter((r) => r.outcome === 'ok')
        .map((r) => r.id),
    );
    this.selectedIds.update((prev) => {
      const next = new Set<string | number>();
      for (const id of prev) if (!okIds.has(Number(id))) next.add(id);
      return next;
    });
    this.lastSelection = new Set([...this.selectedIds()].map(Number));
    this.fetchPage();
  }

  private call(
    id: MutatingActionId,
    noteId: number,
    reason: string,
  ): Observable<DispatchNote> {
    switch (id) {
      case 'confirm':
        return this.notesService.confirm(noteId);
      case 'deliver':
        return this.notesService.deliver(noteId);
      case 'void':
        return this.notesService.void(noteId, { void_reason: reason });
    }
  }

  private formatCurrency(value: unknown): string {
    const num =
      typeof value === 'string' ? parseFloat(value) : Number(value ?? 0);
    return this.currencyService.format(Number.isFinite(num) ? num : 0);
  }
}
