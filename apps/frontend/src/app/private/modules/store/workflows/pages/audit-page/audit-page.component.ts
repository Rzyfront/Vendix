import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AlertBannerComponent,
  CardComponent,
  InputsearchComponent,
  PaginationComponent,
  SelectorComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import {
  DateRange,
  DateRangePickerComponent,
} from '../../../../../../shared/components/date-range-picker/date-range-picker.component';
import { ReportExportService } from '../../../reports/services/report-export.service';
import {
  WorkflowAuditApiService,
  WorkflowAuditCategory,
  WorkflowAuditEntry,
  WorkflowAuditFilters,
  WorkflowAuditVerification,
} from '../../services/workflow-audit-api.service';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import { Subscription } from 'rxjs';

const PAGE_SIZE = 25;

export const AUDIT_CATEGORY_OPTIONS: ReadonlyArray<{
  value: WorkflowAuditCategory | '';
  label: string;
}> = [
  { value: '', label: 'Todas las categorías' },
  { value: 'definition', label: 'Definiciones' },
  { value: 'decision', label: 'Decisiones' },
  { value: 'document', label: 'Documentos' },
  { value: 'secret', label: 'Secretos' },
  { value: 'export', label: 'Exportaciones' },
];

/** The sentence shown after "Verificar integridad". */
export function verificationMessage(v: WorkflowAuditVerification): string {
  return v.valid
    ? `Cadena íntegra: ${v.count} registros verificados`
    : `La cadena se rompe en el registro #${v.broken_at_seq ?? '?'}`;
}

/**
 * Immutable audit trail of Flows and Documents: filters by day range,
 * category and text, an integrity check of the hash chain, and the XLSX of
 * the same filters for an external audit. Rows are read-only by design.
 */
