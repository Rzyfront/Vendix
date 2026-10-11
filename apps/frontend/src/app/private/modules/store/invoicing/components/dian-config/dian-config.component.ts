import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';

import { DianConfigApiService } from '../../../../../../shared/services/dian';
import { DianConfig } from '../../interfaces/invoice.interface';

import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  StatsComponent,
  TooltipComponent,
} from '../../../../../../shared/components/index';
import {
  DIAN_CONFIGURATION_TYPES,
  DianDocumentTypeCardComponent,
  summarizeReadiness,
  type DianConfigurationType,
  type FiscalReadinessAxis,
  type FiscalReadinessResponse,
} from '../../../../../../shared/components/dian';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { DianConfigWizardComponent } from './dian-config-wizard.component';
import { ReceivedDocumentsConfigurationWizardComponent } from '../../received-documents/received-documents-configuration-wizard.component';

interface AxisStats {
  total: number;
  enabled: number;
  production: number;
  notStarted: number;
}

/**
 * Consola DIAN del comerciante, POR EJE DE HABILITACIÓN.
 *
 * ## Qué cambió y por qué
 *
 * Antes esta pantalla listaba filas de `dian_configurations`, lo que ocultaba
 * ejes sin configuración. El agregado hace visibles los tres ejes DIAN incluidos
 * aquí; recepción manual se ofrece aparte y no se presenta como habilitación DIAN.
 *
 * Se pintan los tres ejes electrónicos que gestiona esta pantalla, vengan
 * configurados o no, leyendo el agregado `GET {rail}/dian-config/fiscal-readiness`.
 * La recepción manual tiene una tarjeta propia y no es un eje DIAN. Un eje sin
 * configuración se declara `not_started` y ofrece «Configurar»; uno configurado
 * muestra su estado y su checklist.
 *
 * ## La regla que gobierna el checklist
 *
 * La tarjeta compartida parte el informe en tres registros con
 * `summarizeReadiness` y NUNCA presenta `waiting_on_dian` como tarea. Pedirle
 * acción a un comerciante sobre algo que espera a la DIAN es lo que hace que
 * reenvíe un set de pruebas en revisión y queme un segundo bloque de
 * consecutivos autorizados, que no se recuperan.
 */
