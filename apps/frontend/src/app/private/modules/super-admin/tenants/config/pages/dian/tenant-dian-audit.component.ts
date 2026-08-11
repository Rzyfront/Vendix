import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { extractApiErrorMessage } from '../../../../../../../core/utils/api-error-handler';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  ModalComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  type ItemListCardConfig,
  type SelectorOption,
  type TableAction,
  type TableColumn,
} from '../../../../../../../shared/components';
import {
  DIAN_CONFIGURATION_TYPES,
  DIAN_CONFIGURATION_TYPE_LABELS,
} from '../../../../../../../shared/components/dian';
import { DianConfigApiService } from '../../../../../../../shared/services/dian';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';
import { TenantDianConsoleStore } from './tenant-dian-console.store';

const PAGE_SIZE = 20;

/** Fila cruda de `dian_audit_logs`, en lo que esta vista lee. */
interface AuditLogRow {
  readonly id: number;
  readonly dian_configuration_id: number;
  readonly action: string;
  readonly document_type?: string | null;
  readonly document_number?: string | null;
  readonly status: string;
  readonly error_message?: string | null;
  readonly cufe?: string | null;
  readonly duration_ms?: number | null;
  readonly created_at?: string | null;
  readonly request_xml?: string | null;
  readonly response_xml?: string | null;
}

/** Fila decorada para la tabla. */
interface AuditRow extends AuditLogRow {
  readonly when_label: string;
  readonly status_label: string;
  readonly document_label: string;
  readonly duration_label: string;
  readonly config_label: string;
}

/**
 * Bitácora DIAN del tenant: qué se transmitió, cuándo, con qué veredicto y con
 * qué XML.
 *
 * ## Por qué el XML se muestra y no se resume
 *
 * Cuando la DIAN rechaza un documento, la única evidencia utilizable es el sobre
 * que se envió y el que contestó. Resumirlos obliga a soporte a pedirle al
 * comerciante que reproduzca el fallo para volver a capturarlo; mostrarlos
 * cierra el caso en la misma pantalla. El detalle va en un modal y no en la
 * tabla porque son documentos de miles de líneas.
 *
 * ## Paginación de servidor
 *
 * La bitácora crece sin techo: es una fila por transmisión. `getDianAuditLogs`
 * responde el envoltorio paginado del backend y esta vista respeta su `meta`,
 * en vez de traerse todo y recortar en el cliente.
 */
