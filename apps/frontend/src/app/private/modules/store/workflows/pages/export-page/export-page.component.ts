import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  StickyHeaderComponent,
} from '../../../../../../shared/components/index';
import {
  WorkflowExport,
  WorkflowExportApiService,
  WorkflowExportStatus,
} from '../../services/workflow-export-api.service';
import { toWorkflowError } from '../../utils/workflow-errors.util';

/** How often the list refreshes while an export is pending or running. */
export const EXPORT_POLL_MS = 5000;

export const EXPORT_STATUS_LABELS: Record<WorkflowExportStatus, string> = {
  pending: 'Pendiente',
  running: 'Generando',
  ready: 'Lista',
  failed: 'Falló',
  expired: 'Vencida',
};

const STATUS_CLASSES: Record<WorkflowExportStatus, string> = {
  pending: 'bg-warning/10 text-warning',
  running: 'bg-primary/10 text-primary',
  ready: 'bg-success/10 text-success',
  failed: 'bg-error/10 text-error',
  expired: 'bg-border text-text-secondary',
};

const DATE_TIME = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Bytes as `1,5 MB` (es-CO decimals). */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = new Intl.NumberFormat('es-CO', { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value);
  return `${text} ${UNITS[unit]}`;
}

/**
 * "Exportación" (Flujos P7.6): requests the full ZIP of flows, requests, dossiers
 * with their files, records, documents and the audit trail, lists the latest
 * exports and downloads a ready one. It refreshes on its own only while an
 * export is pending or running, and stops when the screen is closed.
 */
@Component({
  selector: 'app-workflow-export-page',
  standalone: true,
  imports: [StickyHeaderComponent, CardComponent, ButtonComponent, AlertBannerComponent],
  template: `
    <div class="w-full overflow-x-hidden" data-testid="export-page">
      <app-sticky-header
        title="Exportación"
        subtitle="Descarga toda tu información de Flujos en un ZIP"
        icon="download"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/workflows"
      />

      <app-card [responsive]="true" title="Qué incluye el ZIP">
        <ul class="list-disc space-y-1 pl-5 text-sm text-text-primary">
          <li>Tus flujos con sus permisos y todas sus versiones publicadas.</li>
          <li>Las solicitudes con sus eventos, tareas, votos, comentarios y aprobaciones.</li>
          <li>Los expedientes con sus archivos adjuntos vigentes.</li>
          <li>Las colecciones personalizadas y sus registros.</li>
          <li>Plantillas, documentos emitidos y firmas con su evidencia.</li>
          <li>La auditoría completa, con el hash de cada registro para verificarla.</li>
        </ul>
        <p class="mt-3 text-xs text-text-secondary">
          Nunca incluye los valores de tus secretos, claves ni enlaces privados. La
          exportación se prepara en segundo plano, te avisamos cuando esté lista y
          queda disponible 7 días.
        </p>
        <div class="mt-4">
          <app-button
            variant="primary"
            size="sm"
            [loading]="requesting()"
            [disabled]="requesting()"
            (clicked)="requestExport()"
            >Generar exportación</app-button
          >
        </div>
      </app-card>

      @if (message(); as text) {
        <app-alert-banner variant="warning" icon="alert-triangle" data-testid="export-message">{{
          text
        }}</app-alert-banner>
      }
      @if (loadError(); as text) {
        <app-alert-banner variant="danger" icon="alert-triangle">{{ text }}</app-alert-banner>
      }

      <app-card [responsive]="true" title="Tus exportaciones" class="mt-3 block">
        @if (items(); as list) {
          @if (list.length === 0) {
            <p class="p-4 text-sm text-text-secondary" data-testid="export-empty">
              Aún no has generado ninguna exportación.
            </p>
          } @else {
            <div class="overflow-x-auto">
              <table class="w-full text-sm" data-testid="export-table">
                <thead>
                  <tr class="border-b border-border text-left text-text-secondary">
                    <th class="px-2 py-2">Estado</th>
                    <th class="px-2 py-2">Fecha</th>
                    <th class="px-2 py-2 text-right">Tamaño</th>
                    <th class="px-2 py-2 text-right">Archivos</th>
                    <th class="px-2 py-2">Vence</th>
                    <th class="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of list; track item.id) {
                    <tr class="border-b border-border/60" data-testid="export-row">
                      <td class="px-2 py-2">
                        <span
                          class="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                          [class]="statusClass(item.status)"
                          >{{ statusLabel(item.status) }}</span
                        >
                        @if (item.status === 'failed' && item.error) {
                          <p class="mt-1 text-xs text-text-secondary">{{ item.error }}</p>
                        }
                      </td>
                      <td class="px-2 py-2">{{ date(item.created_at) }}</td>
                      <td class="px-2 py-2 text-right">{{ size(item.size_bytes) }}</td>
                      <td class="px-2 py-2 text-right">
                        {{ item.status === 'ready' ? item.file_count : '—' }}
                      </td>
                      <td class="px-2 py-2">
                        {{ item.expires_at ? date(item.expires_at) : '—' }}
                      </td>
                      <td class="px-2 py-2 text-right">
                        @if (item.status === 'ready') {
                          <app-button
                            variant="outline"
                            size="sm"
                            [loading]="downloadingId() === item.id"
                            [disabled]="downloadingId() !== null"
                            (clicked)="download(item)"
                            >Descargar</app-button
                          >
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        } @else if (loading()) {
          <div class="p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando exportaciones...</p>
          </div>
        }
      </app-card>
    </div>
  `,
})
export class ExportPageComponent implements OnInit {
  private readonly api = inject(WorkflowExportApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  readonly statusLabel = (status: WorkflowExportStatus): string => EXPORT_STATUS_LABELS[status];
  readonly statusClass = (status: WorkflowExportStatus): string => STATUS_CLASSES[status];
  readonly date = (iso: string): string => DATE_TIME.format(new Date(iso));
  readonly size = formatBytes;

  readonly items = signal<WorkflowExport[] | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly message = signal('');
  readonly requesting = signal(false);
  readonly downloadingId = signal<number | null>(null);

  private readonly hasActive = computed(
    () => this.items()?.some((e) => e.status === 'pending' || e.status === 'running') ?? false,
  );
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  ngOnInit(): void {
    this.load();
  }

  requestExport(): void {
    if (this.requesting()) return;
    this.requesting.set(true);
    this.message.set('');
    this.api
      .request()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.requesting.set(false);
          this.load();
        },
        error: (err) => {
          this.requesting.set(false);
          this.message.set(toWorkflowError(err).message);
          // Show the export that is already running.
          this.load();
        },
      });
  }

  download(item: WorkflowExport): void {
    if (this.downloadingId() !== null) return;
    this.downloadingId.set(item.id);
    this.message.set('');
    this.api
      .download(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.downloadingId.set(null);
          this.document.defaultView?.open(result.url, '_blank', 'noopener');
        },
        error: (err) => {
          this.downloadingId.set(null);
          this.message.set(toWorkflowError(err).message);
          this.load();
        },
      });
  }

  private load(): void {
    this.stopPolling();
    this.api
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.items.set(list);
          this.loading.set(false);
          this.loadError.set('');
          this.schedulePoll();
        },
        error: (err) => {
          this.loading.set(false);
          this.loadError.set(toWorkflowError(err).message);
          this.schedulePoll();
        },
      });
  }

  /** Refreshes only while something is pending or running. */
  private schedulePoll(): void {
    if (!this.hasActive()) return;
    this.pollTimer = setTimeout(() => this.load(), EXPORT_POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}
