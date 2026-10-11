import { Component, computed, inject, input, signal } from '@angular/core';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { CardComponent, IconComponent } from '../../../../../shared/components/index';
import { DocumentReceptionConnectionsComponent } from './document-reception-connections.component';
import { ReceivedBuyerEventActivationComponent } from './received-buyer-event-activation.component';
import type { ReceivedDocumentsScope } from './received-documents.interface';

/**
 * Fiscal-entity configuration surface for supplier document reception.
 * Existing connection and DIAN activation workflows remain the source of
 * truth; this component only groups those workflows and explains the current
 * manual-only automation boundary.
 */
@Component({
  selector: 'app-received-documents-configuration',
  standalone: true,
  imports: [
    CardComponent,
    IconComponent,
    DocumentReceptionConnectionsComponent,
    ReceivedBuyerEventActivationComponent,
  ],
  template: `
    <div class="w-full space-y-4">
      <app-card [responsive]="true">
        <section aria-labelledby="reception-channels-title" class="space-y-3">
          <div class="flex items-start gap-3">
            <span class="rounded-lg bg-primary/10 p-2 text-primary" aria-hidden="true"><app-icon name="inbox" [size]="18" /></span>
            <div>
              <h2 id="reception-channels-title" class="text-base font-semibold text-text-primary">Canales de recepción</h2>
              <p class="mt-1 text-sm text-text-secondary">Configura un proveedor compatible por API HTTPS o webhook firmado. No hay conexión directa con la DIAN ni integración IMAP disponible.</p>
            </div>
          </div>
          @if (canConfigureConnections()) {
            <button type="button" class="min-h-11 rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50" [disabled]="!scopeReady()" (click)="openConnections()">Administrar conexiones</button>
          } @else {
            <p class="text-sm text-text-secondary">Tu usuario tiene acceso de consulta; solicita a un administrador que configure las conexiones.</p>
          }
        </section>
      </app-card>

      <app-card [responsive]="true">
        <section aria-labelledby="reception-sync-title" class="space-y-2">
          <div class="flex items-start gap-3">
            <span class="rounded-lg bg-info-light p-2 text-info" aria-hidden="true"><app-icon name="refresh-cw" [size]="18" /></span>
            <div>
              <h2 id="reception-sync-title" class="text-base font-semibold text-text-primary">Sincronización</h2>
              <p class="mt-1 text-sm text-text-secondary">La consulta periódica depende del proveedor API configurado; los webhooks dependen de la firma del proveedor. Una sincronización recibida no confirma autenticidad DIAN ni aceptación legal.</p>
            </div>
          </div>
          <p class="rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary">Administra la sincronización manual y su estado desde Conexiones. Los documentos ya importados siguen disponibles en la bandeja aunque una conexión falle.</p>
        </section>
      </app-card>

      <app-card [responsive]="true">
        <section aria-labelledby="reception-legal-title" class="space-y-2">
          <h2 id="reception-legal-title" class="text-base font-semibold text-text-primary">Habilitación de eventos legales</h2>
          <p class="text-sm text-text-secondary">Consulta la habilitación DIAN del comprador y solicita su revisión. La habilitación no envía eventos ni cambia la revisión manual de documentos.</p>
          <app-received-buyer-event-activation
            [scope]="scope()"
            [selectedStoreId]="selectedStoreId()"
            [scopeReady]="scopeReady()"
          />
        </section>
      </app-card>

      <app-card [responsive]="true">
        <section aria-labelledby="reception-ai-title" class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <h2 id="reception-ai-title" class="text-base font-semibold text-text-primary">Asistencia con IA</h2>
            <span class="rounded-full bg-surface-secondary px-2.5 py-1 text-xs font-medium text-text-secondary">No disponible</span>
          </div>
          <p class="text-sm text-text-secondary">La sugerencia y la automatización aún no están habilitadas. La clasificación, coincidencia, aceptación y contabilización permanecen manuales; esta pantalla no crea reglas ni ejecuta acciones.</p>
          <button type="button" class="min-h-11 cursor-not-allowed rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary opacity-60" disabled aria-describedby="reception-ai-help">Configurar asistencia</button>
          <p id="reception-ai-help" class="text-xs text-text-secondary">Los modos futuros no sustituirán el consentimiento, los permisos ni los requisitos legales.</p>
        </section>
      </app-card>

      <app-card [responsive]="true">
        <section aria-labelledby="reception-activity-title" class="space-y-2">
          <h2 id="reception-activity-title" class="text-base font-semibold text-text-primary">Actividad de recepción</h2>
          <p class="text-sm text-text-secondary">El historial por conexión muestra ejecuciones, cantidades y códigos seguros. No expone cursores ni cuerpos del proveedor.</p>
          @if (canConfigureConnections()) {
            <button type="button" class="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50" [disabled]="!scopeReady()" (click)="openConnections()">Ver historial de conexiones</button>
          } @else {
            <p class="text-sm text-text-secondary">El historial requiere el permiso de configuración de conexiones.</p>
          }
          <p class="text-xs text-text-secondary">El evento 034 es solo de consulta; no se ofrece emisión desde recepción.</p>
        </section>
      </app-card>

      <app-document-reception-connections
        [(isOpen)]="connectionsOpen"
        [scope]="scope()"
        [selectedStoreId]="selectedStoreId()"
      />
    </div>
  `,
})
export class ReceivedDocumentsConfigurationComponent {
  private readonly auth = inject(AuthFacade);

  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly selectedStoreId = input<number | null>(null);
  readonly scopeReady = input(true);
  readonly connectionsOpen = signal(false);
  readonly canConfigureConnections = computed(() =>
    this.auth.hasPermission(
      `${this.scope() === 'store' ? 'invoicing' : 'organization:invoicing'}:received:connections:configure`,
    ),
  );

  openConnections(): void {
    if (!this.canConfigureConnections() || !this.scopeReady()) return;
    this.connectionsOpen.set(true);
  }
}