@Component({
  selector: 'app-tenant-dian-audit',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    ModalComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      <app-card [responsive]="true" [padding]="false">
        <div
          class="flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-center md:justify-between md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-text-primary md:text-lg">
              Bitácora DIAN ({{ total() }})
            </h2>
            <p class="mt-0.5 text-[11px] text-text-secondary">
              Una fila por transmisión: incluye los envíos que la DIAN rechazó y
              los que nunca llegaron a clasificarse.
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <app-selector
              class="w-full md:w-72"
              placeholder="Todas las habilitaciones"
              [options]="configOptions()"
              [formControl]="configFilter"
            ></app-selector>
            <app-button
              variant="ghost"
              size="sm"
              [loading]="loading()"
              (clicked)="reload()"
            >
              <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
              Actualizar
            </app-button>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          @if (error(); as message) {
            <app-alert-banner variant="danger" icon="alert-triangle">
              {{ message }}
            </app-alert-banner>
          }

          <app-responsive-data-view
            [data]="rows()"
            [columns]="columns"
            [actions]="actions"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            emptyIcon="history"
            emptyTitle="Sin transmisiones registradas"
            emptyDescription="Este tenant todavía no ha enviado nada a la DIAN desde ninguna de sus habilitaciones."
          ></app-responsive-data-view>

          <app-pagination
            [currentPage]="page()"
            [totalPages]="totalPages()"
            [total]="total()"
            [limit]="pageSize"
            (pageChange)="onPageChange($event)"
          ></app-pagination>
        </div>
      </app-card>
    </div>

    <!-- Detalle: los dos sobres, tal cual viajaron -->
    <app-modal
      [(isOpen)]="detailOpen"
      title="Detalle de la transmisión"
      [subtitle]="detailSubtitle()"
      size="xl"
      (cancel)="selected.set(null)"
    >
      @if (selected(); as entry) {
        <div class="space-y-3">
          <dl
            class="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-border bg-background/60 p-2.5 sm:grid-cols-4"
          >
            <div class="min-w-0">
              <dt class="text-[10px] uppercase text-text-secondary">Acción</dt>
              <dd class="text-xs text-text-primary">{{ entry.action }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-[10px] uppercase text-text-secondary">Estado</dt>
              <dd class="text-xs text-text-primary">{{ entry.status_label }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-[10px] uppercase text-text-secondary">Documento</dt>
              <dd class="text-xs text-text-primary">{{ entry.document_label }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-[10px] uppercase text-text-secondary">Duración</dt>
              <dd class="text-xs text-text-primary">{{ entry.duration_label }}</dd>
            </div>
            @if (entry.cufe) {
              <div class="col-span-2 min-w-0 sm:col-span-4">
                <dt class="text-[10px] uppercase text-text-secondary">
                  CUFE / CUDE
                </dt>
                <dd class="break-all font-mono text-[11px] text-text-primary">
                  {{ entry.cufe }}
                </dd>
              </div>
            }
          </dl>

          @if (entry.error_message) {
            <app-alert-banner variant="danger" icon="alert-triangle">
              {{ entry.error_message }}
            </app-alert-banner>
          }

          @if (entry.request_xml) {
            <div class="space-y-1">
              <p class="text-xs font-semibold text-text-primary">
                Sobre enviado
              </p>
              <pre
                class="max-h-64 overflow-auto rounded-md border border-border bg-background p-2 text-[10px] leading-snug text-text-primary"
                >{{ entry.request_xml }}</pre
              >
            </div>
          }

          @if (entry.response_xml) {
            <div class="space-y-1">
              <p class="text-xs font-semibold text-text-primary">
                Respuesta de la DIAN
              </p>
              <pre
                class="max-h-64 overflow-auto rounded-md border border-border bg-background p-2 text-[10px] leading-snug text-text-primary"
                >{{ entry.response_xml }}</pre
              >
            </div>
          }

          @if (!entry.request_xml && !entry.response_xml) {
            <p class="text-xs text-text-secondary">
              Esta entrada no guardó los sobres XML. Ocurre con las acciones que
              no transmiten (cambios de configuración, carga de certificado): la
              bitácora las registra igual porque también explican un cambio de
              comportamiento.
            </p>
          }
        </div>
      }
    </app-modal>
  `,
})
export class TenantDianAuditComponent {
  private readonly api = inject(DianConfigApiService);
  private readonly store = inject(TenantDianConsoleStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly pageSize = PAGE_SIZE;

  protected readonly entries = signal<readonly AuditLogRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly detailOpen = signal(false);
  protected readonly selected = signal<AuditRow | null>(null);

  /**
   * Filtro por habilitación. Es un CVA: su valor entra por `formControl` y NO se
   * puede leer desde un `computed`, así que los cambios se atienden en su propio
   * stream — que además reinicia la página, porque la página 4 de un filtro no
   * es la página 4 del siguiente.
   */
  protected readonly configFilter = new FormControl<number | null>(null);

  /** Descarta la respuesta de una consulta que un filtro posterior ya invalidó. */
  private requestToken = 0;

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / PAGE_SIZE)),
  );

  protected readonly configOptions = computed<SelectorOption[]>(() => [
    { value: '', label: 'Todas las habilitaciones' },
    ...this.store.configs().map((config) => ({
      value: config.id,
      label: config.name,
      description: this.configurationTypeLabel(config.configuration_type),
    })),
  ]);

  // Array MUTABLE a propósito: `app-responsive-data-view` declara `data` como
  // `any[]`, y un `readonly T[]` no es asignable a él.
  protected readonly rows = computed<AuditRow[]>(() =>
    this.entries().map((entry) => this.toRow(entry)),
  );

  protected readonly detailSubtitle = computed(() => {
    const entry = this.selected();
    return entry ? `${entry.when_label} · ${entry.config_label}` : '';
  });

  protected readonly columns: TableColumn[] = [
    { key: 'when_label', label: 'Fecha', priority: 0 },
    { key: 'action', label: 'Acción', priority: 0 },
    { key: 'document_label', label: 'Documento', priority: 1 },
    { key: 'config_label', label: 'Habilitación', priority: 2 },
    { key: 'duration_label', label: 'Duración', priority: 3 },
    {
      key: 'status_label',
      label: 'Estado',
      priority: 0,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          Éxito: '#16a34a',
          Error: '#dc2626',
          Pendiente: '#d97706',
        },
      },
    },
  ];

  protected readonly cardConfig: ItemListCardConfig = {
    titleKey: 'action',
    subtitleKey: 'when_label',
    badgeKey: 'status_label',
    badgeConfig: {
      type: 'custom',
      colorMap: { Éxito: '#16a34a', Error: '#dc2626', Pendiente: '#d97706' },
    },
    detailKeys: [
      { key: 'document_label', label: 'Documento' },
      { key: 'config_label', label: 'Habilitación' },
      { key: 'duration_label', label: 'Duración' },
    ],
  };

  protected readonly actions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'secondary',
      action: (row: AuditRow) => {
        this.selected.set(row);
        this.detailOpen.set(true);
      },
    },
  ];

  constructor() {
    this.configFilter.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.page.set(1);
        this.load();
      });

    this.load();
  }

  protected reload(): void {
    this.load();
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  private load(): void {
    const token = ++this.requestToken;
    this.loading.set(true);
    this.error.set(null);

    const raw = this.configFilter.value;
    const configId =
      raw === null || raw === undefined || String(raw) === ''
        ? undefined
        : Number(raw);

    this.api
      .getDianAuditLogs(
        this.page(),
        PAGE_SIZE,
        Number.isFinite(configId) ? configId : undefined,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          if (token !== this.requestToken) return;
          this.loading.set(false);
          const envelope = (response ?? {}) as Record<string, unknown>;
          const data = envelope['data'];
          this.entries.set(Array.isArray(data) ? (data as AuditLogRow[]) : []);
          const meta = (envelope['meta'] ?? {}) as Record<string, unknown>;
          const total = Number(meta['total']);
          this.total.set(Number.isFinite(total) ? total : 0);
        },
        error: (err: unknown) => {
          if (token !== this.requestToken) return;
          this.loading.set(false);
          this.entries.set([]);
          this.total.set(0);
          this.error.set(
            extractApiErrorMessage(err) ||
              'No se pudo leer la bitácora DIAN de este tenant.',
          );
        },
      });
  }

  private toRow(entry: AuditLogRow): AuditRow {
    const config = this.store
      .configs()
      .find((row) => row.id === entry.dian_configuration_id);

    return {
      ...entry,
      when_label: this.instant(entry.created_at),
      status_label: this.statusLabel(entry.status),
      document_label:
        [entry.document_type, entry.document_number]
          .filter((value) => Boolean(value))
          .join(' ') || '—',
      duration_label:
        typeof entry.duration_ms === 'number' ? `${entry.duration_ms} ms` : '—',
      config_label: config?.name ?? `Configuración #${entry.dian_configuration_id}`,
    };
  }

  /**
   * Rótulo de la habilitación de una configuración.
   *
   * `invoicing` es el defecto de la columna en Prisma, así que una fila antigua
   * sin el campo pertenece a facturación; un valor fuera del contrato se muestra
   * CRUDO en vez de forzarse a facturación, que sería mentir sobre qué se
   * transmitió.
   */
  private configurationTypeLabel(value: string | null | undefined): string {
    const type = value ?? 'invoicing';
    return (
      DIAN_CONFIGURATION_TYPES.find((candidate) => candidate === type)
        ? DIAN_CONFIGURATION_TYPE_LABELS[
            type as (typeof DIAN_CONFIGURATION_TYPES)[number]
          ]
        : type
    );
  }

  /**
   * Los estados los escribe el emisor de cada transmisión y no hay enum: se
   * normalizan a tres rótulos y lo desconocido se muestra CRUDO, porque un
   * estado que no reconocemos sigue siendo información.
   */
  private statusLabel(status: string): string {
    const normalized = (status ?? '').toLowerCase();
    if (['success', 'ok', 'accepted', 'exitoso'].includes(normalized)) {
      return 'Éxito';
    }
    if (['error', 'failed', 'rejected', 'rechazado'].includes(normalized)) {
      return 'Error';
    }
    if (['pending', 'queued', 'in_progress'].includes(normalized)) {
      return 'Pendiente';
    }
    return status || '—';
  }

  /**
   * Instante. La fecha sale de la utilidad del proyecto y la hora se arma con
   * las partes UTC del propio `Date`, sin pasar por ICU: el `hourCycle` del
   * contenedor imprime «24:00» a medianoche y aquí no hay razón para arriesgarlo.
   */
  private instant(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${formatDateOnlyUTC(date)} ${hours}:${minutes} UTC`;
  }
}