@Component({
  selector: 'app-workflow-audit-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    CardComponent,
    AlertBannerComponent,
    DateRangePickerComponent,
    SelectorComponent,
    InputsearchComponent,
    PaginationComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Auditoría"
        subtitle="Registro inmutable de definiciones, decisiones, accesos a documentos y secretos"
        icon="shield-check"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/workflows"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      <app-card [responsive]="true" overflow="visible">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3 md:items-end">
          <app-date-range-picker
            [showClear]="true"
            (dateRangeChange)="onRange($event)"
          />
          <app-selector
            label="Categoría"
            [options]="categoryOptions"
            [value]="category()"
            (valueChange)="onCategory($event)"
          />
          <app-inputsearch
            placeholder="Buscar en el resumen..."
            ariaLabel="Buscar en el resumen"
            (searchChange)="onSearch($event)"
          />
        </div>
      </app-card>

      @if (verification(); as v) {
        <app-alert-banner
          class="mt-3 block"
          [variant]="v.valid ? 'success' : 'danger'"
          [icon]="v.valid ? 'shield-check' : 'alert-triangle'"
        >
          <span data-testid="verification-message">{{ verificationText() }}</span>
        </app-alert-banner>
      }
      @if (loadError()) {
        <app-alert-banner
          class="mt-3 block"
          variant="danger"
          icon="alert-triangle"
          >{{ loadError() }}</app-alert-banner
        >
      }

      <app-card [responsive]="true" class="mt-3 block">
        @if (loading()) {
          <div class="p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando registros...</p>
          </div>
        } @else if (items().length === 0) {
          <p class="p-4 text-sm text-text-secondary" data-testid="audit-empty">
            No hay registros de auditoría con estos filtros.
          </p>
        } @else {
          <div class="hidden overflow-x-auto md:block">
            <table class="w-full text-sm" data-testid="audit-table">
              <thead>
                <tr class="border-b border-border text-left text-text-secondary">
                  <th class="px-2 py-2">Fecha</th>
                  <th class="px-2 py-2">Categoría</th>
                  <th class="px-2 py-2">Acción</th>
                  <th class="px-2 py-2">Actor</th>
                  <th class="px-2 py-2">Objeto</th>
                  <th class="px-2 py-2">Resumen</th>
                </tr>
              </thead>
              <tbody>
                @for (e of items(); track e.id) {
                  <tr class="border-b border-border/60 align-top">
                    <td class="whitespace-nowrap px-2 py-2">{{ when(e) }}</td>
                    <td class="px-2 py-2">{{ e.category_label }}</td>
                    <td class="px-2 py-2 font-medium text-text-primary">
                      {{ e.action_label }}
                    </td>
                    <td class="px-2 py-2">{{ e.actor.name }}</td>
                    <td class="px-2 py-2">{{ objectOf(e) }}</td>
                    <td class="px-2 py-2">{{ e.summary }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div class="space-y-2 md:hidden" data-testid="audit-cards">
            @for (e of items(); track e.id) {
              <div class="rounded-lg border border-border p-3 text-sm">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-medium text-text-primary">{{
                    e.action_label
                  }}</span>
                  <span class="text-xs text-text-secondary">{{
                    e.category_label
                  }}</span>
                </div>
                <p class="mt-1 text-text-primary">{{ e.summary }}</p>
                <p class="mt-1 text-xs text-text-secondary">
                  {{ when(e) }} · {{ e.actor.name }} · {{ objectOf(e) }}
                </p>
              </div>
            }
          </div>

          <app-pagination
            [currentPage]="page()"
            [totalPages]="totalPages()"
            [total]="total()"
            [limit]="pageSize"
            infoStyle="range"
            (pageChange)="onPage($event)"
          />
        }
      </app-card>
    </div>
  `,
})
export class AuditPageComponent implements OnInit {
  private readonly api = inject(WorkflowAuditApiService);
  private readonly toast = inject(ToastService);
  private readonly exporter = inject(ReportExportService);
  private readonly destroyRef = inject(DestroyRef);

  readonly categoryOptions = AUDIT_CATEGORY_OPTIONS.map((o) => ({ ...o }));
  readonly pageSize = PAGE_SIZE;

  readonly items = signal<WorkflowAuditEntry[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(0);
  readonly page = signal(1);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly verifying = signal(false);
  readonly exporting = signal(false);
  readonly verification = signal<WorkflowAuditVerification | null>(null);

  readonly category = signal<WorkflowAuditCategory | ''>('');
  private readonly search = signal('');
  private readonly range = signal<DateRange>({ from: null, to: null });

  readonly verificationText = computed(() => {
    const v = this.verification();
    return v ? verificationMessage(v) : '';
  });

  readonly headerActions = computed(() => [
    {
      id: 'verify',
      label: 'Verificar integridad',
      icon: 'shield-check',
      variant: 'outline' as const,
      loading: this.verifying(),
    },
    {
      id: 'export',
      label: 'Exportar',
      icon: 'download',
      variant: 'primary' as const,
      loading: this.exporting(),
    },
  ]);

  ngOnInit(): void {
    this.load();
  }

  onHeaderAction(id: string): void {
    if (id === 'verify') this.verify();
    if (id === 'export') this.export();
  }

  onRange(range: DateRange): void {
    this.range.set(range);
    this.reload();
  }

  onCategory(value: string | number | null): void {
    this.category.set(this.categoryOptions.some((o) => o.value === value) ? (value as WorkflowAuditCategory | '') : '');
    this.reload();
  }

  onSearch(text: string): void {
    this.search.set(text.trim());
    this.reload();
  }

  onPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  when(entry: WorkflowAuditEntry): string {
    return new Date(entry.created_at).toLocaleString('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  }

  objectOf(entry: WorkflowAuditEntry): string {
    return entry.target.id
      ? `${entry.target.type_label} #${entry.target.id}`
      : entry.target.type_label;
  }

  private filters(): WorkflowAuditFilters {
    const { from, to } = this.range();
    return {
      from: from ?? undefined,
      to: to ?? undefined,
      category: this.category() || undefined,
      search: this.search() || undefined,
    };
  }

  private listing: Subscription | null = null;

  private reload(): void {
    this.page.set(1);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set('');
    // Only the latest filters may fill the table: a slower, older answer is dropped.
    this.listing?.unsubscribe();
    this.listing = this.api
      .list(this.filters(), this.page(), PAGE_SIZE)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.items.set(res.items);
          this.total.set(res.total);
          this.totalPages.set(res.totalPages);
          this.loading.set(false);
        },
        error: (err) => {
          this.items.set([]);
          this.loading.set(false);
          this.loadError.set(toWorkflowError(err).message);
        },
      });
  }

  private verify(): void {
    if (this.verifying()) return;
    this.verifying.set(true);
    this.api
      .verify()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (v) => {
          this.verification.set(v);
          this.verifying.set(false);
        },
        error: (err) => {
          this.verifying.set(false);
          this.toast.error(toWorkflowError(err).message);
        },
      });
  }

  private export(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.api
      .export(this.filters())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.exporter.downloadBlob(blob, `auditoria-flujos-${new Date().toISOString().slice(0, 10)}`);
          this.exporting.set(false);
        },
        error: (err) => {
          this.exporting.set(false);
          this.toast.error(toWorkflowError(err).message);
        },
      });
  }
}
