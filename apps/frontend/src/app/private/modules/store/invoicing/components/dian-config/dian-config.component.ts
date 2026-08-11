import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';

import { DianConfigApiService } from '../../../../../../shared/services/dian';
import { DianConfig } from '../../interfaces/invoice.interface';

import {
  CardComponent,
  StatsComponent,
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
 * Antes esta pantalla listaba filas de `dian_configurations`. Con esa lista, un
 * comerciante que nunca creó la configuración del documento soporte no veía
 * NADA sobre documento soporte: el eje no existía como fila, así que no existía
 * en pantalla, y activarlo requería un `curl` contra producción. Lo mismo con el
 * documento equivalente POS y con la nómina electrónica.
 *
 * Ahora se pintan las CUATRO habilitaciones siempre, vengan configuradas o no,
 * leyendo el agregado `GET {rail}/dian-config/fiscal-readiness`. Un eje sin
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
    StatsComponent,
    ModalComponent,
    DianDocumentTypeCardComponent,
    DianConfigWizardComponent,
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
            [value]="s.total"
            smallText="Documentos que la DIAN habilita por separado"
            iconName="shield"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Habilitadas"
            [value]="s.enabled"
            smallText="Aprobadas por la DIAN"
            iconName="check-circle"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="En producción"
            [value]="s.production"
            smallText="Emitiendo documentos reales"
            iconName="globe"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
            [clickable]="false"
          ></app-stats>
          <app-stats
            title="Sin configurar"
            [value]="s.notStarted"
            smallText="Todavía no emiten electrónicamente"
            iconName="alert-triangle"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
            [clickable]="false"
          ></app-stats>
        }
      </div>

      <div class="mt-4 md:mt-6">
        @if (scopeBlockReason(); as reason) {
          <div
            class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-secondary)]"
          >
            {{ reason }}
          </div>
        }

        @if (loading()) {
          <div class="py-10 text-center text-sm text-[var(--color-text-secondary)]">
            Cargando habilitaciones…
          </div>
        } @else if (loadError(); as message) {
          <app-card>
            <p class="text-sm text-[var(--color-error)]">{{ message }}</p>
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
          </div>
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
        [closeOnBackdrop]="false"
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
      </app-modal>
    </div>
  `,
})
export class DianConfigComponent {
  private readonly api = inject(DianConfigApiService);
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

  // ── State ─────────────────────────────────────────────────
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly axes = signal<FiscalReadinessAxis[]>([]);
  readonly fiscalScope = signal<string | null>(null);

  // Wizard
  readonly isWizardOpen = signal(false);
  readonly selectedConfig = signal<DianConfig | null>(null);
  readonly wizardConfigurationType = signal<DianConfigurationType | null>(null);
  readonly initialStep = signal(0);

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
    return [...axes].sort(
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
