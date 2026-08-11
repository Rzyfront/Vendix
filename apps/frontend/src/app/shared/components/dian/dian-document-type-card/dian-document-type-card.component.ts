import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';

import { BadgeComponent, type BadgeVariant } from '../../badge/badge.component';
import { ButtonComponent } from '../../button/button.component';
import { CardComponent } from '../../card/card.component';
import { IconComponent } from '../../icon/icon.component';
import { DIAN_API_CONTEXT } from '../../../services/dian';
import {
  DIAN_ENABLEMENT_STATUS_LABELS,
  DIAN_ENVIRONMENT_LABELS,
  type FiscalReadinessAxis,
} from '../fiscal-readiness.interface';
import {
  summarizeReadiness,
  warningDetail,
  type ReadinessSummary,
} from '../readiness-summary.util';

/** Icono representativo de cada habilitación. Todos registrados en `icons.registry.ts`. */
const AXIS_ICONS: Readonly<Record<string, string>> = {
  invoicing: 'file-text',
  support_document: 'file-check',
  payroll: 'users',
  equivalent_document: 'receipt',
};

const STATUS_BADGE: Readonly<Record<string, BadgeVariant>> = {
  not_started: 'neutral',
  testing: 'warning',
  test_set_passed: 'info',
  enabled: 'success',
  suspended: 'error',
  expired: 'error',
};

/**
 * Tarjeta de estado de UN eje de habilitación DIAN.
 *
 * ## Por qué una sola tarjeta para las dos consolas
 *
 * El panel del comerciante y la consola de superadmin muestran exactamente el
 * mismo agregado (`GET {rail}/dian-config/fiscal-readiness`) sobre el mismo
 * checklist. Duplicarla garantizaría que una de las dos se quede atrás: la
 * consola diría «listo» sobre un eje que el panel pinta bloqueado, y quien
 * atiende al comerciante confiaría en la equivocada.
 *
 * Lo único que cambia entre consolas es QUÉ SE PUEDE HACER, y eso se lee de
 * `DIAN_API_CONTEXT.capabilities()`, nunca de en qué pantalla está montada. Una
 * tarjeta que se preguntara «¿soy superadmin?» volvería a atar la autorización
 * a la ruta, que es precisamente lo que el token existe para evitar.
 *
 * ## La regla que gobierna el checklist
 *
 * Los tres registros de `summarizeReadiness` se pintan SEPARADOS y con verbos
 * distintos. `waiting` (bloqueante, `blocked_by: 'dian'`) no lleva acción, no
 * lleva botón y no se cuenta como pendiente del comerciante: son cosas donde ya
 * hicimos nuestra parte. Pedirle acción sobre uno de ellos es lo que hace que
 * reenvíe un set de pruebas en revisión y queme un segundo bloque de
 * consecutivos autorizados, que no se recuperan.
 */
