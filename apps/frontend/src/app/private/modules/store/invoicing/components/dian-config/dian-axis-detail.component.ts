import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { map } from 'rxjs';

import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { DianConfigApiService } from '../../../../../../shared/services/dian';
import { DianConfig } from '../../interfaces/invoice.interface';
import {
  createResolutionSuccess,
  updateResolution,
  updateResolutionSuccess,
} from '../../state/actions/invoicing.actions';

import {
  BadgeComponent,
  type BadgeVariant,
} from '../../../../../../shared/components/badge/badge.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ConfirmationModalComponent } from '../../../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import type { DianTechnicalResponseData } from '../../../../../../shared/components/dian-technical-response/dian-technical-response.component';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import {
  DIAN_CONFIGURATION_TYPE_LABELS,
  DIAN_ENABLEMENT_STATUS_LABELS,
  DIAN_ENVIRONMENT_LABELS,
  DianCertificatePanelComponent,
  DianNumberingRangePanelComponent,
  DianResolutionFormComponent,
  DianTestSetPanelComponent,
  requirementsFor,
  resolutionDocumentTypesFor,
  summarizeReadiness,
  warningDetail,
  type DianConfigurationType,
  type FiscalReadinessAxis,
  type FiscalReadinessResolution,
  type FiscalReadinessResponse,
  type ProductionReadinessCheck,
} from '../../../../../../shared/components/dian';

import { DianSetupGuideComponent } from './dian-setup-guide.component';
import { ResolutionCreateComponent } from '../resolutions/resolution-create/resolution-create.component';

const CONFIGURATION_TYPES = Object.keys(
  DIAN_CONFIGURATION_TYPE_LABELS,
) as DianConfigurationType[];

const STATUS_BADGE: Readonly<Record<string, BadgeVariant>> = {
  not_started: 'neutral',
  testing: 'warning',
  test_set_passed: 'info',
  enabled: 'success',
  suspended: 'error',
  expired: 'error',
};

/**
 * Detalle de UNA habilitación DIAN: su certificado, su set de pruebas, su
 * checklist y su numeración.
 *
 * ## Por qué es una ruta y no un panel
 *
 * `app-table` envuelve su cuerpo en `@defer (on viewport)` y el
 * `IntersectionObserver` no dispara bajo un ancestro con `display:none`. Una
 * sub-sección escondida con `[hidden]` se quedaría con el esqueleto para
 * siempre. Además, una ruta propia hace enlazable el estado de un eje concreto:
 * «mira lo que le falta al documento soporte» es una URL.
 *
 * ## Nómina electrónica
 *
 * El eje `payroll` se ve como los demás —tiene certificado, set de pruebas y
 * estado propios— pero NO ofrece «Nueva resolución»: el DSPNE numera con su
 * propio consecutivo `NumNE` y la DIAN no emite Autorización de Numeración para
 * él. Exigirle un rango bloquearía su habilitación de forma permanente. En su
 * lugar se monta el formulario compartido, que detecta el caso y explica por
 * qué no hay nada que registrar.
 */