@Component({
  selector: 'vendix-dian-config',
  standalone: true,
  imports: [
    CardComponent,
    ButtonComponent,
    IconComponent,
    StatsComponent,
    TooltipComponent,
    ModalComponent,
    DianDocumentTypeCardComponent,
    DianConfigWizardComponent,
    ReceivedDocumentsConfigurationWizardComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        @if (stats(); as s) {
          <app-stats
            title="Habilitaciones"
            [value]="loadError() ? '—' : s.total"
            [loading]="loading()"
            smallText="Documentos que la DIAN habilita por separado"
            iconName="shield"
            iconBgColor="bg-primary/10"
            iconColor="text-primary"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Habilitadas"
            [value]="loadError() ? '—' : s.enabled"
            [loading]="loading()"
            smallText="Aprobadas por la DIAN"
            iconName="check-circle"
            iconBgColor="bg-success/10"
            iconColor="text-success"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="En producción"
            [value]="loadError() ? '—' : s.production"
            [loading]="loading()"
            smallText="Emitiendo documentos reales"
            iconName="globe"
            iconBgColor="bg-info/10"
            iconColor="text-info"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Sin configurar"
            [value]="loadError() ? '—' : s.notStarted"
            [loading]="loading()"
            smallText="Todavía no emiten electrónicamente"
            iconName="alert-triangle"
            iconBgColor="bg-warning/10"
            iconColor="text-warning"
            [clickable]="false"
          ></app-stats>
        }
      </div>

      <div class="mt-4 md:mt-6">
        @if (scopeBlockReason(); as reason) {
          <div
            class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-primary)]"
          >
            {{ reason }}
          </div>
        }

        @if (loading()) {
          <div class="py-10 text-center text-sm text-[var(--color-text-primary)]">
            Cargando habilitaciones…
          </div>
        } @else if (loadError(); as message) {
          <app-card>
            <p class="text-sm text-text-primary">{{ message }}</p>
          </app-card>
        } @else {
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            @for (axis of axes(); track axis.configuration_type) {
              <app-dian-document-type-card
                [axis]="axis"
                [busy]="loading()"
                [writeBlockedReason]="writeBlockedReason()"
                (configure)="onConfigure($event)"
                (viewDetail)="onViewDetail($event)"
              ></app-dian-document-type-card>
            }
            @if (!isSuperAdmin() && fiscalScope() === 'ORGANIZATION') {
              <app-card [responsive]="true" [fullHeight]="true">
              <div class="flex items-start gap-3">
                <span class="rounded-lg bg-primary/10 p-2 text-primary" aria-hidden="true"><app-icon name="inbox" [size]="18" /></span>
                <div>
                  <h2 class="text-base font-semibold text-text-primary">Recepción de documentos</h2>
                  <p class="mt-1 text-sm text-text-primary">La entidad fiscal es de la organización. La recepción de esta tienda se administra allí; este panel conserva el alcance fiscal actual y no cambia su configuración.</p>
                </div>
              </div>
              </app-card>
            } @else if (!isSuperAdmin() && canReadReception()) {
              <app-card [responsive]="true" [responsivePadding]="true" [fullHeight]="true" overflow="visible">
              <div class="flex h-full flex-col gap-3">
                <div class="flex min-w-0 items-start gap-3">
                  <span class="rounded-lg bg-primary/10 p-2 text-primary" aria-hidden="true"><app-icon name="inbox" [size]="20" /></span>
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <h2 class="text-base font-semibold text-text-primary">Recepción de documentos</h2>
                      <app-tooltip content="La bandeja admite importación manual de XML. La conexión directa con DIAN no está implementada; la revisión y conciliación siguen siendo pasos operativos.">
                        <button type="button" class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-text-primary hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-text-primary)]" aria-label="Ayuda sobre recepción de documentos"><app-icon name="info" [size]="16" /></button>
                      </app-tooltip>
                    </div>
                  </div>
                </div>
                <p class="text-sm text-text-primary">Importa XML manualmente, consulta el estado del comprador y revisa los documentos recibidos.</p>
                <div class="mt-auto pt-2">
                <app-button variant="primary" size="md" customClasses="h-11 min-h-11 w-full sm:w-auto" [disabled]="!canConfigureReception()" (clicked)="openReception()">
                    <span slot="icon"><app-icon name="settings" [size]="16" /></span>
                    Configurar
                  </app-button>
                </div>
              </div>
              @if (readOnly()) {
                <p class="mt-3 text-xs text-text-primary" role="note">Modo consulta: la configuración no está disponible para escritura.</p>
              } @else if (!receptionScopeReady()) {
                <p class="mt-3 text-xs text-text-primary" role="note">La configuración de recepción requiere una entidad fiscal de tienda.</p>
              } @else if (!canConfigureReception()) {
                <p class="mt-3 text-xs text-text-primary" role="note">Tu perfil no tiene permiso para configurar esta entidad fiscal.</p>
              }
              </app-card>
            }
          </div>
        }

        @if (!isSuperAdmin() && fiscalScope() !== 'ORGANIZATION' && canReadReception() && receptionOpen()) {
          <app-received-documents-configuration-wizard
            [(isOpen)]="receptionOpen"
            scope="store"
            [scopeReady]="receptionScopeReady()"
            [readOnly]="readOnly()"
          />
        }
      </div>

      <!-- Wizard Modal.
           Va dentro de un bloque condicional: montado permanentemente sondeaba a
           la DIAN con el modal cerrado y conservaba el borrador de credenciales
           del eje anterior. Envolverlo fuerza su reconstrucción, que es lo único
           que garantiza que no arrastre estado entre ejes ni entre tenants
           cuando el super admin salta de tienda —el injector de la ruta se
           cachea y NO se destruye—. -->
      <app-modal
        [(isOpen)]="isWizardOpen"
        [title]="wizardTitle()"
        [subtitle]="wizardSubtitle()"
        size="lg"
        [dialog]="true"
        [closeOnBackdrop]="false"
        [canClose]="canCloseWizard"
        (cancel)="onWizardCancelled()"
      >
        @if (isWizardOpen()) {
          <vendix-dian-config-wizard
            [initialConfig]="selectedConfig()"
            [initialStep]="initialStep()"
            [configurationType]="wizardConfigurationType()"
            [takenConfigurationTypes]="takenConfigurationTypes()"
            (saved)="onWizardSaved($event)"
            (cancelled)="onWizardCancelled()"
          ></vendix-dian-config-wizard>
        }
        <div slot="footer" class="flex justify-end">
          <app-button customClasses="min-h-11" variant="outline" [disabled]="!canCloseWizard()" (clicked)="onWizardCancelled()">
            Cerrar
          </app-button>
        </div>
      </app-modal>
    </div>
  `,
})
export class DianConfigComponent {
  private readonly api = inject(DianConfigApiService);
  private readonly auth = inject(AuthFacade);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /**
   * Consulta sin escritura: no se ofrece configurar ni ajustar, y con ello se
   * cierra el único camino que abre el asistente.
   *
   * Lo usa la consola de super admin cuando el perfil del tenant no declara la
   * capacidad de escritura DIAN. **No es una autorización**: la decide el
   * backend. Aquí sólo se deja de OFRECER lo que no se declaró.
   */
  readonly readOnly = input(false);
  readonly receptionOpen = signal(false);
  readonly isSuperAdmin = computed(() => {
    const roles = this.auth.userRoles();
    return roles.includes('super_admin') || roles.includes('SUPER_ADMIN');
  });
  readonly canReadReception = computed(() => this.auth.hasPermission('invoicing:received:read'));
  readonly canConfigureReception = computed(() =>
    !this.isSuperAdmin() && this.receptionScopeReady() && !this.readOnly() && this.auth.hasPermission('invoicing:write'),
  );

  // ── State ─────────────────────────────────────────────────
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly axes = signal<FiscalReadinessAxis[]>([]);
  readonly fiscalScope = signal<string | null>(null);
  readonly receptionScopeReady = computed(() => this.fiscalScope() === 'STORE');

  // Wizard
  readonly isWizardOpen = signal(false);
  readonly selectedConfig = signal<DianConfig | null>(null);
  readonly wizardConfigurationType = signal<DianConfigurationType | null>(null);
  readonly initialStep = signal(0);
  private readonly dianWizard = viewChild(DianConfigWizardComponent);
  readonly canCloseWizard = (): boolean => !this.dianWizard()?.mutating();

  /**
   * ¿La ruta de esta pantalla tiene detalle por eje?
   *
   * Se declara en la ruta (`data.axisDetailRoute`) y no se asume: este mismo
   * componente lo monta la consola de super admin bajo su propio árbol de rutas,
   * donde `dian-config/:configurationType` no existe. Navegar a ciegas allá
   * sacaría al operador de la ficha del tenant hacia una ruta inexistente.
   */
  private readonly hasAxisDetailRoute =
    this.route.snapshot.data['axisDetailRoute'] === true;

  /**
   * La configuración fiscal cuelga de la organización: el alta desde la tienda
   * la rechaza el backend. Se dice ANTES de ofrecer el botón, porque un botón
   * que responde 403 se lee como un fallo de la aplicación.
   */
  readonly scopeBlockReason = computed<string | null>(() =>
    this.fiscalScope() === 'ORGANIZATION'
      ? 'El NIT fiscal de esta tienda lo lleva la organización: las habilitaciones DIAN se administran desde el panel de la organización, no aquí.'
      : null,
  );

  readonly writeBlockedReason = computed<string | null>(() => {
    const scopeReason = this.scopeBlockReason();
    if (scopeReason) return scopeReason;
    if (this.readOnly()) {
      return 'Estás viendo esta configuración en modo consulta.';
    }
    return null;
  });

  readonly canWrite = computed(() => !this.readOnly() && !this.scopeBlockReason());

  /** Ejes que ya tienen configuración: el asistente no debe volver a crearlos. */
  readonly takenConfigurationTypes = computed<DianConfigurationType[]>(() =>
    this.axes()
      .filter((axis) => axis.config_id !== null)
      .map((axis) => axis.configuration_type),
  );

  readonly stats = computed<AxisStats>(() => {
    const list = this.axes();
    let enabled = 0;
    let production = 0;
    let notStarted = 0;
    for (const axis of list) {
      if (axis.enablement_status === 'enabled') enabled++;
      if (axis.environment === 'production') production++;
      if (axis.config_id === null) notStarted++;
    }
    return { total: list.length, enabled, production, notStarted };
  });

  openReception(): void {
    if (!this.canConfigureReception() || !this.canReadReception()) return;
    this.receptionOpen.set(true);
  }

  readonly wizardTitle = computed(() => {
    const axis = this.axes().find(
      (candidate) => candidate.configuration_type === this.wizardConfigurationType(),
    );
    const label = axis?.label ?? 'DIAN';
    return this.selectedConfig() ? `Ajustar ${label}` : `Configurar ${label}`;
  });

  readonly wizardSubtitle = computed(() =>
    this.selectedConfig()
      ? 'Cada habilitación tiene su propio certificado, set de pruebas y ambiente'
      : 'Cada documento se habilita por separado ante la DIAN',
  );

  constructor() {
    this.loadReadiness();
  }

  // ── Data loading ──────────────────────────────────────────
  loadReadiness(): void {
    this.loading.set(true);
    this.api
      .getFiscalReadiness()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          // El agregado responde un SOBRE `{ fiscal_scope, axes }`, no un array
          // pelado: leerlo como array dejaba las cuatro tarjetas vacías.
          const payload: FiscalReadinessResponse | null =
            response?.data ?? response ?? null;
          this.fiscalScope.set(payload?.fiscal_scope ?? null);
          this.axes.set(this.orderAxes(payload?.axes ?? []));
          this.loadError.set(null);
          this.loading.set(false);
        },
        error: (err: any) => {
          this.axes.set([]);
          this.loadError.set(
            extractApiErrorMessage(err) ||
              'No se pudo leer el estado de las habilitaciones DIAN.',
          );
          this.loading.set(false);
        },
      });
  }

  // ── Card actions ──────────────────────────────────────────

  /**
   * «Configurar» sobre un eje sin configuración abre el asistente en alta con el
   * tipo ya elegido; sobre uno configurado, carga la fila y lo abre en edición.
   */
  onConfigure(axis: FiscalReadinessAxis): void {
    if (!this.canWrite()) {
      const reason = this.writeBlockedReason();
      if (reason) this.toast.error(reason);
      return;
    }

    this.wizardConfigurationType.set(axis.configuration_type);

    if (axis.config_id === null) {
      this.selectedConfig.set(null);
      this.initialStep.set(0);
      this.isWizardOpen.set(true);
      return;
    }

    // El asistente escribe sobre `DianConfig` completo (PIN, certificado,
    // ambiente) y el agregado sólo trae el estado. Se pide la fila antes de
    // abrir para no arrancar con un formulario a medio sembrar.
    this.api
      .getDianConfigById(axis.config_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const config: DianConfig | null = response?.data ?? response ?? null;
          this.selectedConfig.set(config);
          this.initialStep.set(this.nextStepFor(axis, config));
          this.isWizardOpen.set(true);
        },
        error: (err: any) => {
          this.toast.error(
            extractApiErrorMessage(err) ||
              'No se pudo abrir la configuración de esta habilitación.',
          );
        },
      });
  }

  /** El detalle del eje vive en su propia ruta, no en un panel oculto. */
  onViewDetail(axis: FiscalReadinessAxis): void {
    if (!this.hasAxisDetailRoute) {
      // Sin ruta de detalle (consola de super admin), el asistente es la única
      // vista por eje disponible.
      this.onConfigure(axis);
      return;
    }
    void this.router.navigate([axis.configuration_type], {
      relativeTo: this.route,
    });
  }

  // ── Wizard handlers ───────────────────────────────────────
  onWizardSaved(config: DianConfig): void {
    // El asistente sigue abierto para continuar los pasos siguientes; el
    // agregado se recarga por detrás para que las tarjetas reflejen el avance.
    this.selectedConfig.set(config);
    this.loadReadiness();
  }

  onWizardCancelled(): void {
    if (!this.canCloseWizard()) return;
    this.isWizardOpen.set(false);
    this.selectedConfig.set(null);
    this.wizardConfigurationType.set(null);
    this.initialStep.set(0);
    this.loadReadiness();
  }

  // ── Helpers ───────────────────────────────────────────────

  /** Orden estable del enum, para que las tarjetas no bailen entre recargas. */
  private orderAxes(axes: FiscalReadinessAxis[]): FiscalReadinessAxis[] {
    const rank = new Map<string, number>(
      DIAN_CONFIGURATION_TYPES.map((type, index) => [type, index]),
    );
    // El enum `equivalent_document` hoy representa el documento equivalente POS;
    // no se muestra como eje DIAN en esta superficie de recepción.
    return axes.filter((axis) => axis.configuration_type !== 'equivalent_document').sort(
      (a, b) =>
        (rank.get(a.configuration_type) ?? 99) -
        (rank.get(b.configuration_type) ?? 99),
    );
  }

  /**
   * Dónde retomar el asistente. Se deriva del checklist del eje, que es lo que
   * el backend evalúa de verdad, y no de una heurística paralela que pueda
   * decir otra cosa.
   */
  private nextStepFor(
    axis: FiscalReadinessAxis,
    config: DianConfig | null,
  ): number {
    const hasCertificate =
      config?.certificate_present ?? Boolean(config?.certificate_s3_key);
    if (!hasCertificate) return 1;
    if (axis.enablement_status === 'not_started') return 2;
    if (!summarizeReadiness(axis.readiness).ready) return 3;
    return 4;
  }
}
