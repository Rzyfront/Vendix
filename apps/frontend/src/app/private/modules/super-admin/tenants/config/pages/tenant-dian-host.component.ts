import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { fromEvent, of, timer, type Observable } from 'rxjs';
import { catchError, filter, exhaustMap, startWith, tap } from 'rxjs/operators';

import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { DianConfigComponent } from '../../../../store/invoicing/components/dian-config/dian-config.component';
import type {
  DianConfig,
  DianEmissionStatus,
  DianTestResult,
  InvoiceResolution,
} from '../../../../store/invoicing/interfaces/invoice.interface';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  ConfirmationModalComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  ToastService,
  type SelectorOption,
} from '../../../../../../shared/components';
import { DianConfigApiService } from '../../../../../../shared/services/dian';
import {
  TENANT_CAPABILITY,
  fiscalOwnerNotice,
} from '../../services/superadmin-dian-context.factory';
import { TenantContextStore } from '../../state/tenant-context.store';

/** Centinela con el que la API representa un secreto guardado. */
const MASKED_SECRET = '****';

/** Cada cuánto se sondea el job encolado o el veredicto pendiente de la DIAN. */
const POLL_INTERVAL_MS = 15_000;

/**
 * Bloque de consecutivos que el envío del set va a quemar. Lo calcula el backend
 * en la respuesta de `run-test-set` — antes de que el worker reserve nada — y es
 * la ÚNICA cifra autoritativa: la proyección que se muestra en la confirmación
 * se calcula con la composición que el propio backend publica, pero el rango
 * final lo fija quien reserva.
 */
interface TestSetConsumes {
  readonly resolution_id: number;
  readonly prefix: string | null;
  readonly resolution_number: string | null;
  readonly composition?: { readonly total: number; readonly label: string };
  readonly number_from: number;
  readonly number_to: number;
  readonly range_to: number;
  readonly irreversible: boolean;
}

interface TestSetComposition {
  readonly total: number;
  readonly label: string;
}

type RiskyAction = 'certificate' | 'run-test-set' | 'abandon';

/**
 * Documentos electrónicos del tenant, desde la consola de super admin.
 *
 * ARQUITECTURA DE ESTA PANTALLA — importa entenderla antes de tocarla:
 *
 * 1. **El componente compartido se monta tal cual.** `vendix-dian-config` es el
 *    mismo que ve el comerciante; no lleva un solo condicional de alcance
 *    dentro. Habla con el tenant abierto porque la RUTA reapunta
 *    `DIAN_API_CONTEXT` (ver `provideSuperadminDianApi`), no porque el
 *    componente sepa dónde está montado.
 *
 * 2. **El gating por capacidades vive AQUÍ.** `TenantContextStore.can()` devuelve
 *    `false` cuando el perfil no declara la capacidad, así que la consola cae en
 *    solo lectura por defecto. Ofrecer un botón de escritura porque el backend
 *    no dijo nada es peor que no ofrecerlo.
 *
 * 3. **Las operaciones irreversibles se ejercen desde este host, con
 *    confirmación reforzada**, y no desde el asistente del comerciante: subir el
 *    `.p12` de un tercero, quemar consecutivos autorizados y promover a
 *    producción son acciones que en soporte se hacen sobre el NIT de OTRO, y la
 *    fricción tiene que ser proporcional a eso. El asistente conserva sus
 *    propios botones porque es código compartido; el camino soportado para
 *    super admin es este panel.
 */
