import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import {
  BadgeComponent,
  BadgeVariant,
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  ItemListCardConfig,
  ModalComponent,
  ResponsiveDataViewComponent,
  SpinnerComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../shared/components';
import { CertificatesPendingService } from './certificates-pending.service';
import type {
  CertificateProvisioningStatus,
  IdentityDocument,
  PendingCertificateRequest,
} from './certificates-pending.interface';

const STATUS_VARIANTS: Record<CertificateProvisioningStatus, BadgeVariant> = {
  not_required: 'neutral',
  documents_pending: 'neutral',
  documents_submitted: 'warning',
  issuing: 'info',
  issued: 'success',
  rejected: 'error',
};

const STATUS_LABELS: Record<CertificateProvisioningStatus, string> = {
  not_required: 'No aplica',
  documents_pending: 'Documentos pendientes',
  documents_submitted: 'Por tramitar',
  issuing: 'En trámite',
  issued: 'Emitido',
  rejected: 'Rechazado',
};

/**
 * QUI-657 — cola de plataforma: tiendas y organizaciones que no tienen
 * certificado de firma y pidieron que se lo tramitemos.
 *
 * El operador ve el expediente, abre cada documento con una URL firmada de vida
 * corta, y carga el `.p12` que la entidad emisora expidió. Recién ahí la tienda
 * puede emitir: hasta entonces `fiscal-production-readiness` la mantiene
 * bloqueada, y esta pantalla no tiene forma de saltarse ese gate.
 */
@Component({
  selector: 'app-certificates-pending',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    StickyHeaderComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    ModalComponent,
    ResponsiveDataViewComponent,
    SpinnerComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Certificados por tramitar"
        subtitle="Tiendas sin certificado de firma que entregaron sus documentos de identidad"
        icon="shield-check"
      />

      <div class="px-2 md:px-4 pt-2 pb-4 space-y-4">
        <app-card [responsive]="true" [padding]="false" customClasses="!p-0">
          <div class="px-2 py-2 md:px-4 md:py-3 border-b border-border">
            <div
              class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
            >
              <h2
                class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:text-text-primary md:tracking-normal"
              >
                Cola de trámites
                <span class="font-normal text-text-secondary/50">
                  ({{ requests().length }})
                </span>
              </h2>
              <app-button
                size="sm"
                variant="outline"
                icon="refresh-cw"
                [disabled]="loading()"
                (clicked)="load()"
              >
                Actualizar
              </app-button>
            </div>
          </div>

          @if (loading()) {
            <div class="p-4 md:p-6 text-center">
              <app-spinner size="md" label="Cargando trámites…"></app-spinner>
            </div>
          }

          @if (!loading() && requests().length === 0) {
            <app-empty-state
              icon="shield-check"
              title="Sin trámites pendientes"
              description="Ninguna tienda tiene un expediente de certificado esperando gestión."
              [showActionButton]="false"
            />
          }

          @if (!loading() && requests().length > 0) {
            <div class="px-2 pb-2 pt-2 md:p-4">
              <app-responsive-data-view
                [data]="requests()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [actions]="actions"
                [loading]="loading()"
                [sortable]="true"
                (rowClick)="openDetail($any($event))"
                (actionClick)="onActionClick($any($event))"
              />
            </div>
          }
        </app-card>
      </div>
    </div>

    <!-- Detalle del expediente + descarga de documentos -->
    <app-modal
      [isOpen]="detailOpen()"
      [title]="selected()?.organization_name ?? 'Expediente'"
      [subtitle]="selectedSubtitle()"
      size="lg"
      (closed)="closeDetail()"
    >
      @if (selected(); as item) {
        <div class="space-y-4">
          <dl class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <dt class="text-text-secondary text-xs uppercase tracking-wide">
                NIT
              </dt>
              <dd class="font-mono">
                {{ item.nit }}@if (item.nit_dv) {-{{ item.nit_dv }}}
              </dd>
            </div>
            <div>
              <dt class="text-text-secondary text-xs uppercase tracking-wide">
                Tipo de persona
              </dt>
              <dd>
                {{ item.person_type === 'natural' ? 'Natural' : 'Jurídica' }}
              </dd>
            </div>
            <div>
              <dt class="text-text-secondary text-xs uppercase tracking-wide">
                Tienda
              </dt>
              <dd>{{ item.store_name ?? 'Alcance organización' }}</dd>
            </div>
            <div>
              <dt class="text-text-secondary text-xs uppercase tracking-wide">
                Solicitado
              </dt>
              <dd class="font-mono">
                {{ item.requested_at | date: 'dd MMM yyyy HH:mm' }}
              </dd>
            </div>
            <div class="md:col-span-2">
              <dt class="text-text-secondary text-xs uppercase tracking-wide">
                Estado
              </dt>
              <dd>
                <app-badge
                  [variant]="statusVariant(item.certificate_provisioning_status)"
                >
                  {{ statusLabel(item.certificate_provisioning_status) }}
                </app-badge>
              </dd>
            </div>
          </dl>

          <div class="border-t border-border pt-3">
            <h3 class="text-sm font-semibold text-text-primary mb-2">
              Documentos entregados ({{ item.documents.length }})
            </h3>
            @if (item.documents.length === 0) {
              <p class="text-sm text-text-secondary">
                El expediente no tiene documentos cargados.
              </p>
            } @else {
              <ul class="space-y-2">
                @for (doc of item.documents; track doc.id) {
                  <li
                    class="flex flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div class="min-w-0">
                      <p class="text-sm font-medium text-text-primary">
                        {{ doc.label }}
                      </p>
                      <p class="truncate text-xs text-text-secondary">
                        {{ doc.original_filename ?? 'sin nombre' }}
                        @if (doc.size_bytes !== null) {
                          · {{ formatSize(doc.size_bytes) }}
                        }
                      </p>
                    </div>
                    <app-button
                      size="sm"
                      variant="outline"
                      icon="external-link"
                      [disabled]="openingDocumentId() === doc.id"
                      (clicked)="openDocument(item.id, doc)"
                    >
                      {{ openingDocumentId() === doc.id ? 'Abriendo…' : 'Ver' }}
                    </app-button>
                  </li>
                }
              </ul>
              <p class="mt-2 text-xs text-text-secondary/70">
                Los enlaces se firman al abrirlos y caducan en 5 minutos.
              </p>
            }
          </div>
        </div>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-2">
        <app-button variant="ghost" (clicked)="closeDetail()">
          Cerrar
        </app-button>
        @if (selected(); as item) {
          @if (item.certificate_provisioning_status === 'documents_submitted') {
            <app-button
              variant="outline"
              icon="clock"
              [loading]="acting()"
              (clicked)="markIssuing(item)"
            >
              Marcar en trámite
            </app-button>
          }
          <app-button
            variant="danger"
            icon="x-circle"
            [loading]="acting()"
            (clicked)="openReject(item)"
          >
            Devolver
          </app-button>
          <app-button
            variant="primary"
            icon="upload"
            (clicked)="openUpload(item)"
          >
            Cargar certificado
          </app-button>
        }
      </div>
    </app-modal>

    <!-- Carga del .p12 expedido -->
    <app-modal
      [isOpen]="uploadOpen()"
      title="Cargar certificado expedido"
      [subtitle]="selectedSubtitle()"
      size="md"
      (closed)="closeUpload()"
    >
      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-sm font-medium text-text-primary">
            Archivo .p12
          </label>
          <input
            type="file"
            accept=".p12,.pfx"
            class="block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            (change)="onFileSelected($event)"
          />
          @if (certFile(); as f) {
            <p class="mt-1 text-xs text-text-secondary">
              {{ f.name }} · {{ formatSize(f.size) }}
            </p>
          }
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-text-primary">
            Contraseña del certificado
          </label>
          <input
            type="password"
            autocomplete="off"
            class="block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            [ngModel]="certPassword()"
            (ngModelChange)="certPassword.set($event)"
          />
        </div>
        <p class="text-xs text-text-secondary/70">
          El certificado se valida contra el NIT del expediente antes de
          guardarse. Al cargarlo, la tienda queda habilitada para emitir.
        </p>
      </div>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="closeUpload()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          icon="upload"
          [disabled]="!canUpload()"
          [loading]="uploading()"
          (clicked)="submitUpload()"
        >
          Cargar
        </app-button>
      </div>
    </app-modal>

    <!-- Devolución del expediente -->
    <app-modal
      [isOpen]="rejectOpen()"
      title="Devolver expediente"
      [subtitle]="selectedSubtitle()"
      size="md"
      (closed)="closeReject()"
    >
      <div class="space-y-2">
        <label class="block text-sm font-medium text-text-primary">
          Motivo
        </label>
        <textarea
          rows="4"
          class="block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          placeholder="Qué debe corregir el comerciante"
          [ngModel]="rejectReason()"
          (ngModelChange)="rejectReason.set($event)"
        ></textarea>
        <p class="text-xs text-text-secondary/70">
          El expediente vuelve a "documentos pendientes" para que el comerciante
          pueda corregir y reenviar.
        </p>
      </div>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="closeReject()">
          Cancelar
        </app-button>
        <app-button
          variant="danger"
          icon="x-circle"
          [disabled]="!rejectReason().trim()"
          [loading]="acting()"
          (clicked)="submitReject()"
        >
          Devolver
        </app-button>
      </div>
    </app-modal>
  `,
})
export class CertificatesPendingComponent {
  private readonly api = inject(CertificatesPendingService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly requests = signal<PendingCertificateRequest[]>([]);
  readonly loading = signal<boolean>(false);
  readonly acting = signal<boolean>(false);
  readonly uploading = signal<boolean>(false);
  readonly openingDocumentId = signal<number | null>(null);

  readonly selected = signal<PendingCertificateRequest | null>(null);
  readonly detailOpen = signal<boolean>(false);
  readonly uploadOpen = signal<boolean>(false);
  readonly rejectOpen = signal<boolean>(false);

  readonly certFile = signal<File | null>(null);
  readonly certPassword = signal<string>('');
  readonly rejectReason = signal<string>('');

  readonly selectedSubtitle = computed(() => {
    const item = this.selected();
    if (!item) return '';
    const dv = item.nit_dv ? `-${item.nit_dv}` : '';
    return `${item.name} · NIT ${item.nit}${dv}`;
  });

  readonly canUpload = computed(
    () => !!this.certFile() && this.certPassword().trim().length > 0,
  );

  readonly columns: TableColumn[] = [
    {
      key: 'organization_name',
      label: 'Organización',
      sortable: true,
      priority: 1,
    },
    {
      key: 'store_name',
      label: 'Tienda',
      priority: 2,
      transform: (v: string | null) => v ?? 'Alcance organización',
    },
    { key: 'nit', label: 'NIT', width: '130px', priority: 1 },
    {
      key: 'person_type',
      label: 'Persona',
      width: '110px',
      priority: 2,
      transform: (v: string) => (v === 'natural' ? 'Natural' : 'Jurídica'),
    },
    {
      key: 'certificate_provisioning_status',
      label: 'Estado',
      width: '160px',
      align: 'center',
      priority: 1,
      transform: (v: CertificateProvisioningStatus) => this.statusLabel(v),
    },
    {
      key: 'requested_at',
      label: 'Solicitado',
      sortable: true,
      width: '140px',
      priority: 1,
    },
  ];

  readonly actions: TableAction[] = [
    {
      label: 'Ver expediente',
      icon: 'eye',
      variant: 'info',
      action: (item: PendingCertificateRequest) => this.openDetail(item),
    },
    {
      label: 'Cargar certificado',
      icon: 'upload',
      variant: 'primary',
      action: (item: PendingCertificateRequest) => this.openUpload(item),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'organization_name',
    subtitleKey: 'nit',
    avatarFallbackIcon: 'shield-check',
    badgeKey: 'certificate_provisioning_status',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (v: CertificateProvisioningStatus) => this.statusLabel(v),
    detailKeys: [
      { key: 'store_name', label: 'Tienda' },
      { key: 'requested_at', label: 'Solicitado' },
    ],
  };

  constructor() {
    this.load();
  }

  // ─── Helpers ────────────────────────────────────────────────────────────
  statusLabel(status: CertificateProvisioningStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  statusVariant(status: CertificateProvisioningStatus): BadgeVariant {
    return STATUS_VARIANTS[status] ?? 'neutral';
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  // ─── Loaders ────────────────────────────────────────────────────────────
  load(): void {
    this.loading.set(true);
    this.api
      .getPending()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.requests.set(list);
          this.loading.set(false);
        },
        error: () => {
          this.requests.set([]);
          this.loading.set(false);
          this.toast.error('No se pudo cargar la cola de trámites');
        },
      });
  }

  // ─── Detalle ────────────────────────────────────────────────────────────
  openDetail(item: PendingCertificateRequest): void {
    this.selected.set(item);
    this.detailOpen.set(true);
  }

  closeDetail(): void {
    this.detailOpen.set(false);
    this.selected.set(null);
  }

  onActionClick(payload: {
    action: TableAction;
    item: PendingCertificateRequest;
  }): void {
    // `ResponsiveDataView` no distingue cuál de las dos acciones se pulsó más
    // que por su etiqueta, así que se rutea por ella. La acción por defecto es
    // abrir el expediente: es la lectura, y equivocarse hacia leer no destruye
    // nada, mientras que equivocarse hacia cargar abriría un modal de escritura.
    if (payload.action?.label === 'Cargar certificado') {
      this.openUpload(payload.item);
      return;
    }
    this.openDetail(payload.item);
  }

  /**
   * Abre un documento en una pestaña nueva con una URL firmada recién emitida.
   *
   * La URL se pide en este momento y no al cargar la tabla: cada una es una
   * copia del documento circulando fuera de la sesión y caduca en 5 minutos.
   */
  openDocument(config_id: number, doc: IdentityDocument): void {
    this.openingDocumentId.set(doc.id);
    this.api
      .getDocumentUrl(config_id, doc.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.openingDocumentId.set(null);
          if (!result?.download_url) {
            this.toast.error('No se pudo generar el enlace del documento');
            return;
          }
          window.open(result.download_url, '_blank', 'noopener,noreferrer');
        },
        error: () => {
          this.openingDocumentId.set(null);
          this.toast.error('No se pudo generar el enlace del documento');
        },
      });
  }

  // ─── Marcar en trámite ──────────────────────────────────────────────────
  markIssuing(item: PendingCertificateRequest): void {
    this.acting.set(true);
    this.api
      .markIssuing(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ok) => {
          this.acting.set(false);
          if (!ok) {
            this.toast.error('No se pudo marcar en trámite');
            return;
          }
          this.toast.success('Expediente marcado en trámite');
          this.closeDetail();
          this.load();
        },
        error: () => {
          this.acting.set(false);
          this.toast.error('No se pudo marcar en trámite');
        },
      });
  }

  // ─── Devolución ─────────────────────────────────────────────────────────
  openReject(item: PendingCertificateRequest): void {
    this.selected.set(item);
    this.rejectReason.set('');
    this.detailOpen.set(false);
    this.rejectOpen.set(true);
  }

  closeReject(): void {
    this.rejectOpen.set(false);
    this.rejectReason.set('');
  }

  submitReject(): void {
    const item = this.selected();
    const reason = this.rejectReason().trim();
    if (!item || !reason) return;

    this.acting.set(true);
    this.api
      .reject(item.id, reason)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ok) => {
          this.acting.set(false);
          if (!ok) {
            this.toast.error('No se pudo devolver el expediente');
            return;
          }
          this.toast.success('Expediente devuelto al comerciante');
          this.closeReject();
          this.selected.set(null);
          this.load();
        },
        error: () => {
          this.acting.set(false);
          this.toast.error('No se pudo devolver el expediente');
        },
      });
  }

  // ─── Carga del certificado ──────────────────────────────────────────────
  openUpload(item: PendingCertificateRequest): void {
    this.selected.set(item);
    this.certFile.set(null);
    this.certPassword.set('');
    this.detailOpen.set(false);
    this.uploadOpen.set(true);
  }

  closeUpload(): void {
    this.uploadOpen.set(false);
    this.certFile.set(null);
    this.certPassword.set('');
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.certFile.set(input.files?.[0] ?? null);
  }

  submitUpload(): void {
    const item = this.selected();
    const file = this.certFile();
    const password = this.certPassword().trim();
    if (!item || !file || !password) return;

    this.uploading.set(true);
    this.api
      .uploadIssuedCertificate(item.id, file, password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ok) => {
          this.uploading.set(false);
          if (!ok) {
            this.toast.error('No se pudo cargar el certificado');
            return;
          }
          this.toast.success('Certificado cargado. La tienda ya puede emitir.');
          this.closeUpload();
          this.selected.set(null);
          this.load();
        },
        error: (err) => {
          this.uploading.set(false);
          this.toast.error(
            err?.error?.message ??
              'No se pudo cargar el certificado. Verifica el archivo y la contraseña.',
          );
        },
      });
  }
}
