import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  ItemListCardConfig,
  ModalComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import {
  FiscalPeriodRow,
  OrgAccountingService,
} from '../../services/org-accounting.service';
import {
  ConsolidationSession,
  ConsolidationStatus,
  OrgConsolidationService,
} from '../../services/org-consolidation.service';

interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Component({
  selector: 'vendix-org-consolidation-list',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Sesiones"
          [value]="meta().total"
          smallText="Consolidaciones registradas"
          iconName="layers"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading()"
        />
        <app-stats
          title="En proceso"
          [value]="countByStatus('in_progress')"
          smallText="Página actual"
          iconName="loader"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading()"
        />
        <app-stats
          title="Completadas"
          [value]="countByStatus('completed')"
          smallText="Página actual"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading()"
        />
        <app-stats
          title="Borradores"
          [value]="countByStatus('draft')"
          smallText="Página actual"
          iconName="file-edit"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading()"
        />
      </div>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudieron cargar las sesiones">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [responsive]="true" [padding]="false">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <div>
              <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
                Sesiones de consolidación ({{ meta().total }})
              </h2>
              <p class="hidden text-sm text-text-secondary md:block">
                Combinan los estados financieros de las tiendas de la organización
                y eliminan operaciones intercompañía.
              </p>
            </div>

            <app-button variant="primary" size="sm" (clicked)="openCreate()">
              <app-icon name="plus" [size]="16" slot="icon"></app-icon>
              Nueva sesión
            </app-button>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="rows()"
            [columns]="tableColumns"
            [actions]="tableActions"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            [sortable]="true"
            emptyTitle="Sin sesiones"
            emptyMessage="Sin sesiones"
            emptyDescription="Aún no has creado ninguna sesión de consolidación."
            emptyIcon="layers"
            emptyActionText="Nueva sesión"
            emptyActionIcon="plus"
            [showEmptyAction]="true"
            (rowClick)="openDetail($event)"
            (emptyActionClick)="openCreate()"
          />

          @if (meta().totalPages > 1) {
            <div class="mt-4 flex justify-center border-t border-border pt-3">
              <app-pagination
                [currentPage]="meta().page"
                [totalPages]="meta().totalPages"
                [total]="meta().total"
                [limit]="meta().limit"
                infoStyle="none"
                (pageChange)="changePage($event)"
              />
            </div>
          }
        </div>
      </app-card>
    </div>

    <app-modal
      [(isOpen)]="createOpen"
      title="Nueva sesión de consolidación"
      subtitle="Selecciona el período fiscal a consolidar"
      size="md"
      (closed)="onModalClosed()"
    >
      <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="submitCreate()">
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-text-primary" for="cons-name">
            Nombre
          </label>
          <app-input
            id="cons-name"
            formControlName="name"
            placeholder="Consolidación Q1 2026"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-text-primary" for="cons-period">
            Período fiscal
          </label>
          <select
            id="cons-period"
            formControlName="fiscal_period_id"
            class="h-10 w-full rounded-lg border border-border bg-[var(--color-surface)] px-3 text-sm text-text-primary focus:border-primary focus:outline-none"
          >
            <option [ngValue]="null" disabled>Selecciona un período…</option>
            @for (period of periods(); track period.id) {
              <option [ngValue]="period.id">{{ periodLabel(period) }}</option>
            }
          </select>
          @if (periodsLoading()) {
            <span class="text-xs text-text-secondary">Cargando períodos…</span>
          }
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-text-primary" for="cons-notes">
            Notas (opcional)
          </label>
          <textarea
            id="cons-notes"
            formControlName="notes"
            rows="3"
            class="w-full rounded-lg border border-border bg-[var(--color-surface)] px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
            placeholder="Observaciones internas…"
          ></textarea>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" size="sm" (clicked)="createOpen.set(false)">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="sm"
          [loading]="submitting()"
          [disabled]="form.invalid || submitting()"
          (clicked)="submitCreate()"
        >
          <app-icon name="check" [size]="16" slot="icon"></app-icon>
          Crear sesión
        </app-button>
      </div>
    </app-modal>
  `,
})
export class OrgConsolidationListComponent {
  private readonly service = inject(OrgConsolidationService);
  private readonly accountingService = inject(OrgAccountingService);
  private readonly errors = inject(ApiErrorService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly rows = signal<ConsolidationSession[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly meta = signal<PageMeta>({ total: 0, page: 1, limit: 20, totalPages: 1 });

  readonly createOpen = signal(false);
  readonly submitting = signal(false);
  readonly periods = signal<FiscalPeriodRow[]>([]);
  readonly periodsLoading = signal(false);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    fiscal_period_id: this.fb.control<number | null>(null, [Validators.required]),
    notes: ['', [Validators.maxLength(1000)]],
  });

  readonly tableActions: TableAction[] = [
    {
      label: 'Abrir',
      icon: 'arrow-right',
      variant: 'primary',
      action: (row: ConsolidationSession) => this.openDetail(row),
    },
  ];

  readonly tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1, defaultValue: '—' },
    {
      key: 'fiscal_period.name',
      label: 'Período',
      priority: 2,
      defaultValue: '—',
    },
    {
      key: 'session_date',
      label: 'Fecha',
      align: 'center',
      priority: 3,
      transform: (value) => this.formatDate(value),
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          completed: 'success',
          in_progress: 'info',
          draft: 'warn',
          cancelled: 'danger',
        },
      },
      transform: (value) => this.statusLabel(String(value || '')),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleTransform: (item) => item?.fiscal_period?.name || 'Sin período',
    avatarFallbackIcon: 'layers',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        completed: 'success',
        in_progress: 'info',
        draft: 'warn',
        cancelled: 'danger',
      },
    },
    badgeTransform: (value) => this.statusLabel(String(value || '')),
    detailKeys: [
      {
        key: 'session_date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (value) => this.formatDate(value),
      },
    ],
  };

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.service
      .listSessions({ page: this.meta().page, limit: this.meta().limit })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res?.data ?? []);
          this.meta.set(this.normalizeMeta(res?.meta));
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar las sesiones.'),
          );
          this.rows.set([]);
          this.loading.set(false);
        },
      });
  }

  changePage(page: number): void {
    this.meta.update((m) => ({ ...m, page }));
    this.load();
  }

  countByStatus(status: ConsolidationStatus): number {
    return this.rows().filter((r) => r.status === status).length;
  }

  openDetail(session: ConsolidationSession): void {
    void this.router.navigate(['/admin/accounting/consolidation', session.id]);
  }

  openCreate(): void {
    this.form.reset({ name: '', fiscal_period_id: null, notes: '' });
    this.createOpen.set(true);
    this.loadPeriods();
  }

  onModalClosed(): void {
    this.submitting.set(false);
  }

  submitCreate(): void {
    if (this.form.invalid || this.submitting()) return;
    const { name, fiscal_period_id, notes } = this.form.getRawValue();
    if (fiscal_period_id == null) return;

    this.submitting.set(true);
    this.service
      .createSession({
        name: name.trim(),
        fiscal_period_id,
        ...(notes?.trim() ? { notes: notes.trim() } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          this.createOpen.set(false);
          this.toast.success('Sesión de consolidación creada.');
          const created = res?.data;
          if (created?.id) {
            this.openDetail(created);
          } else {
            this.load();
          }
        },
        error: (err) => {
          this.submitting.set(false);
          this.toast.error(
            this.errors.humanize(err, 'No se pudo crear la sesión.'),
          );
        },
      });
  }

  private loadPeriods(): void {
    if (this.periods().length) return;
    this.periodsLoading.set(true);
    this.accountingService
      .getFiscalPeriods({ limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.periods.set(res?.data ?? []);
          this.periodsLoading.set(false);
        },
        error: () => {
          this.periods.set([]);
          this.periodsLoading.set(false);
        },
      });
  }

  periodLabel(period: FiscalPeriodRow): string {
    const range =
      period.start_date && period.end_date
        ? ` (${this.formatDate(period.start_date)} – ${this.formatDate(period.end_date)})`
        : '';
    return `${period.name ?? `Período #${period.id}`}${range}`;
  }

  formatDate(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '—';
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      in_progress: 'En proceso',
      completed: 'Completada',
      cancelled: 'Cancelada',
    };
    return labels[status] || status || '—';
  }

  private normalizeMeta(meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    total_pages?: number;
  }): PageMeta {
    const total = Number(meta?.total || 0);
    const limit = Number(meta?.limit || 20);
    const page = Number(meta?.page || 1);
    const totalPages = Number(
      meta?.totalPages || meta?.total_pages || Math.max(1, Math.ceil(total / limit)),
    );
    return { total, page, limit, totalPages };
  }
}