@Component({
  selector: 'app-tenant-dian-host',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    ConfirmationModalComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    DianConfigComponent,
  ],
  template: `
    <div class="space-y-3 md:space-y-4">
      @if (ownerNotice(); as notice) {
        <app-alert-banner variant="warning" icon="alert-triangle">
          {{ notice.message }}
          <a
            [routerLink]="notice.route"
            class="ml-1 font-semibold underline underline-offset-2"
          >
            Abrir {{ notice.organizationName }}
          </a>
        </app-alert-banner>
      }

      @if (!anyCapability()) {
        <app-alert-banner variant="info" icon="info">
          El perfil de este tenant no declara ninguna capacidad de escritura
          DIAN, así que la consola opera en solo lectura. La autorización real la
          resuelve el backend; esta pantalla sólo deja de ofrecer lo que no se
          declaró.
        </app-alert-banner>
      }

      <!-- Estado de emisión ------------------------------------------------ -->
      <app-card [responsive]="true">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-text-primary">
              Emisión electrónica
            </h2>
            <p class="mt-0.5 max-w-xl text-xs text-text-secondary">
              {{ emissionReason() }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <app-badge [variant]="emissionVariant()" size="sm">
              {{ emissionLabel() }}
            </app-badge>
            <app-button
              variant="ghost"
              size="sm"
              [loading]="refreshing()"
              (clicked)="reload()"
            >
              <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
              Actualizar
            </app-button>
          </div>
        </div>
      </app-card>

      <!-- Operaciones de riesgo -------------------------------------------- -->
      @if (configs().length) {
        <app-card [responsive]="true">
          <div class="space-y-4">
            <header class="border-b border-border pb-3">
              <h2 class="text-base font-semibold text-text-primary">
                Operaciones de habilitación
              </h2>
              <p class="mt-0.5 text-xs text-text-secondary">
                Acciones que tocan la identidad fiscal del contribuyente. Todas
                piden confirmación explícita.
              </p>
            </header>

            <!-- app-selector es un CVA: su valor entra por formControl, no por
                 un input "value". Las señales de esta pantalla se puentean con
                 toSignal porque un computed() no reacciona a un FormControl. -->
            <app-selector
              label="Configuración DIAN"
              [options]="configOptions()"
              [formControl]="configControl"
            ></app-selector>

            @if (selectedConfig(); as config) {
              <!-- Certificado ------------------------------------------- -->
              <section class="rounded-lg border border-border p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <app-icon
                      name="key"
                      [size]="16"
                      class="text-text-secondary"
                    ></app-icon>
                    <h3 class="text-sm font-semibold text-text-primary">
                      Certificado digital
                    </h3>
                  </div>
                  <app-badge
                    [variant]="hasCertificate(config) ? 'success' : 'neutral'"
                    size="xs"
                  >
                    {{ hasCertificate(config) ? 'Cargado' : 'Sin cargar' }}
                  </app-badge>
                </div>

                @if (canUploadCertificate()) {
                  <div class="mt-3 space-y-2">
                    <input
                      type="file"
                      accept=".p12,.pfx"
                      class="block w-full text-xs text-text-secondary file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:text-text-primary"
                      (change)="onCertificateFile($event)"
                    />
                    <app-input
                      label="Contraseña del certificado"
                      type="password"
                      [formControl]="certificatePassword"
                      helperText="Se precarga enmascarada cuando ya hay una guardada. Un .p12 nuevo exige escribir la suya: la almacenada no lo abre."
                    ></app-input>
                    <div class="flex justify-end">
                      <app-button
                        variant="primary"
                        size="sm"
                        [disabled]="!canSubmitCertificate()"
                        [loading]="uploadingCertificate()"
                        (clicked)="askAction('certificate')"
                      >
                        <app-icon
                          name="upload"
                          [size]="16"
                          slot="icon"
                        ></app-icon>
                        Subir certificado
                      </app-button>
                    </div>
                  </div>
                } @else {
                  <p class="mt-2 text-[11px] text-text-secondary">
                    Requiere la capacidad
                    <code>{{ capability.dianCertificateWrite }}</code>.
                  </p>
                }
              </section>

              <!-- Set de pruebas ---------------------------------------- -->
              <section class="rounded-lg border border-border p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <app-icon
                      name="file-check"
                      [size]="16"
                      class="text-text-secondary"
                    ></app-icon>
                    <h3 class="text-sm font-semibold text-text-primary">
                      Set de pruebas de habilitación
                    </h3>
                  </div>
                  <app-badge [variant]="testSetVariant()" size="xs">
                    {{ testSetLabel() }}
                  </app-badge>
                </div>

                @if (consumes(); as burned) {
                  <div
                    class="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
                  >
                    <p class="font-semibold">
                      Consecutivos quemados por el último envío
                    </p>
                    <p class="mt-0.5">
                      {{ burned.prefix }}{{ burned.number_from }} –
                      {{ burned.prefix }}{{ burned.number_to }} · hasta
                      {{ burned.range_to }} autorizado. No se recuperan.
                    </p>
                  </div>
                }

                @if (polling()) {
                  <div
                    class="mt-3 flex items-center gap-2 rounded-md bg-background p-2 text-xs text-text-secondary"
                  >
                    <div
                      class="h-3 w-3 animate-spin rounded-full border-b-2 border-primary"
                    ></div>
                    <span>{{ pollingLabel() }}</span>
                  </div>
                }

                @if (canRunTestSet()) {
                  <div class="mt-3 space-y-2">
                    <app-selector
                      label="Resolución de numeración"
                      [options]="resolutionOptions()"
                      [formControl]="resolutionControl"
                      helpText="El envío consume un bloque de esta resolución."
                    ></app-selector>

                    @if (projectedBurn(); as burn) {
                      <p class="text-[11px] text-text-secondary">
                        Proyección: {{ burn.label }} — quemaría
                        {{ burn.numberFrom }} → {{ burn.numberTo }}
                        ({{ burn.total }} consecutivos).
                        @if (burn.overflows) {
                          <span class="font-semibold text-red-600">
                            Excede el rango autorizado ({{ burn.rangeTo }}).
                          </span>
                        }
                      </p>
                    }

                    <div class="flex flex-wrap justify-end gap-2">
                      <app-button
                        variant="outline"
                        size="sm"
                        [disabled]="!canAbandon()"
                        [loading]="abandoning()"
                        (clicked)="askAction('abandon')"
                      >
                        <app-icon
                          name="trash-2"
                          [size]="16"
                          slot="icon"
                        ></app-icon>
                        Descartar lote
                      </app-button>
                      <app-button
                        variant="primary"
                        size="sm"
                        [disabled]="!canSubmitTestSet()"
                        [loading]="runningTestSet()"
                        (clicked)="askAction('run-test-set')"
                      >
                        <app-icon name="play" [size]="16" slot="icon"></app-icon>
                        Ejecutar set de pruebas
                      </app-button>
                    </div>
                  </div>
                } @else {
                  <p class="mt-2 text-[11px] text-text-secondary">
                    Requiere la capacidad <code>{{ capability.dianWrite }}</code
                    >.
                  </p>
                }
              </section>

              <!-- Promoción a producción -------------------------------- -->
              <section class="rounded-lg border border-border p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <app-icon
                      name="globe"
                      [size]="16"
                      class="text-text-secondary"
                    ></app-icon>
                    <h3 class="text-sm font-semibold text-text-primary">
                      Promover a producción
                    </h3>
                  </div>
                  <app-badge
                    [variant]="
                      config.environment === 'production' ? 'success' : 'neutral'
                    "
                    size="xs"
                  >
                    {{
                      config.environment === 'production'
                        ? 'Producción'
                        : 'Pruebas'
                    }}
                  </app-badge>
                </div>

                <p class="mt-2 text-xs text-text-secondary">
                  A partir de la promoción, cada venta del comerciante se emite
                  ante la DIAN con este NIT y deja de imprimirse como documento
                  no fiscal.
                </p>

                @if (canPromote()) {
                  <div class="mt-3 flex justify-end">
                    <app-button
                      variant="danger"
                      size="sm"
                      [disabled]="
                        promoting() || config.environment === 'production'
                      "
                      [loading]="promoting()"
                      (clicked)="openPromoteGate()"
                    >
                      <app-icon name="globe" [size]="16" slot="icon"></app-icon>
                      Promover a producción
                    </app-button>
                  </div>
                } @else {
                  <p class="mt-2 text-[11px] text-text-secondary">
                    Requiere la capacidad <code>{{ capability.dianPromote }}</code
                    >.
                  </p>
                }
              </section>
            }
          </div>
        </app-card>
      }

      <!-- Módulo compartido de configuraciones DIAN ------------------------ -->
      <vendix-dian-config [readOnly]="!canWriteConfig()"></vendix-dian-config>
    </div>

    <!-- Confirmaciones ---------------------------------------------------- -->
    @if (pendingAction(); as action) {
      <app-confirmation-modal
        [isOpen]="true"
        [title]="confirmTitle(action)"
        [message]="confirmMessage(action)"
        [confirmText]="confirmCta(action)"
        cancelText="Cancelar"
        confirmVariant="danger"
        size="md"
        (confirm)="runAction(action)"
        (cancel)="pendingAction.set(null)"
      ></app-confirmation-modal>
    }

    <!-- Promoción: exige teclear el NIT ------------------------------------ -->
    <app-modal
      [(isOpen)]="promoteGateOpen"
      title="Promover a producción"
      subtitle="Confirmación reforzada"
      size="md"
      [closeOnBackdrop]="false"
      (cancel)="onPromoteGateClosed()"
    >
      <div class="space-y-3">
        <app-alert-banner variant="danger" icon="alert-triangle">
          Estás a punto de poner a facturar en producción el NIT de
          {{ store.tenantName() }}. Los documentos que se emitan desde ese
          momento son fiscales ante la DIAN y no se pueden retirar: sólo se
          anulan con nota crédito.
        </app-alert-banner>

        <p class="text-sm text-text-secondary">
          Escribe el NIT
          <strong class="text-text-primary">{{ expectedNit() }}</strong> para
          confirmar que operas sobre el contribuyente correcto.
        </p>

        <app-input
          label="NIT del tenant"
          [formControl]="promoteNit"
          placeholder="Sin dígito de verificación"
        ></app-input>

        @if (promoteNitTyped().length && !promoteNitMatches()) {
          <p class="flex items-center gap-1.5 text-xs text-red-600">
            <app-icon name="alert-triangle" [size]="14"></app-icon>
            El NIT no coincide con el de la configuración seleccionada.
          </p>
        }
      </div>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" size="sm" (clicked)="closePromoteGate()">
          Cancelar
        </app-button>
        <app-button
          variant="danger"
          size="sm"
          [disabled]="!promoteNitMatches() || promoting()"
          [loading]="promoting()"
          (clicked)="promoteToProduction()"
        >
          <app-icon name="globe" [size]="16" slot="icon"></app-icon>
          Promover
        </app-button>
      </div>
    </app-modal>
  `,
})
export class TenantDianHostComponent {
  private readonly api = inject(DianConfigApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly store = inject(TenantContextStore);

  protected readonly capability = TENANT_CAPABILITY;

  // ── Datos ────────────────────────────────────────────────────────────
  protected readonly configs = signal<DianConfig[]>([]);
  protected readonly resolutions = signal<InvoiceResolution[]>([]);
  protected readonly emission = signal<DianEmissionStatus | null>(null);
  protected readonly lastResult = signal<DianTestResult | null>(null);
  protected readonly composition = signal<TestSetComposition | null>(null);
  protected readonly consumes = signal<TestSetConsumes | null>(null);

  // Los dos selectores son CVAs: el valor viaja por FormControl y se puentea a
  // señal con `toSignal`, porque un `computed()` que lea `control.value` se
  // evaluaría una sola vez y jamás volvería a recalcularse.
  protected readonly configControl = new FormControl<number | null>(null);
  protected readonly resolutionControl = new FormControl<number | null>(null);

  private readonly configControlValue = toSignal(
    this.configControl.valueChanges.pipe(startWith(this.configControl.value)),
    { initialValue: this.configControl.value },
  );
  private readonly resolutionControlValue = toSignal(
    this.resolutionControl.valueChanges.pipe(
      startWith(this.resolutionControl.value),
    ),
    { initialValue: this.resolutionControl.value },
  );

  protected readonly selectedConfigId = computed<number | null>(() =>
    this.toId(this.configControlValue()),
  );
  protected readonly selectedResolutionId = computed<number | null>(() =>
    this.toId(this.resolutionControlValue()),
  );

  // ── Estado de UI ─────────────────────────────────────────────────────
  protected readonly refreshing = signal(false);
  protected readonly uploadingCertificate = signal(false);
  protected readonly runningTestSet = signal(false);
  protected readonly abandoning = signal(false);
  protected readonly promoting = signal(false);
  protected readonly pendingAction = signal<RiskyAction | null>(null);
  protected readonly promoteGateOpen = signal(false);

  private readonly certificateFile = signal<File | null>(null);
  private readonly activeJobId = signal<string | null>(null);

  protected readonly certificatePassword = new FormControl<string>('', {
    nonNullable: true,
  });
  protected readonly promoteNit = new FormControl<string>('', {
    nonNullable: true,
  });

  /**
   * `computed()` no reacciona a un `FormControl`: sus propiedades son campos
   * planos. Sin este puente el botón de promoción no se habilitaría nunca.
   */
  private readonly certificatePasswordTyped = toSignal(
    this.certificatePassword.valueChanges.pipe(
      startWith(this.certificatePassword.value),
    ),
    { initialValue: this.certificatePassword.value },
  );

  protected readonly promoteNitTyped = toSignal(
    this.promoteNit.valueChanges.pipe(startWith(this.promoteNit.value)),
    { initialValue: this.promoteNit.value },
  );

  /** Gate de visibilidad: una pestaña oculta no interroga a la DIAN. */
  private readonly documentVisible = signal(true);

  // ── Derivados ────────────────────────────────────────────────────────
  protected readonly ownerNotice = computed(() => fiscalOwnerNotice(this.store));

  protected readonly canWriteConfig = computed(() =>
    this.store.can(TENANT_CAPABILITY.dianWrite),
  );
  protected readonly canUploadCertificate = computed(() =>
    this.store.can(TENANT_CAPABILITY.dianCertificateWrite),
  );
  protected readonly canRunTestSet = computed(() =>
    this.store.can(TENANT_CAPABILITY.dianWrite),
  );
  protected readonly canPromote = computed(() =>
    this.store.can(TENANT_CAPABILITY.dianPromote),
  );
  protected readonly anyCapability = computed(
    () =>
      this.canWriteConfig() ||
      this.canUploadCertificate() ||
      this.canPromote(),
  );

  protected readonly selectedConfig = computed<DianConfig | null>(() => {
    const id = this.selectedConfigId();
    return this.configs().find((config) => config.id === id) ?? null;
  });

  protected readonly selectedResolution = computed<InvoiceResolution | null>(
    () => {
      const id = this.selectedResolutionId();
      return this.resolutions().find((row) => row.id === id) ?? null;
    },
  );

  protected readonly configOptions = computed<SelectorOption[]>(() =>
    this.configs().map((config) => ({
      value: config.id,
      label: config.is_default ? `${config.name} (predeterminada)` : config.name,
      description: `${config.nit}${config.nit_dv ? '-' + config.nit_dv : ''} · ${
        config.environment === 'production' ? 'Producción' : 'Pruebas'
      }`,
    })),
  );

  protected readonly resolutionOptions = computed<SelectorOption[]>(() =>
    this.resolutions().map((row) => ({
      value: row.id,
      label: `${row.prefix || 'sin prefijo'} · ${row.resolution_number}`,
      description: `Actual ${row.current_number} · rango ${row.range_from}–${row.range_to}`,
      disabled: !row.is_active,
    })),
  );

  protected readonly expectedNit = computed(
    () => this.selectedConfig()?.nit ?? '',
  );

  protected readonly promoteNitMatches = computed(() => {
    const expected = this.expectedNit().trim();
    if (!expected) return false;
    return this.promoteNitTyped().trim() === expected;
  });

  /**
   * Proyección del bloque que el envío quemaría.
   *
   * El total NO está hardcodeado: sale de `composition` que publica el propio
   * backend en `getDianTestResults`. Hardcodear 50 aquí es exactamente el
   * defecto que costó una habilitación — la composición la aprovisiona la DIAN
   * por set y sólo el backend la conoce.
   */
  protected readonly projectedBurn = computed(() => {
    const resolution = this.selectedResolution();
    const composition = this.composition();
    if (!resolution || !composition) return null;

    const numberFrom = Math.max(
      resolution.range_from,
      (resolution.current_number ?? 0) + 1,
    );
    const numberTo = numberFrom + composition.total - 1;

    return {
      label: composition.label,
      total: composition.total,
      numberFrom,
      numberTo,
      rangeTo: resolution.range_to,
      overflows: numberTo > resolution.range_to,
    };
  });

  /** Hay veredicto pendiente que la DIAN todavía puede emitir. */
  private readonly verdictPending = computed(() => {
    const result = this.lastResult();
    if (!result) return false;
    if (result.success || result.rejected) return false;
    if (result.wait?.stalled) return false;
    return result.pending === true;
  });

  protected readonly polling = computed(
    () => this.activeJobId() !== null || this.verdictPending(),
  );

  protected readonly pollingLabel = computed(() =>
    this.activeJobId() !== null
      ? 'Construyendo, firmando y enviando el lote a la DIAN…'
      : 'La DIAN acusó recibo del lote y todavía no emite veredicto.',
  );

  protected readonly testSetLabel = computed(() => {
    const result = this.lastResult();
    if (!result) return 'No enviado';
    if (result.success) return 'Aprobado';
    if (result.rejected) return 'Rechazado';
    if (result.wait?.stalled) return 'Sin veredicto';
    if (result.pending) return 'En validación';
    return 'Desconocido';
  });

  protected readonly testSetVariant = computed<
    'success' | 'warning' | 'error' | 'neutral'
  >(() => {
    const result = this.lastResult();
    if (!result) return 'neutral';
    if (result.success) return 'success';
    if (result.rejected) return 'error';
    if (result.wait?.stalled) return 'error';
    if (result.pending) return 'warning';
    return 'neutral';
  });

  protected readonly emissionLabel = computed(() =>
    this.emission()?.is_live ? 'Emitiendo' : 'No emite',
  );

  protected readonly emissionVariant = computed<'success' | 'neutral'>(() =>
    this.emission()?.is_live ? 'success' : 'neutral',
  );

  protected readonly emissionReason = computed(
    () =>
      this.emission()?.reason ??
      (this.emission()?.is_live
        ? 'La tienda emite facturas electrónicas ante la DIAN ahora mismo.'
        : 'Estado de emisión no disponible.'),
  );

  // ── Habilitación de botones ──────────────────────────────────────────
  protected readonly canSubmitCertificate = computed(() => {
    if (!this.canUploadCertificate() || this.uploadingCertificate()) {
      return false;
    }
    if (!this.certificateFile()) return false;
    const password = this.certificatePasswordTyped().trim();
    // El centinela NO se envía: es lo que la API devuelve para decir «hay una
    // guardada», y la guardada no abre el .p12 nuevo.
    return password.length > 0 && password !== MASKED_SECRET;
  });

  protected readonly canSubmitTestSet = computed(() => {
    if (!this.canRunTestSet() || this.runningTestSet()) return false;
    if (this.selectedResolutionId() === null) return false;
    if (this.polling()) return false;
    return true;
  });

  protected readonly canAbandon = computed(() => {
    if (!this.canRunTestSet() || this.abandoning()) return false;
    const result = this.lastResult();
    return Boolean(result?.pending) || Boolean(result?.wait?.stalled);
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.documentVisible.set(document.visibilityState === 'visible');
      fromEvent(document, 'visibilitychange')
        .pipe(takeUntilDestroyed())
        .subscribe(() =>
          this.documentVisible.set(document.visibilityState === 'visible'),
        );
    }

    /**
     * UN solo sondeo para toda la pantalla, creado una vez y atado al ciclo de
     * vida del componente. Nada de `setInterval`: un temporizador imperativo
     * sobrevive a la navegación si alguien olvida limpiarlo, y en una consola
     * cross-tenant eso significa seguir interrogando a la DIAN por el
     * contribuyente que el operador ya cerró.
     *
     * `exhaustMap` descarta los ticks que caen mientras una consulta sigue en
     * vuelo; `catchError` local impide que un 500 mate el flujo para siempre.
     */
    timer(POLL_INTERVAL_MS, POLL_INTERVAL_MS)
      .pipe(
        filter(() => this.documentVisible() && this.polling()),
        exhaustMap(() => this.pollOnce()),
        takeUntilDestroyed(),
      )
      .subscribe();

    // Los efectos de cambiar de configuración cuelgan del control, no de los
    // manejadores del template: así valen igual para una selección del usuario
    // y para la que hace `reload()` al llegar la lista.
    this.configControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.onConfigSelected(this.toId(value)));

    this.reload();
  }

