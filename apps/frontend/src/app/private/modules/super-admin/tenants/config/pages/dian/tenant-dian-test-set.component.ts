import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import {
  AlertBannerComponent,
  BadgeComponent,
  CardComponent,
  IconComponent,
  type DianTechnicalResponseData,
} from '../../../../../../../shared/components';
import {
  DianTestSetPanelComponent,
  summarizeReadiness,
  warningDetail,
  type ProductionReadinessCheck,
} from '../../../../../../../shared/components/dian';
import { DianConfigApiService } from '../../../../../../../shared/services/dian';
import { TENANT_CAPABILITY } from '../../../services/superadmin-dian-context.factory';
import { TenantContextStore } from '../../../state/tenant-context.store';
import { TenantDianAxisPickerComponent } from './tenant-dian-axis-picker.component';
import { TenantDianConsoleStore } from './tenant-dian-console.store';

/**
 * Set de pruebas de habilitación del tenant, con el checklist que lo explica.
 *
 * ## Las consultas NUNCA se gatean
 *
 * «Consultar veredicto» y «Diagnóstico documento a documento» son LECTURAS: la
 * primera vuelve a preguntar por la ZipKey ya guardada, la segunda pregunta a la
 * DIAN si cada documento llegó a sus registros. Ninguna reenvía nada. Son justo
 * lo que hay que hacer EN VEZ de reenviar, así que se ofrecen siempre que haya
 * un lote — esconderlas detrás de una capacidad de escritura empuja al operador
 * al botón que quema otro bloque de consecutivos autorizados.
 *
 * ## Lo que espera a la DIAN se pinta en su propio registro
 *
 * `summarizeReadiness` parte el checklist en tres. `waiting` —bloqueante y con
 * la pelota del lado de la DIAN— va sin verbo imperativo y sin botón: pedir
 * acción sobre uno de esos es lo que produce el segundo envío. `warning` nunca
 * bloquea nada.
 */
