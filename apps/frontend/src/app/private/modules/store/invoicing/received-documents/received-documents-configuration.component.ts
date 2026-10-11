import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { CardComponent, IconComponent } from '../../../../../shared/components/index';
import { DocumentReceptionConnectionsComponent } from './document-reception-connections.component';
import { ReceivedBuyerEventActivationComponent } from './received-buyer-event-activation.component';
import type { ReceivedDocumentsScope } from './received-documents.interface';

/** Fiscal-entity reception configuration, grouped around existing workflows. */
@Component({
  selector: 'app-received-documents-configuration',
  standalone: true,
  imports: [CardComponent, IconComponent, DocumentReceptionConnectionsComponent, ReceivedBuyerEventActivationComponent],
  template: `
    @if (canRead()) {
      <div class="w-full space-y-4">
        <app-card [responsive]="true">
          <section aria-labelledby="reception-connections-title" class="space-y-3">
            <div class="flex items-start gap-3">
              <span class="rounded-lg bg-primary/10 p-2 text-primary" aria-hidden="true"><app-icon name="inbox" [size]="18" /></span>
              <div>
                <h2 id="reception-connections-title" class="text-base font-semibold text-text-primary">Recepción de documentos</h2>
                <p class="mt-1 text-sm text-text-secondary">La importación manual de XML desde la bandeja funciona sin conexiones ni habilitación legal. No hay recepción directa desde la DIAN ni integración IMAP disponible.</p>
              </div>
            </div>
            @if (canConfigureConnections()) {
              <button type="button" class="min-h-11 rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50" [disabled]="!scopeReady()" (click)="openConnections()">Administrar conexiones</button>
            }
          </section>
        </app-card>

        <app-card [responsive]="true">
          <section aria-labelledby="reception-sync-title" class="space-y-2">
            <div class="flex items-start gap-3">
              <span class="rounded-lg bg-info-light p-2 text-info" aria-hidden="true"><app-icon name="refresh-cw" [size]="18" /></span>
              <div>
                <h2 id="reception-sync-title" class="text-base font-semibold text-text-primary">Sincronización</h2>
                <p class="mt-1 text-sm text-text-secondary">La sincronización depende del proveedor configurado. Recibir un documento no confirma autenticidad DIAN ni aceptación legal.</p>
              </div>
            </div>
            <p class="rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary">Administra la sincronización y su estado desde Conexiones. Los XML importados manualmente permanecen disponibles en la bandeja aunque una conexión falle.</p>
          </section>
        </app-card>

        <app-card [responsive]="true">
          <section aria-labelledby="reception-legal-title" class="space-y-2">
            <h2 id="reception-legal-title" class="text-base font-semibold text-text-primary">Habilitación de eventos legales</h2>
            <p class="text-sm text-text-secondary">Consulta la habilitación del comprador y solicita su revisión. Esto no envía eventos ni reemplaza la revisión manual del XML. El evento 034 es solo de consulta; no se ofrece su emisión.</p>
            <app-received-buyer-event-activation
              [scope]="scope()"
              [selectedStoreId]="selectedStoreId()"
              [scopeReady]="scopeReady()"
              [readOnly]="readOnly() || isSuperAdmin()"
            />
          </section>
        </app-card>

        <app-card [responsive]="true">
          <section aria-labelledby="reception-activity-title" class="space-y-2">
            <h2 id="reception-activity-title" class="text-base font-semibold text-text-primary">Actividad de recepción</h2>
            <p class="text-sm text-text-secondary">El historial por conexión muestra ejecuciones, cantidades y códigos seguros; no expone cursores ni cuerpos del proveedor.</p>
            @if (canConfigureConnections()) {
              <button type="button" class="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50" [disabled]="!scopeReady()" (click)="openConnections()">Ver historial de conexiones</button>
            }
          </section>
        </app-card>

        @if (canConfigureConnections()) {
          <app-document-reception-connections
            [(isOpen)]="connectionsOpen"
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

  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly selectedStoreId = input<number | null>(null);
  readonly scopeReady = input(true);
  readonly readOnly = input(false);
  readonly connectionsOpen = signal(false);
  private readonly isSuperAdmin = computed(() => {
    const roles = this.auth.userRoles();
    return roles.includes('super_admin') || roles.includes('SUPER_ADMIN');
  });
  readonly canRead = computed(() => this.auth.hasPermission(`${this.permissionPrefix()}:read`));
  readonly canConfigureConnections = computed(() =>
    !this.readOnly() && !this.isSuperAdmin() && this.scopeReady() && this.canRead() && this.auth.hasPermission(`${this.permissionPrefix()}:connections:configure`),
  );
  constructor() {
    effect(() => {
      const contextKey = `${this.scope()}:${this.selectedStoreId() ?? ''}:${this.scopeReady()}:${this.readOnly()}`;
      untracked(() => this.connectionsOpen.set(false));
      void contextKey;
    });
  }

  openConnections(): void {
    if (!this.canConfigureConnections()) return;
    this.connectionsOpen.set(true);
  }

  private permissionPrefix(): string {
    return this.scope() === 'store' ? 'invoicing:received' : 'organization:invoicing:received';
  }
}
