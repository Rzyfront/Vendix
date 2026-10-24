import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { ButtonComponent, CardComponent, IconComponent } from '../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import { DocumentReceptionConnectionsComponent } from './document-reception-connections.component';
import { ReceivedBuyerEventActivationComponent } from './received-buyer-event-activation.component';
import { ReceivedDocumentsService } from './received-documents.service';
import { isValidReceivedReceptionHealth } from './received-documents.interface';
import type { ReceivedDocumentReceptionStatus, ReceivedDocumentsScope } from './received-documents.interface';

/** Safe reception health is independent from the administrative credentials surface. */
@Component({
  selector: 'app-received-documents-configuration',
  standalone: true,
  imports: [ButtonComponent, CardComponent, IconComponent, RouterLink, DocumentReceptionConnectionsComponent, ReceivedBuyerEventActivationComponent],
  template: `
    @if (canRead()) {
      <div class="w-full space-y-4">
        @if (scope() === 'store' && health()?.email?.pilot_available) {
          <app-card [responsive]="true">
            <section class="space-y-2" aria-label="Recepción por correo">
              <h2 class="text-base font-semibold text-text-primary">Recepción por correo</h2>
              <p class="text-sm text-text-secondary">Activa tu dirección Vendix desde el Buzón y reenvía las facturas de tus proveedores. No necesitas compartir la contraseña de tu correo.</p>
              @if (canConfigureEmail()) {
                <a routerLink="/admin/invoicing/received-documents" [queryParams]="{ setup: 'email' }" class="inline-flex min-h-11 items-center font-medium text-primary underline">Abrir asistente</a>
              } @else {
                <p class="text-sm text-text-secondary">Solicita la configuración a una persona con permiso para administrar la recepción de esta tienda.</p>
              }
            </section>
          </app-card>
        }
        <details class="rounded-lg border border-border p-3">
          <summary class="flex min-h-11 cursor-pointer items-center font-semibold text-text-primary">Integraciones avanzadas (para desarrolladores)</summary>
          <div class="mt-3 space-y-4">
        <app-card [responsive]="true">
          <section aria-labelledby="reception-connections-title" class="space-y-3">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="flex min-w-0 items-start gap-3">
                <span class="rounded-lg bg-primary/10 p-2 text-primary" aria-hidden="true"><app-icon name="inbox" [size]="18" /></span>
                <div class="min-w-0">
                  <h2 id="reception-connections-title" class="text-base font-semibold text-text-primary">Recepción de facturas</h2>
                  <p class="mt-1 text-sm text-text-secondary">Conecta un proveedor API o un webhook firmado. La operación diaria y la revisión de documentos están en el buzón; Vendix no descarga una bandeja universal desde la DIAN.</p>
                </div>
              </div>
              <a routerLink="/admin/invoicing/received-documents" [queryParams]="receptionQuery()" class="shrink-0 font-medium text-primary underline focus-visible:ring-2 focus-visible:ring-primary/50">Abrir buzón</a>
            </div>

            @if (!scopeReady()) {
              <p role="status" class="text-sm text-text-secondary">Selecciona una tienda fiscal para consultar su recepción. El historial de documentos permanece en el buzón.</p>
            } @else if (healthLoading()) {
              <p role="status" class="text-sm text-text-secondary">Consultando la salud de recepción…</p>
            } @else if (healthError(); as message) {
              <div role="alert" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error">
                <span>{{ message }}</span>
                <app-button variant="outline" size="sm" (clicked)="loadHealth()">Reintentar</app-button>
              </div>
            } @else if (health(); as status) {
              @if (!status.dian_active) {
                <div class="space-y-2 rounded-lg border border-warning/30 bg-warning-light p-3 text-sm text-text-secondary" role="note">
                  <p>Activa la configuración DIAN de facturación en producción y con estado habilitado para administrar canales de recepción.</p>
                  @if (canConfigureDian()) {
                    <a [routerLink]="dianConfigurationLink()" [queryParams]="receptionQuery()" class="font-medium text-primary underline">Ir a configuración DIAN</a>
                  } @else {
                    <p>Solicita a una persona con permiso de configuración DIAN que complete la habilitación. Tu perfil puede consultar el buzón, pero no credenciales.</p>
                  }
                </div>
              } @else {
                <p class="text-sm text-text-secondary">La DIAN de facturación está habilitada en producción. Este estado no certifica autenticidad ni aceptación legal de los documentos recibidos.</p>
              }
              <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div><dt class="text-text-secondary">Canales</dt><dd class="font-medium text-text-primary">{{ channelLabel() }}</dd></div>
                <div><dt class="text-text-secondary">Conexiones activas</dt><dd class="font-medium text-text-primary">{{ status.active_connections }}</dd></div>
              </dl>
              @if (status.requires_operational_store) {
                <p class="text-sm text-text-secondary" role="note">Selecciona una tienda operativa en Conexiones. La entidad fiscal de organización no garantiza un canal automático sin tienda y actor configurados.</p>
              }
              @if (canConfigureConnections()) {
                <app-button variant="outline" size="md" (clicked)="openConnections()">{{ status.requires_operational_store ? 'Seleccionar tienda operativa' : 'Administrar conexiones API / webhook' }}</app-button>
              } @else if (status.dian_active) {
                <p class="text-sm text-text-secondary" role="note">Modo consulta o sin permiso para administrar conexiones: solicita la configuración a una persona autorizada. No se consultan credenciales desde esta vista.</p>
              }
            }
            <p class="text-sm text-text-secondary">La importación manual de XML y el historial siguen disponibles en el buzón aunque DIAN esté inactiva o un canal falle. No hay integración IMAP disponible.</p>
          </section>
        </app-card>

        <app-card [responsive]="true">
          <section aria-labelledby="reception-activity-title" class="space-y-3">
            <h2 id="reception-activity-title" class="text-base font-semibold text-text-primary">Actividad de recepción</h2>
            @if (health(); as status) {
              <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div><dt class="text-text-secondary">Último documento recibido</dt><dd>{{ formatActivityDate(status.last_received_at) }}</dd></div>
                <div><dt class="text-text-secondary">Última sincronización</dt><dd>{{ formatActivityDate(status.last_synced_at) }}</dd></div>
                <div><dt class="text-text-secondary">Próxima consulta API</dt><dd>{{ formatActivityDate(status.next_sync_at) }}</dd></div>
              </dl>
              @if (status.error_code) {
                <p role="alert" class="rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error">Una conexión reportó un error. Revisa el historial con una persona autorizada para administrar conexiones.</p>
              }
              @if (status.last_run; as run) {
                <p class="text-sm text-text-secondary">Última ejecución: {{ runStatusLabel(run.status) }} · {{ run.received_count }} recibidos · {{ run.duplicate_count }} duplicados · {{ run.error_count }} errores.</p>
              }
              @if (canConfigureConnections()) {
                <app-button variant="outline" size="sm" (clicked)="openConnections()">Ver historial de conexiones</app-button>
              }
            } @else {
              <p class="text-sm text-text-secondary">{{ healthLoading() ? 'Consultando actividad…' : 'La actividad no está disponible hasta completar la consulta de salud.' }}</p>
            }
            <p class="text-sm text-text-secondary">Habilitar una conexión no demuestra que el proveedor entregue documentos. La sincronización y los intervalos se administran en Conexiones; recibir un XML no acepta legalmente la factura.</p>
          </section>
        </app-card>

          </div>
        </details>
        <app-card [responsive]="true">
          <section aria-labelledby="reception-legal-title" class="space-y-2">
            <h2 id="reception-legal-title" class="text-base font-semibold text-text-primary">Habilitación de eventos legales</h2>
            <p class="text-sm text-text-secondary">Consulta la habilitación del comprador y solicita su revisión. Esto no envía eventos ni reemplaza la revisión manual del XML. El evento 034 es solo de consulta; no se ofrece su emisión.</p>
            <app-received-buyer-event-activation
              [scope]="scope()"
              [selectedStoreId]="selectedStoreId()"
              [scopeReady]="scopeReady()"
              [readOnly]="readOnly() || isSuperAdmin()"
              [embedded]="true"
            />
          </section>
        </app-card>

        @if (canConfigureConnections() && connectionsOpen()) {
          <app-document-reception-connections
            [isOpen]="connectionsOpen()"
            (isOpenChange)="onConnectionsOpenChange($event)"
            [scope]="scope()"
            [selectedStoreId]="selectedStoreId()"
          />
        }
      </div>
    }
  `,
})
export class ReceivedDocumentsConfigurationComponent {
  private readonly auth = inject(AuthFacade);
  private readonly api = inject(ReceivedDocumentsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly storeSettings = inject(StoreSettingsFacade);

  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly selectedStoreId = input<number | null>(null);
  readonly scopeReady = input(true);
  readonly readOnly = input(false);
  readonly connectionsOpen = signal(false);
  readonly health = signal<ReceivedDocumentReceptionStatus | null>(null);
  readonly healthLoading = signal(false);
  readonly healthError = signal<string | null>(null);
  readonly isSuperAdmin = computed(() => {
    const roles = this.auth.userRoles();
    return roles.includes('super_admin') || roles.includes('SUPER_ADMIN');
  });
  readonly canRead = computed(() => this.auth.hasPermission(`${this.permissionPrefix()}:read`));
  readonly canConfigureConnections = computed(() =>
    !this.readOnly() && !this.isSuperAdmin() && this.scopeReady() && this.canRead()
    && !this.healthLoading() && !this.healthError() && this.health()?.dian_active === true
    && this.auth.hasPermission(`${this.permissionPrefix()}:connections:configure`),
  );
  // Email authorization is operational: a read-only organization fiscal editor must not disable its store's inbox.
  readonly canConfigureEmail = computed(() => this.scope() === 'store' && !this.isSuperAdmin() && this.scopeReady()
    && this.canRead() && !this.healthError() && this.health()?.email?.pilot_available === true
    && this.auth.hasPermission('invoicing:received:connections:configure'));
  readonly canConfigureDian = computed(() => !this.readOnly() && !this.isSuperAdmin()
    && this.auth.hasPermission(this.scope() === 'store' ? 'invoicing:write' : 'organization:invoicing:dian:write'));
  readonly receptionQuery = computed(() => ({ store_id: this.scope() === 'organization' ? this.selectedStoreId() : null }));
  readonly dianConfigurationLink = computed(() => this.scope() === 'store' ? '/admin/invoicing/dian-config' : '/admin/fiscal');
  readonly channelLabel = computed(() => {
    const status = this.health();
    if (!status) return 'Sin información';
    if (!status.configured) return 'Sin conexión configurada';
    if (!status.channels.length) return 'Conexiones sin canal activo';
    return status.channels.map((channel) => channel === 'api_poll' ? 'Proveedor API' : 'Webhook firmado').join(' · ');
  });
  private healthRequest?: Subscription;
  private generation = 0;
  private contextKey = '';

  constructor() {
    effect(() => {
      const key = `${this.scope()}:${this.selectedStoreId() ?? ''}:${this.scopeReady()}:${this.readOnly()}:${this.canRead()}:${this.isSuperAdmin()}:${this.auth.userId()}:${this.auth.userStore()?.id}:${this.auth.userOrganization()?.id}`;
      if (key === this.contextKey) return;
      this.contextKey = key;
      untracked(() => {
        this.generation++;
        this.healthRequest?.unsubscribe();
        this.health.set(null);
        this.healthError.set(null);
        this.healthLoading.set(false);
        this.connectionsOpen.set(false);
        this.loadHealth();
      });
    });
    this.destroyRef.onDestroy(() => { this.generation++; this.healthRequest?.unsubscribe(); });
  }

  loadHealth(): void {
    this.generation++;
    this.healthRequest?.unsubscribe();
    if (!this.canRead() || !this.scopeReady() || this.isSuperAdmin()) return;
    const generation = this.generation;
    this.health.set(null);
    this.healthLoading.set(true);
    this.healthError.set(null);
    this.healthRequest = this.api.getReceptionStatus(this.scope(), this.scope() === 'organization' ? this.selectedStoreId() ?? undefined : undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (generation !== this.generation) return;
          if (!this.isValidHealth(response.data)) {
            this.healthError.set('La respuesta de salud de recepción no tiene un formato válido. Reintenta la consulta.');
          } else {
            this.health.set(response.data);
          }
          this.healthLoading.set(false);
        },
        error: (error: unknown) => {
          if (generation !== this.generation) return;
          this.healthError.set(describeApiFailure(error).message || 'No se pudo consultar la salud de recepción.');
          this.healthLoading.set(false);
        },
      });
  }

  openConnections(): void {
    if (!this.canConfigureConnections()) return;
    this.connectionsOpen.set(true);
  }

  onConnectionsOpenChange(open: boolean): void {
    this.connectionsOpen.set(open && this.canConfigureConnections());
    if (!open) this.loadHealth();
  }

  formatActivityDate(value: string | null): string {
    if (!value) return 'Sin registro';
    return formatStoreDateTime(value, this.storeSettings.settings()?.general?.timezone ?? 'America/Bogota', { dateStyle: 'short', timeStyle: 'short' }) || 'Fecha no disponible';
  }

  runStatusLabel(value: string): string {
    const labels: Record<string, string> = { pending: 'Pendiente', queued: 'En cola', running: 'En curso', completed: 'Completada', failed: 'Fallida', partial: 'Parcial', cancelled: 'Cancelada' };
    return labels[value] || 'Estado no disponible';
  }

  private isValidHealth(value: unknown): value is ReceivedDocumentReceptionStatus {
    return isValidReceivedReceptionHealth(value);
  }

  private permissionPrefix(): string {
    return this.scope() === 'store' ? 'invoicing:received' : 'organization:invoicing:received';
  }
}