@Component({
  selector: 'app-tenant-dian-test-set',
  standalone: true,
  imports: [
    AlertBannerComponent,
    BadgeComponent,
    CardComponent,
    IconComponent,
    DianTestSetPanelComponent,
    TenantDianAxisPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      <app-card [responsive]="true">
        <app-tenant-dian-axis-picker></app-tenant-dian-axis-picker>
      </app-card>

      @if (store.selectedAxis(); as axis) {
        @if (axis.config_id !== null) {
          <!-- Checklist en sus tres registros -->
          <app-card [responsive]="true">
            <div class="space-y-3">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  <h2 class="text-base font-semibold text-text-primary">
                    Requisitos de habilitación — {{ axis.label }}
                  </h2>
                  <p class="mt-0.5 text-xs text-text-secondary">
                    {{ progressText() }}
                  </p>
                </div>
                <app-badge
                  [variant]="summary().ready ? 'success' : 'warning'"
                  size="sm"
                >
                  {{ summary().ready ? 'Listo para producción' : 'Incompleto' }}
                </app-badge>
              </div>

              @if (summary().notEvaluated) {
                <p class="text-xs text-text-secondary">
                  El checklist de esta configuración no se pudo evaluar. No
                  significa que cumpla: significa que no lo sabemos. El envío
                  sigue disponible y el backend vuelve a validar al recibirlo.
                </p>
              }

              @if (summary().todo.length) {
                <div class="rounded-md border border-amber-300 bg-amber-50 p-2.5">
                  <p
                    class="text-[11px] font-semibold uppercase tracking-wide text-amber-900"
                  >
                    Lo que falta hacer
                  </p>
                  <ul class="mt-1.5 space-y-1.5">
                    @for (check of summary().todo; track check.key) {
                      <li class="flex items-start gap-1.5 text-[11px] text-amber-900">
                        <app-icon
                          name="alert-triangle"
                          [size]="13"
                          class="mt-px shrink-0"
                        ></app-icon>
                        <span>
                          <span class="font-medium">{{ check.label }}</span>
                          @if (check.action) {
                            <span class="block opacity-80">{{ check.action }}</span>
                          }
                          @if (check.owner === 'platform') {
                            <span class="italic opacity-80">
                              (lo resuelve Vendix)
                            </span>
                          }
                        </span>
                      </li>
                    }
                  </ul>
                </div>
              }

              <!-- Registro de ESPERA: sin verbo imperativo, sin acción -->
              @if (summary().waiting.length) {
                <div class="rounded-md border border-blue-300 bg-blue-50 p-2.5">
                  <p
                    class="text-[11px] font-semibold uppercase tracking-wide text-blue-900"
                  >
                    Esperando a la DIAN
                  </p>
                  <ul class="mt-1.5 space-y-1.5">
                    @for (check of summary().waiting; track check.key) {
                      <li class="flex items-start gap-1.5 text-[11px] text-blue-900">
                        <app-icon
                          name="hourglass"
                          [size]="13"
                          class="mt-px shrink-0"
                        ></app-icon>
                        <span>{{ check.label }}</span>
                      </li>
                    }
                  </ul>
                  <p class="mt-1.5 text-[11px] text-blue-900 opacity-80">
                    Nuestra parte está hecha. No hay nada que reenviar: repetir el
                    envío consume un bloque nuevo de consecutivos autorizados que
                    no se recupera.
                  </p>
                </div>
              }

              <!-- AVISOS: nunca bloquean -->
              @if (summary().warnings.length) {
                <div class="rounded-md border border-border bg-background p-2.5">
                  <p
                    class="text-[11px] font-semibold uppercase tracking-wide text-text-secondary"
                  >
                    Avisos — no bloquean la emisión
                  </p>
                  <ul class="mt-1.5 space-y-1.5">
                    @for (check of summary().warnings; track check.key) {
                      <li
                        class="flex items-start gap-1.5 text-[11px] text-text-secondary"
                      >
                        <app-icon
                          name="clock"
                          [size]="13"
                          class="mt-px shrink-0"
                        ></app-icon>
                        <span>
                          {{ check.label }}
                          @if (detailOf(check); as detail) {
                            <span class="font-medium">· {{ detail }}</span>
                          }
                        </span>
                      </li>
                    }
                  </ul>
                </div>
              }
            </div>
          </app-card>

          @if (!canRunTestSet()) {
            <app-alert-banner variant="info" icon="info">
              Enviar el set requiere la capacidad
              {{ capability.dianWrite }}. Consultar el veredicto y el diagnóstico
              documento a documento siguen disponibles: son lecturas y no
              consumen numeración.
            </app-alert-banner>
          }

          <!-- Panel COMPARTIDO: envío, veredicto y diagnóstico -->
          <app-dian-test-set-panel
            [configId]="axis.config_id"
            [enablementStatus]="axis.enablement_status"
            [resolutions]="axis.resolutions"
            [lastResult]="lastResult()"
            (changed)="onPanelChanged()"
          ></app-dian-test-set-panel>
        } @else {
          <app-card [responsive]="true">
            <div class="flex flex-col items-center gap-3 py-10 text-center">
              <div
                class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100"
              >
                <app-icon
                  name="file-check"
                  [size]="22"
                  class="text-gray-500"
                ></app-icon>
              </div>
              <h2 class="text-base font-semibold text-text-primary">
                Esta habilitación no tiene configuración DIAN
              </h2>
              <p class="max-w-md text-sm text-text-secondary">
                El set de pruebas se envía contra una configuración concreta.
                Créala desde «Habilitaciones» y registra su numeración antes de
                enviar nada.
              </p>
            </div>
          </app-card>
        }
      }
    </div>
  `,
})
export class TenantDianTestSetComponent {
  protected readonly store = inject(TenantDianConsoleStore);
  private readonly tenant = inject(TenantContextStore);
  private readonly api = inject(DianConfigApiService);

  protected readonly capability = TENANT_CAPABILITY;

  protected readonly canRunTestSet = computed(() =>
    this.tenant.can(TENANT_CAPABILITY.dianWrite),
  );

  protected readonly summary = computed(() =>
    summarizeReadiness(this.store.selectedAxis()?.readiness ?? null),
  );

  protected readonly progressText = computed(() => {
    const summary = this.summary();
    if (summary.notEvaluated) return 'Checklist sin evaluar.';
    if (summary.ready) {
      return 'Todos los prerrequisitos de emisión en producción están cumplidos.';
    }
    return `${summary.satisfiedCount} de ${summary.totalCount} requisitos cumplidos.`;
  });

  /** Se incrementa cuando el panel avisa de un cambio: fuerza la relectura. */
  private readonly refreshTick = signal(0);

  private readonly resultSource = computed(() => ({
    configId: this.store.selectedAxis()?.config_id ?? null,
    tick: this.refreshTick(),
  }));

  /**
   * Último resultado conocido del lote de la configuración elegida.
   *
   * Se lee aquí y no en el store porque cuelga de UNA configuración: pedirlo
   * para las cuatro multiplicaría por cuatro las llamadas de cada entrada a la
   * consola para pintar un dato que sólo esta vista usa.
   *
   * Va por `toObservable` + `switchMap` y no por un `effect` que dispare HTTP:
   * `switchMap` cancela la petición del eje anterior, así que la respuesta
   * rezagada de una habilitación que el operador ya dejó atrás no puede
   * aterrizar sobre la que está mirando.
   */
  protected readonly lastResult = toSignal(
    toObservable(this.resultSource).pipe(
      switchMap(({ configId }) =>
        configId === null
          ? of(null)
          : this.api.getDianTestResults(configId).pipe(
              map((response: unknown) => {
                const payload = this.unwrapObject(response);
                return (
                  (payload?.['last_result'] as DianTechnicalResponseData | null) ??
                  null
                );
              }),
              // Un fallo de lectura NO se pinta como «no hay lote»: se deja el
              // panel con lo que ya tenía y el operador reintenta.
              catchError(() => of(null)),
            ),
      ),
    ),
    { initialValue: null as DianTechnicalResponseData | null },
  );

  protected detailOf(check: ProductionReadinessCheck): string | null {
    return warningDetail(check);
  }

  /**
   * El panel avisó de un cambio del lado del servidor. El estado de habilitación
   * lo decide el backend a partir del veredicto de la DIAN, así que se recarga
   * el agregado en vez de deducirlo aquí.
   */
  protected onPanelChanged(): void {
    this.store.reload();
    this.refreshTick.update((value) => value + 1);
  }

  private unwrapObject(response: unknown): Record<string, unknown> | null {
    if (!response || typeof response !== 'object') return null;
    const envelope = response as Record<string, unknown>;
    const data = envelope['data'];
    if (data && typeof data === 'object') return data as Record<string, unknown>;
    return envelope;
  }
}
