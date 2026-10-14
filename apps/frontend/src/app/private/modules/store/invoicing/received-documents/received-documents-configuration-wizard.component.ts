import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  StepsLineComponent,
  TooltipComponent,
  type StepsLineItem,
} from '../../../../../shared/components/index';
import { DianConfigApiService } from '../../../../../shared/services/dian';
import type { DianConfig } from '../interfaces/invoice.interface';
import type { FiscalReadinessAxis, FiscalReadinessResponse } from '../../../../../shared/components/dian';
import { DIAN_CONFIGURATION_TYPES, DIAN_ENABLEMENT_STATUS_LABELS } from '../../../../../shared/components/dian';
import { formatDateOnlyUTC } from '../../../../../shared/utils/date.util';
import { ReceivedBuyerEventActivationComponent } from './received-buyer-event-activation.component';
import type { ReceivedDocumentsScope } from './received-documents.interface';

const RECEPTION_STEPS: StepsLineItem[] = [
  { label: 'DIAN propia' },
  { label: 'Eventos' },
  { label: 'Operación' },
];

/** Manual document-reception setup. This wrapper never provisions a provider or downloads from DIAN. */
@Component({
  selector: 'app-received-documents-configuration-wizard',
  standalone: true,
  imports: [
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    ReactiveFormsModule,
    RouterLink,
    ReceivedBuyerEventActivationComponent,
    StepsLineComponent,
    TooltipComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      title="Recepción de documentos"
      subtitle="Configuración manual basada en la DIAN propia"
      size="xl"
      [dialog]="true"
      [canClose]="canCloseModal"
      [closeOnBackdrop]="false"
      [fullScreenOnMobile]="true"
      (cancel)="onClose()"
    >
      @if (!scopeEligible()) {
        <p class="rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary" role="note">{{ scopeBlockMessage() }}</p>
      } @else if (!canRead()) {
        <p class="rounded-lg border border-border bg-surface p-3 text-sm text-text-primary" role="note">No tienes permiso para consultar la configuración de recepción de documentos de esta tienda.</p>
      } @else {
        @if (readinessLoading()) {
          <p class="text-sm text-text-secondary" role="status">Consultando el estado fiscal…</p>
        } @else if (readinessError()) {
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error" role="alert">
            <span>{{ readinessError() }}</span>
            <app-button variant="outline" size="sm" (clicked)="loadReadiness()">Reintentar</app-button>
          </div>
        } @else if (!receptionActive()) {
          <div class="rounded-lg border border-warning/40 bg-warning-light p-3 text-sm text-text-primary" role="note">
            <p>Primero activa la configuración DIAN y la facturación electrónica de tu tienda</p>
            <a routerLink="/admin/invoicing/dian-config" (click)="close()" class="mt-3 inline-flex items-center justify-center rounded-lg px-3 py-2 font-medium text-primary underline focus:outline-none focus:ring-2 focus:ring-primary/50">Ir a configuración DIAN</a>
          </div>
        } @else {
        <div class="space-y-4">
        <app-steps-line [steps]="steps" [currentStep]="step()" [clickable]="false" size="sm" />
        @if (step() === 0) {
          <section aria-labelledby="reception-dian-step" class="space-y-4">
            <div class="flex items-start gap-2">
              <h2 id="reception-dian-step" class="text-base font-semibold text-text-primary">Configuración DIAN propia de facturación</h2>
              <app-tooltip content="Se consulta solo la habilitación de facturación de la entidad fiscal actual. El estado guardado y la preparación para producción son señales diferentes.">
                <button type="button" class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-primary/50" aria-label="Ayuda sobre la configuración DIAN propia"><app-icon name="info" [size]="16" /></button>
              </app-tooltip>
            </div>

            @if (invoicingAxis(); as axis) {
                <div class="grid gap-3 sm:grid-cols-2">
                  <app-card [responsive]="true" [responsivePadding]="true">
                    <p class="text-xs font-medium uppercase tracking-wide text-text-secondary">Software DIAN</p>
                    @if (safeSoftwareId()) {
                      <app-input size="lg" label="Identificador de software" [formControl]="softwareIdControl" [readonly]="true" tooltipText="Identificador informado por DIAN para el software propio. No se muestran PIN, contraseña ni huellas del certificado." />
                    } @else {
                      <p class="mt-1 text-sm text-text-secondary">{{ axis.config_id === null ? 'Sin configuración guardada' : 'No disponible en la consulta actual' }}</p>
                    }
                  </app-card>
                  <app-card [responsive]="true" [responsivePadding]="true">
                    <div class="flex items-center gap-1"><p class="text-xs font-medium uppercase tracking-wide text-text-secondary">Certificado</p><app-tooltip content="Solo se muestra si existe un certificado registrado y su fecha de vencimiento; nunca se revela la clave del archivo ni su huella."><button type="button" class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-primary/50" aria-label="Ayuda sobre certificado DIAN"><app-icon name="info" [size]="14" /></button></app-tooltip></div>
                    <p class="mt-1 text-sm text-text-primary">{{ hasCertificate() ? 'Registrado' : 'Pendiente' }}</p>
                    @if (certificateExpiry(); as expiry) { <p class="mt-1 text-xs text-text-secondary">Vence: {{ formatDate(expiry) }}</p> }
                  </app-card>
                  <app-card [responsive]="true" [responsivePadding]="true">
                    <div class="flex items-center gap-1"><p class="text-xs font-medium uppercase tracking-wide text-text-secondary">Habilitación DIAN</p><app-tooltip content="Este es el estado reportado por DIAN y el checklist de preparación del backend; guardar una configuración no cambia por sí solo la habilitación."><button type="button" class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-primary/50" aria-label="Ayuda sobre estado de habilitación"><app-icon name="info" [size]="14" /></button></app-tooltip></div>
                    <p class="mt-1 text-sm text-text-primary">{{ enablementLabel(axis) }}</p>
                    <p class="mt-1 text-xs text-text-secondary">Checklist de producción: {{ axis.readiness?.ready ? 'completo según la consulta' : 'con requisitos pendientes o sin informe' }}</p>
                  </app-card>
                  <app-card [responsive]="true" [responsivePadding]="true">
                    <div class="flex items-center gap-1"><p class="text-xs font-medium uppercase tracking-wide text-text-secondary">Ambiente</p><app-tooltip content="Pruebas no equivale a producción. El ambiente reportado se lee de la configuración DIAN actual."><button type="button" class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-primary/50" aria-label="Ayuda sobre ambiente DIAN"><app-icon name="info" [size]="14" /></button></app-tooltip></div>
                    <p class="mt-1 text-sm text-text-primary">{{ environmentLabel(axis.environment) }}</p>
                  </app-card>
                </div>
              } @else {
                <div class="rounded-lg border border-border bg-surface p-3 text-sm text-text-secondary" role="status">No se encontró un eje DIAN de facturación para esta entidad fiscal.</div>
              }
              <div class="rounded-lg border border-warning/40 bg-warning-light p-3 text-sm text-text-primary" role="note">
                Guardar datos no significa que DIAN haya habilitado la recepción ni que Vendix descargue documentos desde DIAN. La importación disponible es manual desde la bandeja.
              </div>
          </section>
        } @else if (step() === 1) {
          <section aria-labelledby="reception-events-step" class="space-y-3">
            <div class="flex items-start gap-2">
              <h2 id="reception-events-step" class="text-base font-semibold text-text-primary">Habilitación del comprador y eventos</h2>
              <app-tooltip content="Consultar los requisitos pendientes no transmite eventos. La solicitud pasa a revisión, pero no significa aprobación de la DIAN.">
                <button type="button" class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-primary/50" aria-label="Ayuda sobre eventos del comprador"><app-icon name="info" [size]="16" /></button>
              </app-tooltip>
            </div>
            <app-received-buyer-event-activation
              [scope]="scope()"
              [selectedStoreId]="selectedStoreId()"
              [scopeReady]="scopeEligible()"
              [readOnly]="readOnly() || !scopeEligible()"
              [embedded]="true"
            />
          </section>
        } @else {
          <section aria-labelledby="reception-operation-step" class="space-y-4">
            <div class="flex items-start gap-2">
              <h2 id="reception-operation-step" class="text-base font-semibold text-text-primary">Operación de la bandeja</h2>
              <app-tooltip content="La importación manual agrega evidencia para revisión; no valida autenticidad DIAN ni acepta legalmente el documento.">
                <button type="button" class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-primary/50" aria-label="Ayuda sobre operación de la bandeja"><app-icon name="info" [size]="16" /></button>
              </app-tooltip>
            </div>
            <p class="text-sm text-text-secondary">La recepción automática desde DIAN no está implementada. Descarga el XML por el canal que corresponda e impórtalo manualmente; después revisa, concilia y consulta los eventos disponibles.</p>
            <div class="flex flex-col gap-2 sm:flex-row">
              <a routerLink="/admin/invoicing/received-documents" class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-[var(--color-text-on-primary)] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/50">
                <app-icon name="inbox" [size]="16" /> Abrir bandeja e importar XML manualmente
              </a>
            </div>
            <p class="text-sm text-text-secondary">En la bandeja, revisa evidencia, concilia los documentos e inspecciona los eventos disponibles. “Listo” no significa aceptación DIAN.</p>
          </section>
        }
      </div>
      }
      }

      <div slot="footer" class="flex flex-col-reverse justify-between gap-2 sm:flex-row sm:items-center">
        <app-button variant="outline" size="md" [disabled]="busy()" (clicked)="close()">Cerrar</app-button>
        @if (receptionActive()) {
          <div class="flex flex-col-reverse gap-2 sm:flex-row">
            <app-button variant="outline" size="md" [disabled]="step() === 0 || busy()" (clicked)="previousStep()">Anterior</app-button>
            @if (step() < steps.length - 1) {
              <app-button variant="primary" size="md" [disabled]="busy()" (clicked)="nextStep()">Continuar</app-button>
            }
          </div>
        }
      </div>
    </app-modal>
  `,
})
export class ReceivedDocumentsConfigurationWizardComponent {
  private readonly auth = inject(AuthFacade);
  private readonly api = inject(DianConfigApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model(false);
  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly selectedStoreId = input<number | null>(null);
  readonly scopeReady = input(true);
  readonly readOnly = input(false);
  readonly steps = RECEPTION_STEPS;
  readonly step = signal(0);
  readonly readinessLoading = signal(false);
  readonly readinessError = signal<string | null>(null);
  readonly readiness = signal<FiscalReadinessResponse | null>(null);
  readonly selectedConfig = signal<DianConfig | null>(null);
  readonly isSuperAdmin = computed(() => {
    const roles = this.auth.userRoles();
    return roles.includes('super_admin') || roles.includes('SUPER_ADMIN');
  });
  readonly scopeEligible = computed(() => this.scope() === 'store' && this.scopeReady() && !this.isSuperAdmin());
  readonly canRead = computed(() => this.scopeEligible() && this.auth.hasPermission(`${this.permissionPrefix()}:read`));
  readonly invoicingAxis = computed(() => this.readiness()?.axes.find((axis) => axis.configuration_type === 'invoicing') ?? null);
  readonly receptionActive = computed(() => {
    const axis = this.invoicingAxis();
    const config = this.selectedConfig();
    return this.isOpen()
      && this.scopeEligible()
      && this.canRead()
      && !this.readinessLoading()
      && !this.readinessError()
      && axis?.config_id !== null && axis?.config_id !== undefined
      && axis.environment === 'production'
      && axis.enablement_status === 'enabled'
      && config?.id === axis.config_id
      && config.environment === 'production'
      && config.enablement_status === 'enabled';
  });
  readonly safeSoftwareId = computed(() => this.selectedConfig()?.software_id ?? null);
  readonly certificateExpiry = computed(() => this.selectedConfig()?.certificate_expiry ?? null);
  readonly hasCertificate = computed(() => {
    const config = this.selectedConfig();
    return config?.certificate_present ?? Boolean(config?.certificate_s3_key);
  });
  readonly softwareIdControl = new FormControl('', { nonNullable: true });
  private readonly eventActivation = viewChild(ReceivedBuyerEventActivationComponent);
  readonly busy = computed(() => !!this.eventActivation()?.submitLoading());
  readonly canCloseModal = (): boolean => !this.busy();

  private readinessRequest?: Subscription;
  private configRequest?: Subscription;
  private generation = 0;
  private contextKey = '';
  private wasOpen = false;
  private wasEligible = false;

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const scope = this.scope();
      const storeId = this.selectedStoreId();
      const ready = this.scopeReady();
      const readOnly = this.readOnly();
      const key = `${scope}:${storeId ?? ''}:${ready}:${readOnly}`;
      const changed = key !== this.contextKey;
      const canRead = this.canRead();
      const eligible = open && canRead && this.scopeEligible();
      const opened = open && !this.wasOpen;
      const becameEligible = eligible && !this.wasEligible;
      this.contextKey = key;
      this.wasOpen = open;
      this.wasEligible = eligible;
      if (!eligible) {
        untracked(() => this.reset());
        return;
      }
      if (changed || opened || becameEligible) {
        untracked(() => {
          this.reset();
          this.loadReadiness();
        });
      }
    });
  }

  loadReadiness(): void {
    if (!this.isOpen() || !this.scopeEligible() || !this.canRead()) return;
    this.readinessRequest?.unsubscribe();
    this.configRequest?.unsubscribe();
    const generation = ++this.generation;
    this.readinessLoading.set(true);
    this.readinessError.set(null);
    this.readiness.set(null);
    this.selectedConfig.set(null);
    this.softwareIdControl.setValue('');
    this.step.set(0);
    this.readinessRequest = this.api.getFiscalReadiness().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response: unknown) => {
        if (generation !== this.generation) return;
        const payload = this.readFiscalReadiness(response);
        if (!payload) {
          this.failReadiness('La respuesta del estado fiscal no tiene un formato válido. Reintenta la consulta.');
          return;
        }
        this.readiness.set(payload);
        const configId = payload.axes.find((axis) => axis.configuration_type === 'invoicing')?.config_id;
        if (configId === null || configId === undefined) {
          this.readinessLoading.set(false);
          return;
        }
        this.configRequest = this.api.getDianConfigById(configId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (configResponse: unknown) => {
            if (generation !== this.generation) return;
            const config = this.readDianConfig(configResponse);
            if (!config || config.id !== configId) {
              this.failReadiness('La respuesta de la configuración DIAN guardada no es válida. Reintenta la consulta.');
              return;
            }
            this.selectedConfig.set(config);
            this.softwareIdControl.setValue(config.software_id);
            this.readinessLoading.set(false);
          },
          error: (error: unknown) => {
            if (generation !== this.generation) return;
            this.readinessLoading.set(false);
            this.readinessError.set(extractApiErrorMessage(error) || 'No se pudo consultar la configuración DIAN guardada.');
          },
        });
      },
      error: (error: unknown) => {
        if (generation !== this.generation) return;
        this.readinessLoading.set(false);
        this.readinessError.set(extractApiErrorMessage(error) || 'No se pudo consultar el estado de la entidad fiscal.');
      },
    });
  }

  nextStep(): void {
    if (this.busy() || !this.receptionActive()) return;
    if (this.step() < this.steps.length - 1) this.step.update((current) => current + 1);
  }

  previousStep(): void {
    if (this.busy() || !this.receptionActive()) return;
    if (this.step() > 0) this.step.update((current) => current - 1);
  }

  close(): void {
    if (!this.canCloseModal()) return;
    this.isOpen.set(false);
    this.onClose();
  }

  scopeBlockMessage(): string {
    if (this.isSuperAdmin()) return 'La recepción no está disponible en perfiles superadmin.';
    if (this.scope() !== 'store') return 'La recepción de una organización se configura desde su propio panel. Este asistente solo atiende entidades fiscales de tienda.';
    return 'Selecciona una entidad fiscal de tienda para usar esta configuración.';
  }

  onClose(): void {
    this.reset();
  }

  enablementLabel(axis: FiscalReadinessAxis): string {
    return DIAN_ENABLEMENT_STATUS_LABELS[axis.enablement_status] ?? 'Estado no disponible';
  }

  environmentLabel(environment: string | null): string {
    if (environment === 'production') return 'Producción';
    if (environment === 'test') return 'Pruebas';
    return 'Sin configurar';
  }

  formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
    return formatDateOnlyUTC(date);
  }

  private readFiscalReadiness(response: unknown): FiscalReadinessResponse | null {
    const payload = this.unwrapData(response);
    if (!this.isRecord(payload) || !Array.isArray(payload['axes'])) return null;
    const validAxes = payload['axes'].every((axis: unknown) => {
      if (!this.isRecord(axis)) return false;
      const type = axis['configuration_type'];
      const configId = axis['config_id'];
      return typeof type === 'string'
        && DIAN_CONFIGURATION_TYPES.some((allowedType) => allowedType === type)
        && (configId === null || (typeof configId === 'number' && Number.isFinite(configId)));
    });
    return validAxes ? payload as unknown as FiscalReadinessResponse : null;
  }

  private readDianConfig(response: unknown): DianConfig | null {
    const config = this.unwrapData(response);
    if (!this.isRecord(config)) return null;
    const validEnvironments = ['test', 'production'];
    const validStatuses: DianConfig['enablement_status'][] = [
      'not_started',
      'testing',
      'test_set_passed',
      'enabled',
      'suspended',
      'expired',
    ];
    return typeof config['id'] === 'number'
      && Number.isFinite(config['id'])
      && typeof config['software_id'] === 'string'
      && validEnvironments.includes(config['environment'] as string)
      && validStatuses.includes(config['enablement_status'] as DianConfig['enablement_status'])
      ? config as unknown as DianConfig
      : null;
  }

  private unwrapData(response: unknown): unknown {
    if (this.isRecord(response) && Object.prototype.hasOwnProperty.call(response, 'data')) {
      return response['data'];
    }
    return response;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private failReadiness(message: string): void {
    this.readiness.set(null);
    this.selectedConfig.set(null);
    this.softwareIdControl.setValue('');
    this.readinessLoading.set(false);
    this.readinessError.set(message);
  }

  private permissionPrefix(): string {
    return this.scope() === 'store' ? 'invoicing:received' : 'organization:invoicing:received';
  }

  private reset(): void {
    this.generation++;
    this.readinessRequest?.unsubscribe();
    this.configRequest?.unsubscribe();
    this.readinessRequest = undefined;
    this.configRequest = undefined;
    this.readinessLoading.set(false);
    this.readinessError.set(null);
    this.readiness.set(null);
    this.selectedConfig.set(null);
    this.softwareIdControl.setValue('');
    this.step.set(0);
  }
}