@Component({
  selector: 'vendix-dian-axis-detail',
  standalone: true,
  imports: [
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    ConfirmationModalComponent,
    IconComponent,
    DianCertificatePanelComponent,
    DianTestSetPanelComponent,
    DianNumberingRangePanelComponent,
    DianResolutionFormComponent,
    DianSetupGuideComponent,
    ResolutionCreateComponent,
  ],
  template: `
    <div class="w-full flex flex-col gap-3 sm:gap-4">
      <!-- Migaja de vuelta. NO es una cabecera: el título y el botón de volver
           del sticky header ya existen, pero ese botón sale del módulo entero
           (/admin/fiscal). Sin este enlace, subir un nivel —del eje a la lista
           de habilitaciones— no tendría camino. Es una línea de texto, no un
           bloque con cuerpo propio. -->
      <button
        type="button"
        class="self-start inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
        (click)="goBack()"
      >
        <app-icon name="chevron-left" [size]="14"></app-icon>
        Habilitaciones
      </button>

      @if (!configurationType()) {
        <app-card>
          <p class="text-sm text-[var(--color-text-secondary)]">
            Esa habilitación no existe. Vuelve a la lista de habilitaciones DIAN.
          </p>
        </app-card>
      } @else if (loading()) {
        <div class="py-10 text-center text-sm text-[var(--color-text-secondary)]">
          Cargando la habilitación…
        </div>
      } @else if (loadError(); as message) {
        <app-card>
          <p class="text-sm text-[var(--color-error)]">{{ message }}</p>
        </app-card>
      } @else {
        <!-- Identidad del eje + requisitos. Van juntos porque el título sin el
             estado no dice nada: lo que el comerciante viene a mirar es si este
             documento ya emite o qué le falta. -->
        <app-card>
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <h1
                class="text-base sm:text-lg font-semibold text-[var(--color-text-primary)] leading-tight"
              >
                {{ axisLabel() }}
              </h1>
              <div class="flex flex-wrap items-center gap-1.5">
                <app-badge [variant]="statusVariant()" size="xs">
                  {{ statusLabel() }}
                </app-badge>
                @if (environmentLabel(); as env) {
                  <app-badge
                    [variant]="isProduction() ? 'success' : 'warning'"
                    badgeStyle="outline"
                    size="xs"
                  >
                    {{ env }}
                  </app-badge>
                }
              </div>
            </div>

            @if (summary().notEvaluated) {
              <p class="text-xs text-[var(--color-text-secondary)]">
                Esta habilitación todavía no está configurada. Mientras no lo
                esté, sus documentos se siguen entregando en el formato no
                electrónico de la tienda.
              </p>
            } @else {
              <!-- Barra de avance: el conteo solo obliga a comparar dos números
                   mentalmente en cada visita. -->
              <div class="flex flex-col gap-1.5">
                <div class="flex items-baseline justify-between gap-2">
                  <span
                    class="text-xs font-medium text-[var(--color-text-primary)]"
                  >
                    Requisitos para emitir
                  </span>
                  <span class="text-xs tabular-nums text-[var(--color-text-secondary)]">
                    {{ summary().satisfiedCount }}/{{ summary().totalCount }}
                  </span>
                </div>
                <div
                  class="h-1.5 w-full rounded-full bg-[var(--color-border)] overflow-hidden"
                  role="progressbar"
                  [attr.aria-valuenow]="summary().satisfiedCount"
                  [attr.aria-valuemin]="0"
                  [attr.aria-valuemax]="summary().totalCount"
                  [attr.aria-label]="'Requisitos cumplidos de ' + axisLabel()"
                >
                  <div
                    class="h-full rounded-full transition-[width] duration-300"
                    [class]="
                      summary().ready
                        ? 'bg-[var(--color-success)]'
                        : 'bg-[var(--color-warning)]'
                    "
                    [style.width.%]="progressPercent()"
                  ></div>
                </div>
              </div>

              @if (summary().todo.length) {
                <div
                  class="rounded-lg border border-[var(--color-warning)]/30 bg-warning-light p-3 flex flex-col gap-2"
                >
                  <p
                    class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
                  >
                    Lo que falta hacer
                  </p>
                  @for (check of summary().todo; track check.key) {
                    <div class="flex items-start gap-2 text-xs leading-relaxed">
                      <app-icon
                        name="alert-triangle"
                        [size]="13"
                        class="text-[var(--color-warning)] shrink-0 mt-0.5"
                      ></app-icon>
                      <span class="min-w-0">
                        <span class="text-[var(--color-text-primary)]">{{
                          check.label
                        }}</span>
                        @if (check.action) {
                          <span class="text-[var(--color-text-secondary)]">
                            — {{ check.action }}</span
                          >
                        }
                        @if (check.owner === 'platform') {
                          <span class="text-[var(--color-text-secondary)] italic">
                            (lo resuelve Vendix)</span
                          >
                        }
                      </span>
                    </div>
                  }
                </div>
              }

              <!-- ESPERA: no es tarea. Sin verbo imperativo y sin botón. Por eso
                   tampoco lleva el tinte de aviso: no hay nada que hacer. -->
              @if (summary().waiting.length) {
                <div
                  class="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 flex flex-col gap-2"
                >
                  <p
                    class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
                  >
                    Esperando a la DIAN
                  </p>
                  @for (check of summary().waiting; track check.key) {
                    <div
                      class="flex items-start gap-2 text-xs leading-relaxed text-[var(--color-text-secondary)]"
                    >
                      <app-icon
                        name="hourglass"
                        [size]="13"
                        class="shrink-0 mt-0.5"
                      ></app-icon>
                      <span class="min-w-0">{{ check.label }}</span>
                    </div>
                  }
                  <p class="text-[11px] text-[var(--color-text-secondary)] pl-[21px]">
                    Nuestra parte está hecha. No hay nada que reenviar: repetir el
                    envío consume un bloque nuevo de consecutivos autorizados que
                    no se recupera.
                  </p>
                </div>
              }

              <!-- AVISOS: nunca bloquean nada -->
              @if (summary().warnings.length) {
                <div class="flex flex-col gap-2">
                  <p
                    class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
                  >
                    Avisos — no bloquean la emisión
                  </p>
                  @for (check of summary().warnings; track check.key) {
                    <div class="flex items-start gap-2 text-xs leading-relaxed">
                      <app-icon
                        name="clock"
                        [size]="13"
                        class="text-[var(--color-warning)] shrink-0 mt-0.5"
                      ></app-icon>
                      <span class="min-w-0 text-[var(--color-text-secondary)]">
                        {{ check.label }}
                        @if (detailOf(check); as detail) {
                          <span class="font-medium">· {{ detail }}</span>
                        }
                      </span>
                    </div>
                  }
                </div>
              }

              <!-- Paso a producción: sólo cuando el backend dice que está listo.
                   Un aviso pendiente NO lo bloquea; un bloqueante sí. -->
              @if (canPromote()) {
                <div
                  class="flex flex-col gap-1.5 pt-3 border-t border-[var(--color-border)]"
                >
                  <app-button
                    size="sm"
                    variant="primary"
                    customClasses="w-full sm:w-auto"
                    [loading]="promoting()"
                    (clicked)="promoteConfirmVisible.set(true)"
                  >
                    <app-icon slot="icon" name="power" [size]="14"></app-icon>
                    Activar producción
                  </app-button>
                  <p class="text-[11px] text-[var(--color-text-secondary)]">
                    A partir de ese momento los documentos de esta habilitación
                    salen a la DIAN como documentos reales.
                  </p>
                </div>
              }
            }
          </div>
        </app-card>

        @if (configId(); as id) {
          <!-- Certificado -->
          <app-dian-certificate-panel
            [certificate]="certificateState()"
            [configId]="id"
            [expectedNit]="config()?.nit ?? null"
            (uploaded)="reload()"
          ></app-dian-certificate-panel>

          <!-- Set de pruebas -->
          <app-dian-test-set-panel
            [configId]="id"
            [enablementStatus]="axis()?.enablement_status ?? null"
            [resolutions]="resolutions()"
            [lastResult]="lastTestResult()"
            (changed)="reload()"
          ></app-dian-test-set-panel>

          <!--
            Numeración registrada en la DIAN.

            Va JUSTO ANTES de la tarjeta «Numeración del eje», que lista lo que
            tenemos guardado: primero lo que la DIAN dice, después lo nuestro.
            El orden importa — la pregunta que trae aquí al comerciante es «¿lo
            que guardé coincide con lo autorizado?», y sólo se puede responder
            leyendo la fuente antes que la copia.
          -->
          <app-dian-numbering-range-panel
            [configId]="id"
            (changed)="reload()"
          ></app-dian-numbering-range-panel>

          <!--
            Guía de habilitación: el orden REAL de los pasos, escrito.

            Va aquí, pegada a la numeración, y no arriba del todo, porque es
            exactamente donde el comerciante se cree bloqueado: llega a mirar sus
            rangos, no ve ninguno y concluye que le falta la resolución. Con los
            pasos invertidos ese callejón empuja al rodeo que ya ocurrió en
            producción — inventar una resolución falsa para poder promover, y
            recién desde producción poder consultar los rangos reales. La guía
            responde en el mismo sitio donde nace la duda: la resolución va
            DESPUÉS de aprobar el set y DESPUÉS de asociar el prefijo al software
            en el portal MUISCA.

            Recibe el eje, no el tenant: «config» es la configuración de ESTA
            habilitación y «resolutions» sus rangos, los mismos que lista la
            tarjeta de abajo. Pasarle otra cosa haría que la guía hablara de una
            habilitación distinta de la que se está mirando.
            (Sin backticks: este comentario vive dentro del template literal del
            componente y un backtick lo corta.)
          -->
          <vendix-dian-setup-guide
            [config]="config()"
            [resolutions]="resolutions()"
          ></vendix-dian-setup-guide>
        }

        <!-- Numeración del eje -->
        <app-card>
          <div class="flex flex-col gap-3">
            <div
              class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <h2 class="text-sm font-semibold text-[var(--color-text-primary)]">
                Numeración
              </h2>
              @if (acceptsResolutions() && configId()) {
                <app-button
                  size="sm"
                  variant="outline"
                  customClasses="w-full sm:w-auto"
                  (clicked)="openCreate()"
                >
                  <app-icon slot="icon" name="plus" [size]="14"></app-icon>
                  Nueva resolución
                </app-button>
              }
            </div>

            @if (!acceptsResolutions()) {
              <!-- El formulario compartido detecta el caso y explica por qué la
                   nómina no lleva resolución. Se monta él y no un texto local
                   para que la explicación tenga UN solo dueño. -->
              <app-dian-resolution-form
                [configurationType]="'payroll'"
              ></app-dian-resolution-form>
            } @else if (!resolutions().length) {
              <p class="text-xs text-[var(--color-text-secondary)]">
                Esta habilitación todavía no tiene ningún rango registrado. Sin
                rango no se puede numerar ni enviar el set de pruebas.
              </p>
            } @else {
              <div class="flex flex-col gap-2">
                @for (resolution of resolutions(); track resolution.id) {
                  <div
                    class="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div class="min-w-0 flex flex-col gap-1.5">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span
                          class="text-sm font-semibold tabular-nums text-[var(--color-text-primary)]"
                        >
                          {{ resolution.prefix }}{{ resolution.range_from }}–{{
                            resolution.range_to
                          }}
                        </span>
                        <app-badge
                          [variant]="resolution.is_active ? 'success' : 'neutral'"
                          size="xs"
                        >
                          {{ resolution.is_active ? 'Activa' : 'Inactiva' }}
                        </app-badge>
                        <app-badge variant="neutral" badgeStyle="outline" size="xs">
                          {{ documentLabel(resolution) }}
                        </app-badge>
                      </div>
                      <p
                        class="text-[11px] leading-relaxed text-[var(--color-text-secondary)]"
                      >
                        Va por {{ resolution.current_number }} · vigente hasta
                        {{ validTo(resolution) }}
                        @if (resolution.resolution_number) {
                          · resolución {{ resolution.resolution_number }}
                        }
                      </p>
                    </div>
                    <!-- En móvil los dos botones reparten el ancho; en desktop
                         vuelven a su tamaño natural. Con la variante ghost se
                         leían como texto suelto y no como las acciones que son.
                         (Sin backticks: este comentario vive dentro del template
                         literal del componente y un backtick lo corta.) -->
                    <div class="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                      <app-button
                        size="sm"
                        variant="outline"
                        customClasses="w-full sm:w-auto"
                        (clicked)="openEdit(resolution)"
                      >
                        <app-icon slot="icon" name="edit" [size]="14"></app-icon>
                        Editar
                      </app-button>
                      <app-button
                        size="sm"
                        [variant]="resolution.is_active ? 'outline-danger' : 'outline'"
                        customClasses="w-full sm:w-auto"
                        (clicked)="pendingToggle.set(resolution)"
                      >
                        <app-icon
                          slot="icon"
                          [name]="resolution.is_active ? 'toggle-left' : 'toggle-right'"
                          [size]="14"
                        ></app-icon>
                        {{ resolution.is_active ? 'Desactivar' : 'Activar' }}
                      </app-button>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        </app-card>
      }

      <!-- Alta / edicion de resolucion. No se escucha el output "saved": la
           recarga la dispara el par de acciones NgRx, y hacer las dos cosas
           pediria el agregado dos veces por cada guardado.
           (Sin backticks: este comentario vive dentro del template literal del
           componente y un backtick lo corta.) -->
      <vendix-resolution-create
        [(isOpen)]="isResolutionModalOpen"
        [resolution]="selectedResolution()"
        [configurationType]="configurationType() ?? 'invoicing'"
      ></vendix-resolution-create>

      @if (pendingToggle(); as row) {
        <app-confirmation-modal
          [isOpen]="true"
          [title]="row.is_active ? 'Desactivar resolución' : 'Activar resolución'"
          [message]="toggleMessage(row)"
          [confirmText]="row.is_active ? 'Desactivar' : 'Activar'"
          cancelText="Cancelar"
          [confirmVariant]="row.is_active ? 'danger' : 'primary'"
          (confirm)="confirmToggle(row)"
          (cancel)="pendingToggle.set(null)"
        ></app-confirmation-modal>
      }

      @if (promoteConfirmVisible()) {
        <app-confirmation-modal
          [isOpen]="true"
          title="Activar producción"
          [message]="promoteMessage()"
          confirmText="Activar producción"
          cancelText="Cancelar"
          confirmVariant="primary"
          (confirm)="promote()"
          (cancel)="promoteConfirmVisible.set(false)"
        ></app-confirmation-modal>
      }
    </div>
  `,
})
export class DianAxisDetailComponent {
  private readonly api = inject(DianConfigApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);