@Component({
  selector: 'app-dian-document-type-card',
  standalone: true,
  imports: [CardComponent, BadgeComponent, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card [fullHeight]="true" [customClasses]="'h-full'">
      <div class="flex flex-col gap-3 h-full">
        <!-- Cabecera: qué eje es y en qué estado está -->
        <div class="flex items-start gap-3">
          <span
            class="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-secondary)]"
          >
            <app-icon [name]="axisIcon()" [size]="18"></app-icon>
          </span>

          <div class="min-w-0 flex-1">
            <h3
              class="text-sm font-semibold text-[var(--color-text-primary)] truncate"
            >
              {{ axis().label }}
            </h3>
            <div class="flex flex-wrap items-center gap-1.5 mt-1">
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
              @if (axis().resolutions.length; as total) {
                <app-badge variant="neutral" badgeStyle="outline" size="xs">
                  {{ total }}
                  {{ total === 1 ? 'resolución' : 'resoluciones' }}
                </app-badge>
              }
            </div>
          </div>
        </div>

        <!-- Checklist resumido -->
        @if (summary().notEvaluated) {
          <p class="text-xs text-[var(--color-text-secondary)]">
            Este eje todavía no tiene configuración DIAN. Mientras no la tenga no
            emite documentos electrónicos, y sus documentos se siguen entregando
            en el formato no electrónico de la tienda.
          </p>
        } @else {
          <div class="flex flex-col gap-2">
            <!-- Progreso -->
            <div
              class="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"
            >
              <app-icon
                [name]="summary().ready ? 'check-circle' : 'list-checks'"
                [size]="14"
                [class]="
                  summary().ready
                    ? 'text-[var(--color-success)] shrink-0'
                    : 'shrink-0'
                "
              ></app-icon>
              @if (summary().ready) {
                <span class="text-[var(--color-success)] font-medium">
                  Listo para emitir en producción
                </span>
              } @else {
                <span>
                  {{ summary().satisfiedCount }} de {{ summary().totalCount }}
                  requisitos cumplidos
                </span>
              }
            </div>

            <!-- ACCIONABLE: esto sí es tarea del comerciante -->
            @if (summary().todo.length) {
              <div class="flex flex-col gap-1">
                <p
                  class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
                >
                  Lo que falta hacer
                </p>
                @for (check of visibleTodo(); track check.key) {
                  <div class="flex items-start gap-2 text-xs">
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
                @if (hiddenTodoCount(); as extra) {
                  <p class="text-[11px] text-[var(--color-text-secondary)] pl-5">
                    y {{ extra }} más
                  </p>
                }
              </div>
            }

            <!-- ESPERA: NO es tarea. Sin acción, sin botón, sin verbo imperativo. -->
            @if (summary().waiting.length) {
              <div class="flex flex-col gap-1">
                <p
                  class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
                >
                  Esperando a la DIAN
                </p>
                @for (check of summary().waiting; track check.key) {
                  <div
                    class="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]"
                  >
                    <app-icon
                      name="hourglass"
                      [size]="13"
                      class="shrink-0 mt-0.5"
                    ></app-icon>
                    <span class="min-w-0">{{ check.label }}</span>
                  </div>
                }
                <p class="text-[11px] text-[var(--color-text-secondary)] pl-5">
                  Nuestra parte está hecha. No hay nada que reenviar: repetir el
                  envío consume un bloque nuevo de consecutivos autorizados que no
                  se recupera.
                </p>
              </div>
            }

            <!-- AVISOS: nunca bloquean -->
            @if (summary().warnings.length) {
              <div class="flex flex-col gap-1">
                <p
                  class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
                >
                  Avisos — no bloquean la emisión
                </p>
                @for (check of summary().warnings; track check.key) {
                  <div class="flex items-start gap-2 text-xs">
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
          </div>
        }

        <!-- Acciones. En móvil se apilan a ancho completo —el pulgar no acierta
             un botón de 90px al borde de la tarjeta—; desde sm vuelven a fila.
             La jerarquía la marca el estado: sin configurar, la acción es
             «Configurar»; ya configurado, lo que se quiere es entrar al detalle,
             y «Ajustar» pasa a segundo plano. -->
        <div
          class="mt-auto pt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
        >
          @if (canWrite()) {
            <app-button
              size="sm"
              [variant]="summary().notEvaluated ? 'primary' : 'outline'"
              customClasses="w-full sm:w-auto"
              [disabled]="busy()"
              (clicked)="configure.emit(axis())"
            >
              <app-icon
                slot="icon"
                [name]="summary().notEvaluated ? 'plus' : 'settings'"
                [size]="14"
              ></app-icon>
              {{ summary().notEvaluated ? 'Configurar' : 'Ajustar' }}
            </app-button>
          } @else if (writeBlockedReason(); as reason) {
            <p
              class="text-[11px] text-[var(--color-text-secondary)] flex items-start gap-1.5"
            >
              <app-icon name="lock" [size]="12" class="shrink-0 mt-0.5"></app-icon>
              <span>{{ reason }}</span>
            </p>
          }

          @if (!summary().notEvaluated) {
            <app-button
              size="sm"
              variant="primary"
              customClasses="w-full sm:w-auto"
              [disabled]="busy()"
              (clicked)="viewDetail.emit(axis())"
            >
              <app-icon slot="icon" name="eye" [size]="14"></app-icon>
              Ver detalle
            </app-button>
          }
        </div>
      </div>
    </app-card>
  `,
})
export class DianDocumentTypeCardComponent {
  /** El eje del agregado, tal cual llega del backend. */
  readonly axis = input.required<FiscalReadinessAxis>();

  /**
   * Deshabilita las acciones mientras el host recarga. No se llama `loading`
   * a propósito: aquí no hay spinner propio, sólo acciones inhibidas.
   */
  readonly busy = input(false);

  /**
   * Cuántos pendientes accionables se listan antes de resumir el resto. El
   * checklist completo puede traer una docena; una tarjeta que los vuelca todos
   * deja de ser un resumen.
   */
  readonly maxTodoShown = input(3);

  /**
   * Por qué no se ofrece configurar, cuando la falta de capacidad tiene una
   * causa que el usuario debe conocer (p. ej. el NIT lo lleva la organización y
   * la configuración cuelga de ella, no de esta tienda).
   *
   * Sin esto, un botón ausente se lee como un fallo de la aplicación.
   */
  readonly writeBlockedReason = input<string | null>(null);

  /** El host decide qué es «configurar»: abrir el wizard, un modal o navegar. */
  readonly configure = output<FiscalReadinessAxis>();
  /** El host decide qué es «ver detalle». */
  readonly viewDetail = output<FiscalReadinessAxis>();

  private readonly dianContext = inject(DIAN_API_CONTEXT);

  /**
   * `computed` y no una lectura suelta: en la consola de superadmin las
   * capacidades se derivan de señales del `TenantContextStore`, así que cambiar
   * de tenant tiene que repintar los botones sin recrear el componente.
   */
  readonly capabilities = computed(() => this.dianContext.capabilities());

  readonly canWrite = computed(() => this.capabilities().writeConfig);

  readonly summary = computed<ReadinessSummary>(() =>
    summarizeReadiness(this.axis().readiness),
  );

  readonly visibleTodo = computed(() =>
    this.summary().todo.slice(0, Math.max(1, this.maxTodoShown())),
  );

  readonly hiddenTodoCount = computed(() =>
    Math.max(0, this.summary().todo.length - this.visibleTodo().length),
  );

  readonly axisIcon = computed(
    () => AXIS_ICONS[this.axis().configuration_type] ?? 'file-text',
  );

  readonly statusVariant = computed<BadgeVariant>(
    () => STATUS_BADGE[this.axis().enablement_status] ?? 'neutral',
  );

  readonly statusLabel = computed(() => {
    const status = this.axis().enablement_status;
    return DIAN_ENABLEMENT_STATUS_LABELS[status] ?? status;
  });

  readonly environmentLabel = computed(() => {
    const environment = this.axis().environment;
    if (!environment) return null;
    return DIAN_ENVIRONMENT_LABELS[environment] ?? environment;
  });

  readonly isProduction = computed(() => this.axis().environment === 'production');

  detailOf(check: Parameters<typeof warningDetail>[0]): string | null {
    return warningDetail(check);
  }
}