  // ── Carga ────────────────────────────────────────────────────────────
  protected reload(): void {
    this.refreshing.set(true);

    this.api
      .getDianConfigs()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          const rows = this.unwrapArray<DianConfig>(response);
          this.configs.set(rows);
          this.refreshing.set(false);

          const current = this.selectedConfigId();
          const stillThere = rows.some((row) => row.id === current);
          const next = stillThere
            ? current
            : (rows.find((row) => row.is_default)?.id ?? rows[0]?.id ?? null);
          this.selectConfig(next);
        },
        error: (err: unknown) => {
          this.refreshing.set(false);
          this.configs.set([]);
          this.toast.error(
            extractApiErrorMessage(err) ||
              'No se pudieron cargar las configuraciones DIAN del tenant',
          );
        },
      });

    this.api
      .getResolutions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.resolutions.set([...(response?.data ?? [])]);
        },
        error: () => this.resolutions.set([]),
      });

    this.api
      .getDianEmissionStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.emission.set(response?.data ?? null),
        error: () => this.emission.set(null),
      });
  }

  /** Publica la selección en el control; los efectos los dispara su stream. */
  private selectConfig(configId: number | null): void {
    if (configId === this.selectedConfigId()) {
      // Mismo id: el control no emitiría, así que los efectos se aplican a mano
      // (es el caso de un `reload()` que devuelve la misma configuración).
      this.onConfigSelected(configId);
      return;
    }
    this.configControl.setValue(configId);
  }

  private onConfigSelected(configId: number | null): void {
    // Nada de la configuración anterior sobrevive al cambio: un secreto o un
    // veredicto arrastrado describiría al contribuyente equivocado.
    this.certificateFile.set(null);
    this.consumes.set(null);
    this.lastResult.set(null);
    this.composition.set(null);
    this.activeJobId.set(null);

    const config = this.configs().find((row) => row.id === configId) ?? null;
    // Regla del centinela: el formulario pinta `****` cuando hay contraseña
    // guardada, sin mirar qué devolvió la API. El front no confía en que el
    // backend haya enmascarado.
    this.certificatePassword.setValue(
      config?.certificate_password_encrypted ? MASKED_SECRET : '',
    );

    if (configId === null) return;

    this.loadTestResults(configId);
    this.resumeActiveJob(configId);
  }

  private loadTestResults(configId: number): void {
    this.api
      .getDianTestResults(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          const payload = this.unwrapObject(response);
          this.lastResult.set(
            (payload?.['last_result'] as DianTestResult) ?? null,
          );
          this.composition.set(
            (payload?.['composition'] as TestSetComposition) ?? null,
          );
          // Preseleccionar la resolución del último envío no es cosmético:
          // elegir otra quema un bloque distinto de consecutivos autorizados.
          const resolutionId = (payload?.['last_result'] as DianTestResult)
            ?.resolution_id;
          if (resolutionId && this.selectedResolutionId() === null) {
            this.resolutionControl.setValue(resolutionId);
          }
        },
        error: () => {
          this.lastResult.set(null);
          this.composition.set(null);
        },
      });
  }

  // ── Sondeo ───────────────────────────────────────────────────────────
  private pollOnce(): Observable<unknown> {
    const configId = this.selectedConfigId();
    if (configId === null) return of(null);

    const jobId = this.activeJobId();
    if (jobId) {
      return this.api.getDianTestSetJob(configId, jobId).pipe(
        tap((response: unknown) => this.applyJobStatus(configId, response)),
        catchError(() => {
          // Un job evicted responde 404 para siempre: soltarlo evita un sondeo
          // eterno, y el veredicto sigue siendo recuperable por ZipKey.
          this.forgetJob(configId);
          return of(null);
        }),
      );
    }

    return this.api.checkDianTestSetStatus(configId).pipe(
      tap((response: unknown) => {
        const payload = this.unwrapObject(response);
        this.lastResult.set((payload as DianTestResult | null) ?? null);
      }),
      catchError(() => of(null)),
    );
  }

  private applyJobStatus(configId: number, response: unknown): void {
    const payload = this.unwrapObject(response);
    const status = payload?.['status'] as string | undefined;
    if (status !== 'completed' && status !== 'failed') return;

    this.forgetJob(configId);

    if (status === 'failed') {
      this.toast.error(
        (payload?.['error'] as string) ||
          'El envío del set de pruebas falló en el worker.',
      );
    } else {
      this.toast.success('El lote llegó a la DIAN. Falta su veredicto.');
    }

    this.loadTestResults(configId);
  }

  /**
   * Reanuda el sondeo de un envío que quedó en vuelo.
   *
   * El `job_id` se guarda en `sessionStorage` porque el backend no lo persiste
   * en la configuración: sin esto, salir de la pestaña durante los ~74 s que
   * tarda el envío dejaría al operador sin ninguna señal de que su lote —que ya
   * quemó consecutivos— sigue vivo.
   */
  private resumeActiveJob(configId: number): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const stored = sessionStorage.getItem(this.jobStorageKey(configId));
      this.activeJobId.set(stored);
    } catch {
      // Modo privado o storage bloqueado: se pierde la reanudación, no el lote.
      this.activeJobId.set(null);
    }
  }

  private rememberJob(configId: number, jobId: string): void {
    this.activeJobId.set(jobId);
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      sessionStorage.setItem(this.jobStorageKey(configId), jobId);
    } catch {
      /* no bloquea el flujo */
    }
  }

  private forgetJob(configId: number): void {
    this.activeJobId.set(null);
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      sessionStorage.removeItem(this.jobStorageKey(configId));
    } catch {
      /* no bloquea el flujo */
    }
  }

  /** La clave lleva el tenant: dos fichas abiertas no se pisan el job. */
  private jobStorageKey(configId: number): string {
    return `vendix.superadmin.dian.job.${this.store.scope}.${this.store.tenantId()}.${configId}`;
  }

  // ── Confirmaciones ───────────────────────────────────────────────────
  protected onCertificateFile(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.certificateFile.set(input?.files?.[0] ?? null);
    // Un archivo nuevo invalida el centinela: la contraseña guardada no lo abre.
    if (this.certificatePassword.value === MASKED_SECRET) {
      this.certificatePassword.setValue('');
    }
  }

  protected askAction(action: RiskyAction): void {
    this.pendingAction.set(action);
  }

  protected confirmTitle(action: RiskyAction): string {
    switch (action) {
      case 'certificate':
        return 'Cargar el certificado digital del tenant';
      case 'run-test-set':
        return 'Ejecutar el set de pruebas de habilitación';
      case 'abandon':
        return 'Descartar el lote enviado';
    }
  }

  protected confirmCta(action: RiskyAction): string {
    switch (action) {
      case 'certificate':
        return 'Subir certificado';
      case 'run-test-set':
        return 'Quemar consecutivos y enviar';
      case 'abandon':
        return 'Descartar lote';
    }
  }

  protected confirmMessage(action: RiskyAction): string {
    const tenant = this.store.tenantName();
    const config = this.selectedConfig();

    switch (action) {
      case 'certificate':
        return (
          `Se cargará la clave privada del certificado .p12 de ${tenant} sobre la configuración ` +
          `«${config?.name ?? ''}» (NIT ${config?.nit ?? '—'}). El backend rechaza el archivo si ` +
          'su NIT no coincide con el de la configuración, pero un certificado válido y equivocado ' +
          'firmaría documentos a nombre de otro contribuyente.'
        );

      case 'run-test-set': {
        const burn = this.projectedBurn();
        const base =
          `El envío construye, firma y transmite el set completo a la DIAN a nombre de ${tenant} ` +
          '(NIT ' +
          (config?.nit ?? '—') +
          '). ';
        if (!burn) {
          return (
            base +
            'Consume un bloque IRRECUPERABLE de consecutivos autorizados de la resolución ' +
            'seleccionada. El backend declara el rango exacto al encolar.'
          );
        }
        return (
          base +
          `Consumirá ${burn.total} consecutivos autorizados (${burn.label}): del ${burn.numberFrom} ` +
          `al ${burn.numberTo}, sobre un rango que llega hasta ${burn.rangeTo}. ` +
          (burn.overflows
            ? 'ATENCIÓN: el bloque EXCEDE el rango autorizado. '
            : '') +
          'Esos números no se recuperan aunque la DIAN rechace el lote. El backend confirma el ' +
          'rango definitivo en su respuesta.'
        );
      }

      case 'abandon':
        return (
          `Se descartará el lote que ${tenant} tiene enviado y sin veredicto, liberando la guarda ` +
          'de reenvío. Los consecutivos que ese lote ya quemó NO se recuperan, y si la DIAN acaba ' +
          'aprobándolo, el veredicto llegará sobre un lote que la plataforma ya dio por perdido.'
        );
    }
  }

  protected runAction(action: RiskyAction): void {
    this.pendingAction.set(null);
    switch (action) {
      case 'certificate':
        this.uploadCertificate();
        return;
      case 'run-test-set':
        this.runTestSet();
        return;
      case 'abandon':
        this.abandonBatch();
        return;
    }
  }

  // ── Acciones ─────────────────────────────────────────────────────────
  private uploadCertificate(): void {
    const configId = this.selectedConfigId();
    const file = this.certificateFile();
    const password = this.certificatePassword.value.trim();
    if (configId === null || !file || !password || password === MASKED_SECRET) {
      return;
    }

    this.uploadingCertificate.set(true);
    this.api
      .uploadDianCertificate(configId, file, password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.uploadingCertificate.set(false);
          this.certificateFile.set(null);
          this.certificatePassword.setValue(MASKED_SECRET);
          this.toast.success('Certificado cargado');
          this.reload();
        },
        error: (err: unknown) => {
          this.uploadingCertificate.set(false);
          this.toast.error(
            extractApiErrorMessage(err) || 'No se pudo cargar el certificado',
          );
        },
      });
  }

  private runTestSet(): void {
    const configId = this.selectedConfigId();
    const resolutionId = this.selectedResolutionId();
    if (configId === null || resolutionId === null) return;

    this.runningTestSet.set(true);
    this.api
      .runDianTestSet(configId, resolutionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          this.runningTestSet.set(false);
          const payload = this.unwrapObject(response);
          // El rango que devuelve el backend es el AUTORITATIVO: la proyección
          // de la confirmación sólo sirvió para que nadie confirme a ciegas.
          this.consumes.set(
            (payload?.['consumes'] as TestSetConsumes) ?? null,
          );

          const jobId = payload?.['job_id'];
          if (typeof jobId === 'string' && jobId) {
            this.rememberJob(configId, jobId);
            this.toast.info(
              'Set de pruebas encolado. El envío tarda alrededor de un minuto.',
            );
          } else {
            this.loadTestResults(configId);
          }
        },
        error: (err: unknown) => {
          this.runningTestSet.set(false);
          this.toast.error(
            extractApiErrorMessage(err) ||
              'No se pudo encolar el set de pruebas',
          );
        },
      });
  }

  private abandonBatch(): void {
    const configId = this.selectedConfigId();
    if (configId === null) return;

    this.abandoning.set(true);
    this.api
      .abandonDianTestSet(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.abandoning.set(false);
          this.forgetJob(configId);
          this.consumes.set(null);
          this.toast.success('Lote descartado. Ya se puede reenviar.');
          this.loadTestResults(configId);
        },
        error: (err: unknown) => {
          this.abandoning.set(false);
          this.toast.error(
            extractApiErrorMessage(err) || 'No se pudo descartar el lote',
          );
        },
      });
  }

  // ── Promoción con NIT tecleado ───────────────────────────────────────
  protected openPromoteGate(): void {
    this.promoteNit.setValue('');
    this.promoteGateOpen.set(true);
  }

  protected closePromoteGate(): void {
    this.promoteGateOpen.set(false);
    this.promoteNit.setValue('');
  }

  protected onPromoteGateClosed(): void {
    this.promoteNit.setValue('');
  }

  protected promoteToProduction(): void {
    const configId = this.selectedConfigId();
    if (configId === null || !this.promoteNitMatches() || this.promoting()) {
      return;
    }

    this.promoting.set(true);
    this.api
      .promoteDianToProduction(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.promoting.set(false);
          this.closePromoteGate();
          this.toast.success('Configuración promovida a producción');
          this.reload();
        },
        error: (err: unknown) => {
          this.promoting.set(false);
          this.toast.error(
            extractApiErrorMessage(err) ||
              'La DIAN o el checklist de producción rechazaron la promoción',
          );
        },
      });
  }

  // ── Utilidades ───────────────────────────────────────────────────────
  /**
   * El rail de super admin REDACTA `certificate_s3_key` y reporta
   * `certificate_present` en su lugar: una clave de objeto no es la clave
   * privada, pero nombra dónde vive. Leer sólo `certificate_s3_key` haría que
   * esta consola dijera «sin cargar» sobre certificados que sí existen.
   */
  protected hasCertificate(config: DianConfig): boolean {
    const present = (config as { certificate_present?: boolean })
      .certificate_present;
    return present ?? Boolean(config.certificate_s3_key);
  }

  /** El CVA puede devolver el valor como string; el id siempre es numérico. */
  private toId(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private unwrapObject(response: unknown): Record<string, unknown> | null {
    if (!response || typeof response !== 'object') return null;
    const envelope = response as Record<string, unknown>;
    const data = envelope['data'];
    if (data && typeof data === 'object') return data as Record<string, unknown>;
    return envelope;
  }

  private unwrapArray<T>(response: unknown): T[] {
    if (Array.isArray(response)) return response as T[];
    if (!response || typeof response !== 'object') return [];
    const data = (response as Record<string, unknown>)['data'];
    return Array.isArray(data) ? (data as T[]) : [];
  }
}