  /**
   * El eje viene del path. Se lee por `paramMap` y no del snapshot para que
   * navegar de un eje a otro sin salir de la ruta recargue de verdad: Angular
   * reutiliza el componente y el snapshot se quedaría en el primero.
   */
  private readonly paramType = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('configurationType'))),
    { initialValue: this.route.snapshot.paramMap.get('configurationType') },
  );

  readonly configurationType = computed<DianConfigurationType | null>(() => {
    const raw = this.paramType();
    return CONFIGURATION_TYPES.find((type) => type === raw) ?? null;
  });

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly axis = signal<FiscalReadinessAxis | null>(null);
  readonly config = signal<DianConfig | null>(null);
  readonly lastTestResult = signal<DianTechnicalResponseData | null>(null);
  readonly promoting = signal(false);
  readonly promoteConfirmVisible = signal(false);

  readonly isResolutionModalOpen = signal(false);
  readonly selectedResolution = signal<FiscalReadinessResolution | null>(null);
  readonly pendingToggle = signal<FiscalReadinessResolution | null>(null);

  readonly axisLabel = computed(() => {
    const type = this.configurationType();
    if (!type) return 'Habilitación DIAN';
    return this.axis()?.label ?? DIAN_CONFIGURATION_TYPE_LABELS[type];
  });

  readonly configId = computed(() => this.axis()?.config_id ?? null);

  readonly summary = computed(() => summarizeReadiness(this.axis()?.readiness));

  /**
   * Avance del checklist en porcentaje. Se calcula aquí y no en el template
   * porque una división por cero en Angular imprime `NaN` como ancho y la barra
   * desaparece sin decir por qué.
   */
  readonly progressPercent = computed(() => {
    const { satisfiedCount, totalCount } = this.summary();
    if (!totalCount) return 0;
    return Math.round((satisfiedCount / totalCount) * 100);
  });

  readonly resolutions = computed<FiscalReadinessResolution[]>(
    () => this.axis()?.resolutions ?? [],
  );

  /**
   * ¿Este eje registra resoluciones? La nómina electrónica no: su consecutivo
   * `NumNE` lo lleva el propio DSPNE.
   */
  readonly acceptsResolutions = computed(() => {
    const type = this.configurationType();
    if (!type) return false;
    return resolutionDocumentTypesFor(type).length > 0;
  });

  readonly statusLabel = computed(() => {
    const status = this.axis()?.enablement_status ?? 'not_started';
    return DIAN_ENABLEMENT_STATUS_LABELS[status] ?? status;
  });

  readonly statusVariant = computed<BadgeVariant>(
    () => STATUS_BADGE[this.axis()?.enablement_status ?? 'not_started'] ?? 'neutral',
  );

  readonly environmentLabel = computed(() => {
    const environment = this.axis()?.environment;
    if (!environment) return null;
    return DIAN_ENVIRONMENT_LABELS[environment] ?? environment;
  });

  readonly isProduction = computed(() => this.axis()?.environment === 'production');

  /**
   * Estado del certificado tal como lo entiende el panel compartido.
   *
   * Se pasa la fila de configuración completa: sus campos de certificado son un
   * superconjunto de `DianCertificateState`, y recortarla a mano dejaría fuera
   * los que el panel usa para decir a qué NIT pertenece el `.p12` y quién
   * custodia la llave privada.
   */
  readonly certificateState = computed(() => this.config());

  /**
   * Producción sólo cuando el backend declara el eje listo. `ready` ya excluye
   * los avisos: un `severity: 'warning'` no bloquea nada, aquí tampoco.
   */
  readonly canPromote = computed(
    () =>
      this.configId() !== null &&
      this.summary().ready &&
      this.axis()?.environment !== 'production',
  );

  constructor() {
    // Recarga al cambiar de eje por URL.
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload());

    // Guardar una resolución cambia el checklist del eje (rango vigente, rango
    // activo). El agregado se vuelve a pedir para que la pantalla no siga
    // afirmando lo que era cierto hace un clic.
    this.actions$
      .pipe(
        ofType(createResolutionSuccess, updateResolutionSuccess),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.reload());

    // El rechazo del backend NO se vuelve a anunciar aquí: `InvoicingEffects`
    // ya emite el toast con el mensaje del backend en `updateResolutionFailure`.
    // Duplicarlo mostraría dos veces el mismo error y dejaría al usuario
    // creyendo que falló dos veces.
  }

  reload(): void {
    const type = this.configurationType();
    if (!type) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.api
      .getFiscalReadiness()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const payload: FiscalReadinessResponse | null =
            response?.data ?? response ?? null;
          const axis =
            payload?.axes?.find(
              (candidate) => candidate.configuration_type === type,
            ) ?? null;
          this.axis.set(axis);
          this.loadError.set(null);
          this.loading.set(false);

          const configId = axis?.config_id ?? null;
          if (configId === null) {
            this.config.set(null);
            this.lastTestResult.set(null);
            return;
          }
          this.loadConfig(configId);
          this.loadTestResults(configId);
        },
        error: (err: any) => {
          this.axis.set(null);
          this.loadError.set(
            extractApiErrorMessage(err) ||
              'No se pudo leer el estado de esta habilitación.',
          );
          this.loading.set(false);
        },
      });
  }

  private loadConfig(configId: number): void {
    this.api
      .getDianConfigById(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.config.set(response?.data ?? response ?? null);
        },
        error: () => this.config.set(null),
      });
  }

  /**
   * Último veredicto conocido del set de pruebas. Se carga aquí y no dentro del
   * panel para que abrir la pantalla no borre de la vista el diagnóstico del
   * envío anterior.
   */
  private loadTestResults(configId: number): void {
    this.api
      .getDianTestResults(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.lastTestResult.set(response?.data ?? null);
        },
        error: () => this.lastTestResult.set(null),
      });
  }

  goBack(): void {
    void this.router.navigate(['..'], { relativeTo: this.route });
  }

  openCreate(): void {
    this.selectedResolution.set(null);
    this.isResolutionModalOpen.set(true);
  }

  openEdit(resolution: FiscalReadinessResolution): void {
    this.selectedResolution.set(resolution);
    this.isResolutionModalOpen.set(true);
  }

  /**
   * Sólo viaja `is_active`. Mandar el resto haría que el backend comparase
   * campos inmutables de una resolución que ya consumió numeración y rechazara
   * el PATCH entero.
   *
   * Va por NgRx y no por el servicio directo para que la lista de la pestaña
   * «Resoluciones» —que vive del mismo estado— no siga mostrando activa una
   * resolución que se acaba de retirar aquí.
   */
  confirmToggle(resolution: FiscalReadinessResolution): void {
    this.pendingToggle.set(null);
    this.store.dispatch(
      updateResolution({
        id: resolution.id,
        resolution: { is_active: !resolution.is_active },
      }),
    );
  }

  toggleMessage(resolution: FiscalReadinessResolution): string {
    const identity = `${resolution.prefix ?? ''}${resolution.range_from}–${resolution.range_to}`;
    if (!resolution.is_active) {
      return `${identity} volverá a numerar ${documentLabelOf(resolution)} desde el consecutivo ${resolution.current_number + 1}. Sólo debe haber una resolución activa por tipo de documento.`;
    }
    return `${identity} dejará de numerar ${documentLabelOf(resolution)}. Los documentos ya emitidos con ella no cambian. Es la única forma de retirarla: una resolución que ya consumió numeración ante la DIAN no se puede borrar.`;
  }

  promoteMessage(): string {
    return `${this.axisLabel()} pasará a producción: sus documentos saldrán a la DIAN como documentos reales, con consecutivos que no se recuperan. El backend vuelve a verificar cada requisito antes de aceptarlo.`;
  }

  promote(): void {
    this.promoteConfirmVisible.set(false);
    const configId = this.configId();
    if (configId === null) return;

    this.promoting.set(true);
    this.api
      .promoteDianToProduction(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.promoting.set(false);
          this.toast.success(
            `${this.axisLabel()} activada en producción. Ya emite documentos reales.`,
          );
          this.reload();
        },
        error: (err: any) => {
          this.promoting.set(false);
          this.toast.error(
            extractApiErrorMessage(err) ||
              'No se pudo pasar a producción: revisa los requisitos pendientes.',
          );
          // El checklist se recarga para que el motivo quede en pantalla y no
          // sólo en un toast que se va.
          this.reload();
        },
      });
  }

  documentLabel(resolution: FiscalReadinessResolution): string {
    return documentLabelOf(resolution);
  }

  validTo(resolution: FiscalReadinessResolution): string {
    return resolution.valid_to ? formatDateOnlyUTC(resolution.valid_to) : '-';
  }

  detailOf(check: ProductionReadinessCheck): string | null {
    return warningDetail(check);
  }
}

/** Rótulo del documento que numera la fila, tomado del contrato compartido. */
function documentLabelOf(resolution: FiscalReadinessResolution): string {
  return requirementsFor(resolution.document_type).label;
}
