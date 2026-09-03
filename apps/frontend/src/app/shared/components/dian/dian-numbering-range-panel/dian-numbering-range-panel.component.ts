import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { BadgeComponent, type BadgeVariant } from '../../badge/badge.component';
import { ButtonComponent } from '../../button/button.component';
import { CardComponent } from '../../card/card.component';
import { ConfirmationModalComponent } from '../../confirmation-modal/confirmation-modal.component';
import { IconComponent } from '../../icon/icon.component';
import { SelectorComponent } from '../../selector/selector.component';
import {
  DIAN_API_CONTEXT,
  DIAN_NUMBERING_RANGE_APPLY_MAX,
  DianConfigApiService,
  type DianNumberingRange,
  type DianNumberingRangeApplyItem,
  type DianNumberingRangeApplyReport,
  type DianNumberingRangeStatus,
  type DianNumberingRangesResponse,
} from '../../../services/dian';
// Los dos tipos del ambiente se toman del módulo concreto y no del barril:
// `shared/services/dian/index.ts` queda fuera del alcance de este cambio, y una
// importación directa al archivo que declara el contrato no cambia nada del
// grafo (es el mismo módulo que el barril reexporta).
import type {
  DianEnvironment,
  DianNumberingRangeOutcome,
} from '../../../services/dian/dian-config-api.service';
import {
  DIAN_ENVIRONMENT_OPTIONS,
  dianEnvironmentLabel,
  isDianEnvironment,
} from '../dian-environment.constants';
import { formatDateOnlyUTC } from '../../../utils/date.util';
import { isHabilitationNumbering } from '../../../utils/habilitation-numbering.util';

/**
 * Cómo se lee en español cada campo que el backend puede reportar divergente.
 *
 * El backend manda nombres de columna. Enseñarlos crudos obligaría al
 * comerciante a traducir `range_to` mientras decide si toca algo que gasta
 * numeración autorizada.
 */
const DIFFERENCE_LABELS: Readonly<Record<string, string>> = {
  prefix: 'Prefijo',
  resolution_number: 'Número de resolución',
  range_from: 'Desde el número',
  range_to: 'Hasta el número',
  valid_from: 'Vigencia desde',
  valid_to: 'Vigencia hasta',
  resolution_date: 'Fecha de la resolución',
  technical_key: 'Clave técnica',
};

/** Campos que se presentan como fecha y no como texto plano. */
const DATE_FIELDS = ['valid_from', 'valid_to', 'resolution_date'];

/**
 * El único campo cuyo VALOR no se muestra jamás.
 *
 * La ClTec no viaja al navegador —el contrato sólo trae el booleano
 * `technical_key_matches`—, así que la comparación se enuncia sin valores.
 */
const OPAQUE_FIELD = 'technical_key';

const STATUS_LABELS: Readonly<Record<DianNumberingRangeStatus, string>> = {
  in_sync: 'Coincide',
  differs: 'Difiere',
  missing_local: 'No registrada aquí',
};

const STATUS_VARIANTS: Readonly<Record<DianNumberingRangeStatus, BadgeVariant>> = {
  in_sync: 'success',
  differs: 'warning',
  missing_local: 'info',
};

/** Estado tri-estado de la casilla de cabecera. */
type HeaderSelectionState = 'none' | 'some' | 'all';

/**
 * Numeración registrada en la DIAN, enfrentada a la guardada en Vendix.
 *
 * ## Por qué existe esta pantalla
 *
 * Toda factura de una tienda puede volver rechazada con `FAD06 — Valor del CUFE
 * no está calculado correctamente` sin que nada en el panel lo explique. La
 * causa típica es que la clave técnica guardada es la que el portal MUISCA
 * muestra como «vigente», mientras la DIAN recomputa el CUFE con la que tiene
 * ligada A ESA RESOLUCIÓN, que puede ser otra. Como la ClTec se teclea a mano
 * desde un PDF, nadie podía verificarla: el error se veía factura a factura,
 * nunca en su origen.
 *
 * `GetNumberingRange` es la fuente autoritativa. Este panel la consulta y pone
 * las dos verdades una al lado de la otra.
 *
 * ## Consultar no gasta numeración
 *
 * La consulta es una lectura del web service: no emite documentos ni consume
 * consecutivos. Se dice explícitamente en pantalla porque el vecino de esta
 * misma vista —el set de pruebas— sí los gasta, y confundirlos cuesta un bloque
 * de números autorizados que no se recupera.
 *
 * ## Se sincroniza en lote, y nada se escribe solo
 *
 * Un contribuyente puede tener varias resoluciones ligadas al mismo software, y
 * corregirlas de una en una no es una opción realista. Por eso se seleccionan
 * las que hagan falta y se escriben en UNA petición. Hay un solo camino de
 * escritura —el botón del lote— a propósito: dos botones para la misma escritura
 * fiscal es cómo se cuelan los errores.
 *
 * El resultado se pinta elemento a elemento porque el backend resuelve cada uno
 * por separado: un lote donde tres entran y dos no es el caso NORMAL, y
 * resumirlo como «aplicado» dejaría al comerciante creyendo que quedó corregido
 * lo que sigue igual. Lo mismo con los campos que el backend no pudo escribir:
 * una resolución que ya numeró tiene campos inmutables.
 *
 * ## Producción manda, habilitación se marca a mano
 *
 * `invoice_resolutions` NO guarda el entorno: una vez escrita, nada en la base
 * distingue una resolución de pruebas de una real, y la pantalla de crear
 * factura podría ofrecerla. El banner de entorno y el distintivo por fila son la
 * única señal que existe en toda la interfaz, y por eso una fila de habilitación
 * nunca viene preseleccionada aunque difiera.
 *
 * ## Lo que la DIAN no reporta no se borra
 *
 * Las resoluciones guardadas que la DIAN no devuelve se listan aparte y se
 * señalan. Que su web service no las reporte no prueba que no existan, y borrar
 * una resolución que ya emitió documentos rompe la trazabilidad de lo emitido.
 *
 * ## Se elige a QUÉ DIAN se pregunta
 *
 * Los dos ambientes son web services separados con datos distintos. Antes la
 * consulta heredaba siempre el de la configuración, así que un comerciante en
 * habilitación preguntaba a `vpfe-hab.dian.gov.co` —donde sus resoluciones de
 * PRODUCCIÓN no viven— y recibía una lista vacía. Sufrido en la configuración
 * 20 (NIT 1123408049): para poder ver sus rangos reales hubo que inventar una
 * resolución y promover la configuración a producción, un rodeo que quema
 * consecutivos irrecuperables si alguien factura en esa ventana. El selector de
 * ambiente existe para que esa consulta no cueste una promoción.
 *
 * Consultar el otro ambiente NO cambia nada: sigue siendo la misma lectura. Lo
 * que sí cambia es qué clave técnica se copiaría al sincronizar, y por eso el
 * lote viaja con el ambiente con el que se obtuvo la lista.
 *
 * ## Lista vacía y contrato ilegible NO son lo mismo
 *
 * `outcome` los separa. Que la DIAN responda «no hay rangos» es una respuesta
 * legítima con su contrato de siempre; presentarla como «no se pudo
 * interpretar» es acusarla de un cambio que no hizo, y eso mandó a investigar
 * durante horas un problema inexistente. El aviso de contrato ilegible sólo se
 * pinta con `unrecognized_contract`.
 */
@Component({
  selector: 'app-dian-numbering-range-panel',
  standalone: true,
  imports: [
    CardComponent,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    ConfirmationModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card>
      <div class="flex flex-col gap-4">
        <!-- Cabecera -->
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <app-icon
              name="file-search"
              [size]="18"
              class="text-[var(--color-text-secondary)] shrink-0"
            ></app-icon>
            <h3
              class="text-sm font-semibold text-[var(--color-text-primary)] truncate"
            >
              Numeración registrada en la DIAN
            </h3>
          </div>
          <!-- El distintivo nombra el ambiente CONSULTADO, no el de la
               configuración. Cuando difieren se dice cuál es el de la
               configuración: sin esa segunda línea, una consulta cruzada a
               producción es indistinguible de la normal y se leería como si la
               configuración ya estuviera facturando de verdad. -->
          @if (environmentLabel(); as label) {
            <div class="flex flex-col items-end gap-1 shrink-0">
              <app-badge
                [variant]="isProduction() ? 'success' : 'warning'"
                badgeStyle="outline"
                size="xs"
                >{{ label }}</app-badge
              >
              @if (environmentDiffersFromConfig()) {
                <app-badge variant="info" size="xs">
                  La configuración está en {{ configEnvironmentLabel() }}
                </app-badge>
              }
            </div>
          }
        </div>

        @if (!configId()) {
          <p class="text-xs text-[var(--color-text-secondary)]">
            Este eje todavía no tiene configuración DIAN. La consulta de rangos
            se hace contra una configuración con certificado y software
            registrados.
          </p>
        } @else {
          <p class="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            Pregunta a la DIAN qué resolución, prefijo, rango, vigencia y clave
            técnica tiene registrados para este NIT, y muestra en qué difieren de
            lo guardado aquí.
          </p>

          <!-- A qué DIAN se le pregunta. El selector va PEGADO al botón porque
               es parte de la misma decisión: los dos ambientes son web
               services distintos, y elegir mal es lo que devuelve la lista
               vacía que parece «no tienes numeración».

               Cambiarlo consulta de inmediato. Es deliberado: la consulta es
               una lectura que no emite ni gasta numeración, y la alternativa
               —dejar en pantalla la lista de un ambiente mientras el selector
               nombra otro— es justo la confusión que este panel existe para
               evitar. -->
          <div class="flex flex-wrap items-end gap-2">
            <div class="w-full sm:w-52">
              <app-selector
                label="Ambiente a consultar"
                size="sm"
                placeholder="El de la configuración"
                [options]="environmentOptions"
                [value]="selectorEnvironment()"
                [disabled]="busy()"
                (valueChange)="onEnvironmentChange($event)"
              ></app-selector>
            </div>
            <app-button
              size="sm"
              variant="primary"
              [disabled]="busy()"
              [loading]="querying()"
              (clicked)="query()"
            >
              <app-icon slot="icon" name="search" [size]="14"></app-icon>
              Consultar rangos en la DIAN
            </app-button>
          </div>

          <span
            class="text-[11px] text-[var(--color-text-secondary)] inline-flex items-start gap-1"
          >
            <app-icon name="info" [size]="12" class="shrink-0 mt-0.5"></app-icon>
            Es una consulta de solo lectura: no emite documentos ni gasta
            numeración. Se puede preguntar al ambiente que no es el de la
            configuración —las resoluciones de producción no viven en
            habilitación— y eso tampoco promueve nada.
          </span>

          <!-- Mensajes -->
          @if (errorText(); as message) {
            <p class="text-xs text-[var(--color-error)]">{{ message }}</p>
          }
          @if (noticeText(); as message) {
            <p class="text-xs text-[var(--color-text-secondary)]">{{ message }}</p>
          }

          <!-- Resultado del último lote. Va arriba porque es lo último que hizo
               el usuario y lo que necesita comprobar antes de seguir. Se pinta
               elemento a elemento: el lote parcial es el caso normal. -->
          @if (applyReport(); as report) {
            <div
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 flex flex-col gap-2"
            >
              @if (report.failed > 0) {
                <p
                  class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-error)] flex items-start gap-1.5"
                >
                  <app-icon
                    name="alert-triangle"
                    [size]="12"
                    class="shrink-0 mt-0.5"
                  ></app-icon>
                  <span>{{ applyReportHeadline(report) }}</span>
                </p>
              } @else {
                <p
                  class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-success)] flex items-start gap-1.5"
                >
                  <app-icon
                    name="check-circle"
                    [size]="12"
                    class="shrink-0 mt-0.5"
                  ></app-icon>
                  <span>{{ applyReportHeadline(report) }}</span>
                </p>
              }

              @for (item of report.results; track $index) {
                <div
                  class="rounded-md border border-[var(--color-border)] p-2 flex flex-col gap-1"
                >
                  <div class="flex flex-wrap items-center gap-1.5">
                    @if (item.ok) {
                      <app-icon
                        name="check-circle"
                        [size]="12"
                        class="text-[var(--color-success)] shrink-0"
                      ></app-icon>
                    } @else {
                      <app-icon
                        name="x-circle"
                        [size]="12"
                        class="text-[var(--color-error)] shrink-0"
                      ></app-icon>
                    }
                    <span
                      class="text-[11px] font-semibold tabular-nums text-[var(--color-text-primary)]"
                    >
                      {{ item.prefix }} · Resolución {{ item.resolution_number }}
                    </span>
                    @if (isHabilitationResult(item)) {
                      <app-badge variant="warning" size="xs">
                        Pruebas / habilitación
                      </app-badge>
                    }
                    @if (item.ok) {
                      <app-badge
                        [variant]="item.created ? 'info' : 'success'"
                        size="xs"
                      >
                        {{ item.created ? 'Creada' : 'Actualizada' }}
                      </app-badge>
                    } @else {
                      <app-badge variant="error" size="xs">No aplicada</app-badge>
                    }
                  </div>

                  @if (item.ok) {
                    @if (item.applied_fields.length) {
                      <p class="text-[11px] text-[var(--color-text-primary)]">
                        Se escribió: {{ fieldList(item.applied_fields) }}
                      </p>
                    } @else {
                      <p class="text-[11px] text-[var(--color-text-secondary)]">
                        No se escribió ningún campo: ya estaba igual a lo que la
                        DIAN reporta.
                      </p>
                    }
                    @if (item.skipped_fields.length) {
                      <p
                        class="text-[11px] text-[var(--color-warning)] flex items-start gap-1.5"
                      >
                        <app-icon
                          name="alert-triangle"
                          [size]="12"
                          class="shrink-0 mt-0.5"
                        ></app-icon>
                        <span>
                          NO se pudo cambiar:
                          {{ fieldList(item.skipped_fields) }}. Quedaron fuera por
                          inmutabilidad: la resolución ya consumió consecutivos y
                          moverlos rompería la trazabilidad de lo ya emitido. Si
                          de verdad tienen que cambiar, hay que registrar la
                          resolución correcta como un rango nuevo.
                        </span>
                      </p>
                    }
                  } @else {
                    <p class="text-[11px] text-[var(--color-error)]">
                      {{ itemErrorText(item) }}
                    </p>
                  }
                </div>
              }
            </div>
          }

          @if (result(); as payload) {
            <!-- A qué DIAN se le preguntó. Va ANTES de la tabla: leer los
                 números sin saber el entorno es lo que hace que una resolución
                 de pruebas acabe guardada como si fuera real. -->
            @if (isProduction()) {
              <div
                class="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 flex items-start gap-2"
              >
                <app-icon
                  name="check-circle"
                  [size]="16"
                  class="text-[var(--color-success)] shrink-0 mt-0.5"
                ></app-icon>
                <div class="min-w-0 flex flex-col gap-1">
                  <p class="text-xs font-semibold text-[var(--color-text-primary)]">
                    Consulta hecha a la DIAN de producción
                  </p>
                  <p
                    class="text-[11px] leading-relaxed text-[var(--color-text-secondary)]"
                  >
                    Lo que aparece abajo es la numeración con la que se factura de
                    verdad.
                  </p>
                  <!-- Consulta cruzada: se está mirando producción desde una
                       configuración que todavía firma en habilitación. Verlo NO
                       promueve nada, y decirlo aquí evita leer estos rangos como
                       si la tienda ya estuviera emitiendo con ellos. -->
                  @if (environmentDiffersFromConfig()) {
                    <p
                      class="text-[11px] leading-relaxed text-[var(--color-text-primary)]"
                    >
                      La configuración sigue en
                      {{ configEnvironmentLabel() }}: esta consulta no la
                      promueve ni cambia con qué ambiente firma. Sirve para ver
                      la numeración real sin tener que promoverla antes.
                    </p>
                  }
                </div>
              </div>
            } @else {
              <div
                class="rounded-lg border border-[var(--color-warning)]/40 bg-warning-light p-3 flex items-start gap-2"
              >
                <app-icon
                  name="alert-triangle"
                  [size]="16"
                  class="text-[var(--color-warning)] shrink-0 mt-0.5"
                ></app-icon>
                <div class="min-w-0 flex flex-col gap-1">
                  <p class="text-xs font-semibold text-[var(--color-text-primary)]">
                    Consulta hecha a la DIAN de habilitación (pruebas)
                  </p>
                  <p
                    class="text-[11px] leading-relaxed text-[var(--color-text-secondary)]"
                  >
                    Las resoluciones que responde este entorno son de prueba: no
                    sirven para facturar de verdad. Si guardas una, quedará en
                    Vendix sin nada que la distinga de una real —la tabla de
                    resoluciones no almacena el entorno— y la pantalla de crear
                    factura podría llegar a ofrecerla.
                  </p>
                </div>
              </div>
            }

            <!-- Identidad de la consulta. Sin ella, dos consultas de días
                 distintos son indistinguibles en pantalla. -->
            <div
              class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-secondary)] pt-1"
            >
              <span>NIT {{ payload.nit }}</span>
              <span>Software {{ payload.software_id }}</span>
              <span>Consultado el {{ queriedAtLabel() }}</span>
            </div>

            <!-- EL hallazgo de esta pantalla. Va antes de la tabla porque es la
                 causa raíz de un rechazo que se ve factura a factura. -->
            @if (keyMismatchCount() > 0) {
              <div
                class="rounded-lg border border-[var(--color-error)]/30 bg-error-light p-3 flex items-start gap-2"
              >
                <app-icon
                  name="alert-triangle"
                  [size]="16"
                  class="text-[var(--color-error)] shrink-0 mt-0.5"
                ></app-icon>
                <div class="min-w-0 flex flex-col gap-1">
                  <p class="text-xs font-semibold text-[var(--color-error)]">
                    La clave técnica guardada no es la de la DIAN
                    @if (keyMismatchCount() > 1) {
                      ({{ keyMismatchCount() }} resoluciones)
                    }
                  </p>
                  <p
                    class="text-[11px] leading-relaxed text-[var(--color-text-primary)]"
                  >
                    La clave técnica guardada no es la que la DIAN tiene ligada a
                    esta resolución. Con ella, la DIAN recalcula un CUFE distinto
                    y rechaza cada factura por FAD06.
                  </p>
                </div>
              </div>
            }

            <!-- La DIAN respondió algo que el backend no supo leer -->
            @if (unparsedNames(); as names) {
              <div
                class="rounded-lg border border-[var(--color-warning)]/40 bg-warning-light p-3 flex items-start gap-2"
              >
                <app-icon
                  name="shield-alert"
                  [size]="16"
                  class="text-[var(--color-warning)] shrink-0 mt-0.5"
                ></app-icon>
                <div class="min-w-0 flex flex-col gap-1">
                  <p class="text-xs font-semibold text-[var(--color-text-primary)]">
                    La DIAN respondió con una estructura que no se pudo
                    interpretar
                  </p>
                  <p
                    class="text-[11px] leading-relaxed text-[var(--color-text-secondary)]"
                  >
                    No se reconoció ningún rango. Esto suele significar que la
                    DIAN cambió el contrato de su respuesta. Elementos que sí
                    venían:
                  </p>
                  <p class="text-[11px] font-mono break-words text-[var(--color-text-primary)]">
                    {{ names.join(', ') || 'ninguno' }}
                  </p>
                </div>
              </div>
            }

            <!-- La DIAN respondió BIEN y lo que dice es que no hay nada.
                 Es un desenlace distinto del de arriba y se redacta distinto:
                 llamarlo «no se pudo interpretar» acusa a la DIAN de un cambio
                 de contrato que no hizo, y eso mandó a investigar durante horas
                 un problema que no existía. Aquí sólo se repite lo que la DIAN
                 dijo, con su propio código de operación cuando lo trae. -->
            @if (isEmptyList()) {
              <div
                class="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 flex items-start gap-2"
              >
                <app-icon
                  name="info"
                  [size]="16"
                  class="text-[var(--color-text-secondary)] shrink-0 mt-0.5"
                ></app-icon>
                <div class="min-w-0 flex flex-col gap-1.5">
                  <p class="text-xs font-semibold text-[var(--color-text-primary)]">
                    La DIAN no reporta numeración para este NIT en
                    {{ environmentLabel() }}
                  </p>
                  <p
                    class="text-[11px] leading-relaxed text-[var(--color-text-secondary)]"
                  >
                    La respuesta llegó completa y con el contrato de siempre: lo
                    que dice es que en ese ambiente no hay ningún rango asociado
                    al NIT {{ payload.nit }} y al software
                    {{ payload.software_id }}. No es un fallo de lectura ni un
                    cambio de contrato de la DIAN.
                  </p>
                  @if (operationText(); as operation) {
                    <p
                      class="text-[11px] leading-relaxed text-[var(--color-text-primary)]"
                    >
                      La DIAN lo explica así: {{ operation }}
                    </p>
                  }
                  @if (canQueryProduction()) {
                    <p
                      class="text-[11px] leading-relaxed text-[var(--color-text-secondary)]"
                    >
                      Estás preguntando a la DIAN de habilitación, y las
                      resoluciones de PRODUCCIÓN no viven ahí: este ambiente sólo
                      conoce la numeración de pruebas. Si las que buscas son las
                      reales, pregúntaselas a producción — es la misma lectura, no
                      promueve la configuración ni gasta numeración.
                    </p>
                    <div class="pt-0.5">
                      <app-button
                        size="sm"
                        variant="secondary"
                        [disabled]="busy()"
                        [loading]="querying()"
                        (clicked)="queryProduction()"
                      >
                        <app-icon
                          slot="icon"
                          name="search"
                          [size]="14"
                        ></app-icon>
                        Consultar en producción
                      </app-button>
                    </div>
                  }
                  <p
                    class="text-[11px] leading-relaxed text-[var(--color-text-secondary)]"
                  >
                    Si esperabas ver un rango en este ambiente, revisa en MUISCA
                    que el prefijo esté asociado al software registrado: una
                    resolución que existe pero no está asociada a este software
                    tampoco aparece aquí.
                  </p>
                </div>
              </div>
            }

            <!-- Rangos reportados por la DIAN -->
            <div class="flex flex-col gap-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p
                  class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
                >
                  Lo que la DIAN reporta ({{ payload.ranges.length }})
                </p>

                <!-- Casilla tri-estado: marcada cuando están todas, indeterminada
                     cuando hay selección parcial. El indeterminado es propiedad
                     nativa del input, no una imitación pintada. -->
                @if (selectableCount() > 0) {
                  <div class="flex flex-wrap items-center gap-2">
                    <label
                      class="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    >
                      <input
                        type="checkbox"
                        class="w-3.5 h-3.5 rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        [checked]="headerSelectionState() === 'all'"
                        [indeterminate]="headerSelectionState() === 'some'"
                        [disabled]="busy()"
                        (change)="toggleAllSelectable()"
                        aria-label="Seleccionar todas o ninguna"
                      />
                      <span>Seleccionar todas / ninguna</span>
                    </label>
                    <span class="text-[11px] text-[var(--color-text-secondary)]">
                      {{ selectedCount() }} de {{ selectableCount() }}
                      seleccionadas
                    </span>
                  </div>
                }
              </div>

              @if (selectableCount() > 0) {
                <div class="flex flex-wrap items-center gap-2">
                  <app-button
                    size="sm"
                    variant="primary"
                    [disabled]="busy() || selectedCount() === 0"
                    [loading]="applying()"
                    (clicked)="askApplyConfirmation()"
                  >
                    <app-icon
                      slot="icon"
                      name="list-checks"
                      [size]="14"
                    ></app-icon>
                    Sincronizar seleccionadas ({{ selectedCount() }})
                  </app-button>
                  <span
                    class="text-[11px] text-[var(--color-text-secondary)] inline-flex items-start gap-1"
                  >
                    <app-icon
                      name="info"
                      [size]="12"
                      class="shrink-0 mt-0.5"
                    ></app-icon>
                    Vienen marcadas las de producción que difieren o no están
                    registradas aquí. Puedes marcar y desmarcar las que quieras.
                  </span>
                </div>
              }

              @if (!canApply()) {
                <p class="text-[11px] text-[var(--color-text-secondary)]">
                  No tienes permiso para escribir la numeración de esta
                  configuración, así que la comparación es de solo lectura. La
                  consulta sí queda registrada arriba.
                </p>
              }

              <!-- La lista vacía ya se explica arriba, con el desenlace que
                   reportó el backend y el código de la DIAN. Aquí NO se repite:
                   un segundo texto genérico sobre lo mismo compite con el que sí
                   dice por qué está vacía y con el atajo a producción. -->

              <!-- El backend ya devuelve produccion primero: NO se reordena aquí,
                   o el panel discutiria con la fuente sobre cual es la prioridad. -->
              @for (range of payload.ranges; track $index) {
                <div [class]="rowCardClasses(range)">
                  <div class="flex items-start gap-2.5">
                    @if (isSelectable(range)) {
                      <input
                        type="checkbox"
                        class="mt-1 w-4 h-4 shrink-0 rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        [checked]="isRowSelected(range)"
                        [disabled]="busy()"
                        (change)="toggleRow(range)"
                        [attr.aria-label]="
                          'Seleccionar ' + rangeLabel(range) + ' para sincronizar'
                        "
                      />
                    }

                    <div class="min-w-0 flex-1 flex flex-col gap-1">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span
                          class="text-sm font-semibold tabular-nums text-[var(--color-text-primary)]"
                        >
                          {{ rangeLabel(range) }}
                        </span>
                        @if (isHabilitation(range)) {
                          <app-badge variant="warning" size="xs">
                            Pruebas / habilitación
                          </app-badge>
                        } @else {
                          <app-badge variant="success" badgeStyle="outline" size="xs">
                            Producción
                          </app-badge>
                        }
                        <app-badge [variant]="statusVariant(range)" size="xs">
                          {{ statusLabel(range) }}
                        </app-badge>
                        @if (range.technical_key_matches === false) {
                          <app-badge variant="error" size="xs">
                            Clave técnica distinta
                          </app-badge>
                        }
                      </div>
                      <p class="text-[11px] text-[var(--color-text-secondary)]">
                        @if (range.resolution_number) {
                          Resolución {{ range.resolution_number }} ·
                        }
                        Vigencia {{ validityLabel(range) }}
                      </p>
                    </div>
                  </div>

                  <!-- Por qué una fila de pruebas no puede pasar por real -->
                  @if (isHabilitation(range)) {
                    <p
                      class="text-[11px] leading-relaxed text-[var(--color-warning)] flex items-start gap-1.5"
                    >
                      <app-icon
                        name="alert-triangle"
                        [size]="12"
                        class="shrink-0 mt-0.5"
                      ></app-icon>
                      <span>
                        Numeración de habilitación: la DIAN la reparte igual a
                        todo contribuyente, con la misma clave técnica para todos.
                        No sirve para facturar de verdad. No viene marcada:
                        márcala sólo si de verdad quieres guardarla.
                      </span>
                    </p>
                  }

                  <!-- Clave técnica: la consecuencia real, no el nombre del campo -->
                  @if (range.technical_key_matches === false) {
                    <p
                      class="text-[11px] leading-relaxed text-[var(--color-error)] flex items-start gap-1.5"
                    >
                      <app-icon
                        name="alert-triangle"
                        [size]="12"
                        class="shrink-0 mt-0.5"
                      ></app-icon>
                      <span>
                        La clave técnica guardada no es la que la DIAN tiene
                        ligada a esta resolución. Con ella, la DIAN recalcula un
                        CUFE distinto y rechaza cada factura por FAD06.
                      </span>
                    </p>
                  }

                  @if (range.status === 'missing_local') {
                    <p class="text-[11px] text-[var(--color-text-secondary)]">
                      Este rango está autorizado en la DIAN pero no está
                      registrado aquí. Sin registrarlo no se puede numerar con él.
                    </p>
                  }

                  <!-- Diferencias campo a campo: DIAN frente a lo guardado -->
                  @if (visibleDifferences(range); as fields) {
                    <div class="flex flex-col gap-1 pt-1">
                      <p
                        class="text-[11px] font-medium text-[var(--color-text-secondary)]"
                      >
                        Diferencias
                      </p>
                      @for (field of fields; track field) {
                        <div
                          class="grid grid-cols-1 sm:grid-cols-3 gap-x-3 text-[11px]"
                        >
                          <span class="text-[var(--color-text-secondary)]">{{
                            differenceLabel(field)
                          }}</span>
                          @if (field !== opaqueField) {
                            <span class="text-[var(--color-text-primary)]">
                              DIAN: {{ dianValue(range, field) }}
                            </span>
                            <span class="text-[var(--color-text-secondary)]">
                              Guardado: {{ localValue(range, field) }}
                            </span>
                          } @else {
                            <span
                              class="sm:col-span-2 text-[var(--color-text-secondary)]"
                            >
                              No se muestra su valor: la clave técnica nunca sale
                              del servidor.
                            </span>
                          }
                        </div>
                      }
                    </div>
                  }

                  @if (canApply() && !isSelectable(range)) {
                    <p class="text-[11px] text-[var(--color-text-secondary)]">
                      {{ blockedSelectionReason }}
                    </p>
                  }
                </div>
              }
            </div>

            <!-- Guardadas que la DIAN no reporta -->
            @if (payload.local_only.length) {
              <div
                class="flex flex-col gap-2 pt-3 border-t border-[var(--color-border)]"
              >
                <p
                  class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]"
                >
                  Guardadas que la DIAN no reporta ({{ payload.local_only.length }})
                </p>
                <p class="text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                  No se tocan. Que la DIAN no las devuelva no prueba que no
                  existan: pueden pertenecer a otro software, estar vencidas o
                  haberse registrado con un número distinto. Revísalas a mano
                  contra el portal antes de cambiar nada.
                </p>
                @for (row of payload.local_only; track row.id) {
                  <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <app-icon
                      name="help-circle"
                      [size]="12"
                      class="text-[var(--color-text-secondary)] shrink-0"
                    ></app-icon>
                    <span
                      class="font-semibold tabular-nums text-[var(--color-text-primary)]"
                    >
                      {{ row.prefix }}{{ row.range_from }}–{{ row.range_to }}
                    </span>
                    <span class="text-[var(--color-text-secondary)]">
                      Resolución {{ row.resolution_number }} · vigente hasta
                      {{ formatDate(row.valid_to) }}
                    </span>
                    <app-badge
                      [variant]="row.is_active ? 'success' : 'neutral'"
                      size="xs"
                    >
                      {{ row.is_active ? 'Activa' : 'Inactiva' }}
                    </app-badge>
                  </div>
                }
              </div>
            }
          }
        }
      </div>
    </app-card>

    <!-- La confirmación se renderiza sólo cuando hay lote pendiente, así que el
         modal nace abierto y no hace falta un canal de visibilidad duplicado.
         El lote se congela al pedir confirmación: lo que se enumera aquí es
         exactamente lo que se va a enviar. -->
    @if (pendingBatch(); as batch) {
      <app-confirmation-modal
        title="Sincronizar numeración desde la DIAN"
        [message]="applyConfirmationMessage(batch)"
        confirmText="Sí, sincronizar"
        cancelText="Cancelar"
        confirmVariant="primary"
        size="md"
        (confirm)="applySelected(batch)"
        (cancel)="pendingBatch.set(null)"
      ></app-confirmation-modal>
    }
  `,
})
export class DianNumberingRangePanelComponent {
  /** Configuración sobre la que opera. `null` deshabilita todo el panel. */
  readonly configId = input.required<number | null>();

  /**
   * Se aplicó un lote: el host recarga su agregado. El estado de la habilitación
   * lo decide el backend a partir de las resoluciones, no este componente.
   */
  readonly changed = output<void>();

  private readonly api = inject(DianConfigApiService);
  private readonly dianContext = inject(DIAN_API_CONTEXT);
  private readonly destroyRef = inject(DestroyRef);

  /** Expuesto al template para no repetir el literal del campo opaco. */
  readonly opaqueField = OPAQUE_FIELD;

  /**
   * Única razón por la que una fila queda sin casilla teniendo permiso: sin
   * prefijo o sin número de resolución el POST no puede apuntar a nada.
   */
  readonly blockedSelectionReason =
    'La DIAN no reporta número de resolución o prefijo para este rango, y son justamente los dos datos con los que se identifica la autorización. Hay que revisarlo en el portal.';

  readonly capabilities = computed(() => this.dianContext.capabilities());

  /**
   * Sincronizar crea o edita resoluciones, así que se gobierna con la MISMA
   * capacidad que el alta manual. Un panel con su propio permiso sería un
   * segundo sitio donde decidir quién puede tocar numeración.
   */
  readonly canApply = computed(() => this.capabilities().writeConfig);

  readonly querying = signal(false);
  /** Hay un lote en vuelo. Es del lote entero, no de una fila. */
  readonly applying = signal(false);
  readonly errorText = signal<string | null>(null);
  readonly noticeText = signal<string | null>(null);
  readonly result = signal<DianNumberingRangesResponse | null>(null);
  readonly applyReport = signal<DianNumberingRangeApplyReport | null>(null);
  /** Lote congelado esperando confirmación. `null` cuando no hay modal. */
  readonly pendingBatch = signal<DianNumberingRange[] | null>(null);

  /**
   * Claves de las filas marcadas (`prefijo|resolución`).
   *
   * Se guarda como `ReadonlySet` y SIEMPRE se reemplaza entero al cambiar:
   * mutar el Set en sitio no cambia la referencia, la señal no notifica y la
   * casilla se quedaría pintada como estaba.
   */
  readonly selectedKeys = signal<ReadonlySet<string>>(new Set<string>());

  readonly busy = computed(() => this.querying() || this.applying());

  // ── Ambiente ────────────────────────────────────────────
  //
  // Hay TRES ambientes distintos en juego y confundirlos es el fallo caro:
  // el que se va a preguntar (`requestedEnvironment`), el que se preguntó y
  // produjo la lista en pantalla (`queriedEnvironment`) y el de la propia
  // configuración (`configEnvironment`). Antes eran uno solo porque la consulta
  // siempre heredaba el de la configuración.

  /**
   * Ambiente elegido a mano. `null` significa «el de la configuración»: la
   * petición OMITE el parámetro y deja que el backend lo resuelva. Se guarda la
   * ausencia y no una copia adivinada del ambiente de la configuración, porque
   * el panel no lo conoce hasta que la DIAN responde por primera vez.
   */
  readonly requestedEnvironment = signal<DianEnvironment | null>(null);

  readonly environmentOptions = DIAN_ENVIRONMENT_OPTIONS;

  /** Ambiente con el que se obtuvo la lista que está en pantalla. */
  readonly queriedEnvironment = computed<DianEnvironment | null>(() => {
    const environment = this.result()?.environment;
    return isDianEnvironment(environment) ? environment : null;
  });

  /** Ambiente de la configuración, tal como lo reporta la última respuesta. */
  readonly configEnvironment = computed<DianEnvironment | null>(() => {
    const environment = this.result()?.config_environment;
    return isDianEnvironment(environment) ? environment : null;
  });

  /**
   * Lo que pinta el selector: lo elegido a mano o, si no se ha elegido nada, lo
   * último consultado. Así el selector acaba mostrando el ambiente de la
   * configuración en cuanto la primera respuesta lo revela, sin que el panel
   * tenga que suponerlo antes de preguntar.
   */
  readonly selectorEnvironment = computed<DianEnvironment | null>(
    () => this.requestedEnvironment() ?? this.queriedEnvironment(),
  );

  /**
   * `true` cuando lo que se está mirando NO es el ambiente en el que la
   * configuración firma. Es lo que separa una consulta cruzada de la normal.
   */
  readonly environmentDiffersFromConfig = computed(() => {
    const queried = this.queriedEnvironment();
    const config = this.configEnvironment();
    return !!queried && !!config && queried !== config;
  });

  readonly isProduction = computed(
    () => this.queriedEnvironment() === 'production',
  );

  readonly environmentLabel = computed(() =>
    dianEnvironmentLabel(this.queriedEnvironment()),
  );

  readonly configEnvironmentLabel = computed(() =>
    dianEnvironmentLabel(this.configEnvironment()),
  );

  readonly queriedAtLabel = computed(() => {
    const queriedAt = this.result()?.queried_at;
    if (!queriedAt) return '—';
    const parsed = new Date(queriedAt);
    return Number.isNaN(parsed.getTime())
      ? queriedAt
      : parsed.toLocaleString('es-CO');
  });

  /**
   * Cuántas resoluciones tienen la clave técnica equivocada.
   *
   * Se cuenta sólo el `false` explícito: `null` significa que no hay fila local
   * con la que comparar, y tratarlo como fallo inventaría una alarma sobre una
   * resolución que aquí ni siquiera existe.
   */
  readonly keyMismatchCount = computed(
    () =>
      this.result()?.ranges.filter(
        (range) => range.technical_key_matches === false,
      ).length ?? 0,
  );

  // ── Desenlace de la consulta ────────────────────────────

  /**
   * Cuál de los tres desenlaces reportó el backend.
   *
   * Manda `outcome`. El respaldo es para una respuesta servida por un despliegue
   * anterior, que no lo trae: entonces se deduce, y se deduce igual que el
   * backend nuevo —`unparsed` presente es contrato ilegible; sin él, cero filas
   * es lista vacía—. Lo que NO se hace es lo de antes: dar por ilegible toda
   * respuesta sin filas.
   */
  readonly outcome = computed<DianNumberingRangeOutcome | null>(() => {
    const payload = this.result();
    if (!payload) return null;
    if (payload.outcome) return payload.outcome;
    if (payload.unparsed) return 'unrecognized_contract';
    return payload.ranges.length ? 'ranges' : 'empty_list';
  });

  /**
   * `null` salvo cuando la DIAN respondió algo que de verdad no se pudo leer.
   *
   * El desenlace es la compuerta y no la presencia de `unparsed`: acusar a la
   * DIAN de haber cambiado su contrato cuando lo único que dijo es que no hay
   * rangos es la mentira que este panel contaba, y costó horas de investigación
   * sobre un cambio inexistente.
   */
  readonly unparsedNames = computed<string[] | null>(() => {
    if (this.outcome() !== 'unrecognized_contract') return null;
    const unparsed = this.result()?.unparsed;
    return unparsed ? unparsed.element_names : [];
  });

  readonly isEmptyList = computed(() => this.outcome() === 'empty_list');

  /**
   * La explicación de la DIAN, con SUS palabras y SU código. Se prefiere a
   * cualquier redacción propia: es la única pista de por qué la lista vino
   * vacía, y reescribirla borraría el dato con el que se abre un caso.
   */
  readonly operationText = computed<string | null>(() => {
    const payload = this.result();
    if (!payload) return null;
    const description = payload.operation_description?.trim();
    const code = payload.operation_code?.trim();
    if (description && code) return `«${description}» (código ${code})`;
    if (description) return `«${description}»`;
    if (code) return `código de operación ${code}`;
    return null;
  });

  /**
   * Cuándo tiene sentido el atajo a producción: la DIAN de habilitación
   * respondió que no hay nada, y las resoluciones reales no viven ahí. Es el
   * punto exacto donde el usuario quedaba atrapado y acababa inventando una
   * resolución para poder promover la configuración.
   */
  readonly canQueryProduction = computed(
    () => this.isEmptyList() && this.queriedEnvironment() === 'test',
  );

  /** Filas que se pueden marcar, en el orden en que el backend las devolvió. */
  readonly selectableRanges = computed<DianNumberingRange[]>(() => {
    if (!this.canApply()) return [];
    return (this.result()?.ranges ?? []).filter((range) =>
      this.hasIdentity(range),
    );
  });

  readonly selectableCount = computed(() => this.selectableRanges().length);
  readonly selectedCount = computed(() => this.selectedKeys().size);

  readonly headerSelectionState = computed<HeaderSelectionState>(() => {
    const total = this.selectableCount();
    const selected = this.selectedCount();
    if (total === 0 || selected === 0) return 'none';
    return selected >= total ? 'all' : 'some';
  });

  // ── Consulta ────────────────────────────────────────────

  query(): void {
    const configId = this.configId();
    if (!configId || this.busy()) return;

    this.querying.set(true);
    this.errorText.set(null);
    this.noticeText.set(null);
    // El informe de un lote anterior no describe lo que se está pidiendo ahora:
    // dejarlo en pantalla haría creer que la consulta nueva lo produjo.
    this.applyReport.set(null);
    this.runQuery();
  }

  /**
   * Cambiar el ambiente consulta en el acto.
   *
   * La alternativa —guardar la elección y esperar a que pulsen «Consultar»—
   * dejaría en pantalla la lista de un ambiente mientras el selector nombra el
   * otro, que es exactamente la confusión que hace guardar una resolución de
   * pruebas como si fuera real. Consultar es gratis: es una lectura que no emite
   * ni gasta numeración.
   */
  onEnvironmentChange(value: string | number | null): void {
    if (!isDianEnvironment(value)) return;
    // Ya se está mirando ese ambiente: repetir la llamada no aportaría nada.
    if (value === this.selectorEnvironment()) return;
    this.requestedEnvironment.set(value);
    this.query();
  }

  /**
   * Atajo del bloque de lista vacía. Deja el selector coherente con lo que se va
   * a consultar en vez de disparar una petición «invisible» que contradiría lo
   * que el selector dice.
   */
  queryProduction(): void {
    if (this.busy()) return;
    this.requestedEnvironment.set('production');
    this.query();
  }

  /**
   * `undefined` cuando no se eligió ambiente: la petición omite el parámetro y
   * el backend usa el de la configuración. Omitir NO es lo mismo que mandar el
   * ambiente adivinado.
   */
  private queryEnvironment(): DianEnvironment | undefined {
    return this.requestedEnvironment() ?? undefined;
  }

  private runQuery(): void {
    const configId = this.configId();
    if (!configId) {
      // Salir sin bajar la bandera dejaría el botón girando para siempre.
      this.querying.set(false);
      return;
    }

    this.api
      .getNumberingRanges(configId, this.queryEnvironment())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          this.querying.set(false);
          const payload = this.unwrap(
            response,
          ) as DianNumberingRangesResponse | null;
          if (!payload) {
            this.result.set(null);
            this.selectedKeys.set(new Set<string>());
            this.errorText.set(
              'La DIAN respondió, pero sin contenido que se pueda leer. Vuelve a consultar en unos minutos.',
            );
            return;
          }
          // Se normalizan las listas: el resto del panel las recorre sin
          // preguntar, y una lista ausente pintaría un template roto en vez de
          // una sección vacía.
          const ranges = payload.ranges ?? [];
          this.result.set({
            ...payload,
            ranges,
            local_only: payload.local_only ?? [],
          });
          // La preselección se recalcula en CADA respuesta, no sólo en la
          // primera: tras sincronizar se vuelve a consultar, y arrastrar la
          // selección vieja dejaría marcadas filas que ya quedaron al día.
          this.selectedKeys.set(this.defaultSelection(ranges));
        },
        error: (error: unknown) => {
          this.querying.set(false);
          this.errorText.set(this.messageOf(error));
        },
      });
  }

  // ── Selección ───────────────────────────────────────────

  /**
   * Lo que viene marcado de fábrica: producción que difiere o que no está
   * registrada aquí. Es la acción que se quiere casi siempre.
   *
   * Habilitación NUNCA entra sola aunque difiera. Escribirla es guardar en
   * `invoice_resolutions` —que no tiene columna de entorno— un rango de pruebas
   * indistinguible de uno real, y eso tiene que ser una decisión de alguien.
   */
  private defaultSelection(ranges: DianNumberingRange[]): ReadonlySet<string> {
    const keys = new Set<string>();
    if (!this.canApply()) return keys;
    for (const range of ranges) {
      if (!this.hasIdentity(range)) continue;
      if (this.isHabilitation(range)) continue;
      if (range.status !== 'differs' && range.status !== 'missing_local') continue;
      if (keys.size >= DIAN_NUMBERING_RANGE_APPLY_MAX) break;
      keys.add(this.rowKey(range));
    }
    return keys;
  }

  isRowSelected(range: DianNumberingRange): boolean {
    return this.selectedKeys().has(this.rowKey(range));
  }

  /**
   * Se puede marcar cualquier fila con identidad, `in_sync` incluida: reaplicar
   * una que ya coincide es inocuo y a veces es justo lo que el comerciante
   * quiere para asegurarse. Lo que no hace es venir marcada.
   */
  isSelectable(range: DianNumberingRange): boolean {
    return this.canApply() && this.hasIdentity(range);
  }

  toggleRow(range: DianNumberingRange): void {
    if (!this.isSelectable(range) || this.busy()) return;
    const key = this.rowKey(range);
    // Se reemplaza el Set ENTERO: mutarlo en sitio conserva la referencia, la
    // señal no notifica y la casilla no se repinta.
    const next = new Set(this.selectedKeys());
    if (next.has(key)) {
      next.delete(key);
    } else {
      if (next.size >= DIAN_NUMBERING_RANGE_APPLY_MAX) {
        this.noticeText.set(this.batchLimitNotice());
        return;
      }
      next.add(key);
    }
    this.noticeText.set(null);
    this.selectedKeys.set(next);
  }

  /** Marcada del todo pasa a ninguna; en cualquier otro caso, a todas. */
  toggleAllSelectable(): void {
    if (this.busy()) return;
    if (this.headerSelectionState() === 'all') {
      this.noticeText.set(null);
      this.selectedKeys.set(new Set<string>());
      return;
    }
    const selectable = this.selectableRanges();
    const next = new Set<string>();
    for (const range of selectable) {
      if (next.size >= DIAN_NUMBERING_RANGE_APPLY_MAX) break;
      next.add(this.rowKey(range));
    }
    this.noticeText.set(
      next.size < selectable.length ? this.batchLimitNotice() : null,
    );
    this.selectedKeys.set(next);
  }

  private batchLimitNotice(): string {
    return `El backend acepta hasta ${DIAN_NUMBERING_RANGE_APPLY_MAX} resoluciones por envío. Sincroniza estas y vuelve a consultar para seguir con el resto.`;
  }

  // ── Aplicación del lote ─────────────────────────────────

  askApplyConfirmation(): void {
    if (this.busy()) return;
    const batch = this.currentBatch();
    if (!batch.length) return;
    this.errorText.set(null);
    this.noticeText.set(null);
    this.pendingBatch.set(batch);
  }

  /** Filas marcadas, en el orden del backend (producción primero). */
  private currentBatch(): DianNumberingRange[] {
    const selected = this.selectedKeys();
    return this.selectableRanges().filter((range) =>
      selected.has(this.rowKey(range)),
    );
  }

  applySelected(batch: DianNumberingRange[]): void {
    this.pendingBatch.set(null);
    const configId = this.configId();
    if (!configId || this.busy()) return;

    const ranges: DianNumberingRangeApplyItem[] = [];
    for (const range of batch) {
      const resolutionNumber = range.resolution_number;
      const prefix = range.prefix;
      // Se vuelve a comprobar aquí y no sólo al pintar la casilla: entre marcar
      // y confirmar pudo llegar otra consulta.
      if (!resolutionNumber || !prefix) continue;
      ranges.push({ resolution_number: resolutionNumber, prefix });
    }
    if (!ranges.length) return;

    // Se envía el ambiente con el que se OBTUVO la lista, no el de la
    // configuración: aplicar es traerse la clave técnica que la DIAN tiene
    // ligada a esa resolución EN ESE AMBIENTE. Si el backend fuera a buscarla al
    // otro, se guardaría una ClTec que no corresponde y cada factura volvería
    // con `FAD06 — Valor del CUFE no está calculado correctamente`, con el
    // consecutivo autorizado ya gastado y no recuperable.
    const environment = this.queriedEnvironment() ?? undefined;

    this.applying.set(true);
    this.errorText.set(null);
    this.noticeText.set(null);
    this.applyReport.set(null);

    this.api
      .applyNumberingRanges(configId, { environment, ranges })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: unknown) => {
          this.applying.set(false);
          const payload = this.unwrap(
            response,
          ) as DianNumberingRangeApplyReport | null;
          if (payload) {
            this.applyReport.set({
              applied: payload.applied ?? 0,
              failed: payload.failed ?? 0,
              results: payload.results ?? [],
            });
          }
          this.noticeText.set(
            'Se vuelve a consultar a la DIAN para comprobar contra la fuente que quedó como debía, y no contra lo que este panel supone que escribió.',
          );
          // Consulta de verificación: sin ella, la pantalla seguiría mostrando
          // las divergencias que se acaban de corregir.
          this.querying.set(true);
          this.runQuery();
          this.changed.emit();
        },
        error: (error: unknown) => {
          this.applying.set(false);
          this.errorText.set(this.messageOf(error));
        },
      });
  }

  // ── Presentación ────────────────────────────────────────

  /** Identidad de la fila. Es la misma pareja con la que se identifica en la DIAN. */
  rowKey(range: DianNumberingRange): string {
    return `${range.prefix ?? ''}|${range.resolution_number ?? ''}`;
  }

  /**
   * Numeración de habilitación (pruebas).
   *
   * Manda la bandera del backend, que la deriva de la misma regla. El respaldo
   * NO es el prefijo `SETP` —una cadena que cualquiera puede teclear en una
   * resolución propia— sino el mismo predicado compartido que usa el selector
   * de la pantalla de crear factura. Dos definiciones distintas de «esto es de
   * pruebas» acabarían discrepando justo en la fila que importa.
   */
  isHabilitation(range: DianNumberingRange): boolean {
    if (typeof range.is_habilitation_numbering === 'boolean') {
      return range.is_habilitation_numbering;
    }
    return isHabilitationNumbering(range);
  }

  /**
   * Lo mismo, para una línea del informe. Se marca también en el resultado: lo
   * que se acaba de escribir es exactamente lo que hay que poder auditar.
   *
   * Aquí el respaldo NO alcanza: el informe sólo trae `prefix` y
   * `resolution_number`, sin rango. Con la bandera ausente sólo puede decidir
   * el número de resolución, así que un rango de pruebas con otro número
   * pasaría por bueno. Es el motivo por el que la bandera del backend no es
   * opcional.
   */
  isHabilitationResult(
    item: DianNumberingRangeApplyReport['results'][number],
  ): boolean {
    if (typeof item.is_habilitation_numbering === 'boolean') {
      return item.is_habilitation_numbering;
    }
    return isHabilitationNumbering({
      resolution_number: item.resolution_number,
    });
  }

  rowCardClasses(range: DianNumberingRange): string {
    const classes = [
      'rounded-lg',
      'border',
      'bg-[var(--color-background)]',
      'p-3',
      'flex',
      'flex-col',
      'gap-2',
    ];
    classes.push(
      this.isRowSelected(range)
        ? 'border-[var(--color-primary)]'
        : 'border-[var(--color-border)]',
    );
    // Atenuar la fila de pruebas es la señal de que NO es con la que se factura:
    // producción tiene que ganar la lectura a simple vista.
    if (this.isHabilitation(range)) {
      classes.push('border-dashed', 'opacity-70');
    }
    return classes.join(' ');
  }

  rangeLabel(range: DianNumberingRange): string {
    const from = range.range_from ?? '?';
    const to = range.range_to ?? '?';
    return `${range.prefix ?? ''}${from}–${to}`;
  }

  validityLabel(range: DianNumberingRange): string {
    const from = range.valid_from ? this.formatDate(range.valid_from) : '—';
    const to = range.valid_to ? this.formatDate(range.valid_to) : '—';
    return `${from} – ${to}`;
  }

  statusLabel(range: DianNumberingRange): string {
    return STATUS_LABELS[range.status] ?? range.status;
  }

  statusVariant(range: DianNumberingRange): BadgeVariant {
    return STATUS_VARIANTS[range.status] ?? 'neutral';
  }

  differenceLabel(field: string): string {
    return DIFFERENCE_LABELS[field] ?? field;
  }

  fieldList(fields: string[]): string {
    return fields.map((field) => this.differenceLabel(field)).join(', ');
  }

  /** `null` cuando no hay nada que listar: evita pintar una sección vacía. */
  visibleDifferences(range: DianNumberingRange): string[] | null {
    const fields = range.differences ?? [];
    return fields.length ? fields : null;
  }

  dianValue(range: DianNumberingRange, field: string): string {
    if (field === OPAQUE_FIELD) return '—';
    const source = range as unknown as Record<string, unknown>;
    return this.presentValue(field, source[field]);
  }

  localValue(range: DianNumberingRange, field: string): string {
    if (field === OPAQUE_FIELD) return '—';
    const local = range.local;
    if (!local) return 'sin registrar';
    const source = local as unknown as Record<string, unknown>;
    return this.presentValue(field, source[field]);
  }

  /**
   * Encabezado del informe.
   *
   * Cuando algo falló lo dice CON NÚMERO. Un lote parcial resumido como
   * «sincronizado» es la forma más barata de que alguien siga facturando con una
   * clave técnica que no se llegó a corregir.
   */
  applyReportHeadline(report: DianNumberingRangeApplyReport): string {
    const total = report.applied + report.failed;
    if (report.failed > 0 && report.applied === 0) {
      return total === 1
        ? 'No se pudo aplicar'
        : `Ninguna de las ${total} se pudo aplicar`;
    }
    if (report.failed > 0) {
      return `${report.failed} de ${total} no se pudieron aplicar`;
    }
    return total === 1
      ? 'Se aplicó 1 resolución'
      : `Se aplicaron las ${total} resoluciones`;
  }

  /** El mensaje del backend manda; el código sólo acompaña para poder reportarlo. */
  itemErrorText(item: DianNumberingRangeApplyReport['results'][number]): string {
    const message =
      item.error?.message ?? 'El backend no pudo aplicar esta resolución.';
    const code = item.error?.code;
    return code ? `${message} (${code})` : message;
  }

  /**
   * Enumera el lote antes de escribirlo.
   *
   * Es una escritura fiscal: el usuario tiene que ver EXACTAMENTE qué
   * resoluciones se van a tocar, no un genérico. Va como HTML porque el modal de
   * confirmación pinta su mensaje con innerHTML; todo valor que venga de la DIAN
   * se escapa antes de entrar.
   *
   * Nombra el AMBIENTE del que sale la clave técnica, y lo destaca cuando no es
   * el de la configuración: una ClTec traída del ambiente que no toca produce
   * `FAD06` en cada factura con el consecutivo ya gastado, y el único momento en
   * que eso todavía se puede evitar es este.
   */
  applyConfirmationMessage(batch: DianNumberingRange[]): string {
    const lines = batch
      .map((range) => {
        const target = range.local
          ? `actualiza la guardada ${range.local.prefix}${range.local.range_from}–${range.local.range_to}`
          : 'se registra como resolución nueva en Vendix';
        const flag = this.isHabilitation(range) ? ' — PRUEBAS' : '';
        return (
          '• <strong>' +
          this.escapeHtml(range.prefix ?? '') +
          '</strong> · Resolución ' +
          this.escapeHtml(range.resolution_number ?? '') +
          ' → ' +
          this.escapeHtml(target) +
          this.escapeHtml(flag)
        );
      })
      .join('<br>');

    const header =
      batch.length === 1
        ? 'Se copiará a Vendix lo que la DIAN reporta para esta resolución:'
        : `Se copiará a Vendix lo que la DIAN reporta para estas ${batch.length} resoluciones:`;

    const habilitation = batch.filter((range) => this.isHabilitation(range));
    const habilitationWarning = habilitation.length
      ? '<br><br><strong>ATENCIÓN:</strong> ' +
        (habilitation.length === 1
          ? 'una de ellas es numeración de habilitación (pruebas): '
          : `${habilitation.length} de ellas son numeración de habilitación (pruebas): `) +
        habilitation
          .map(
            (range) =>
              this.escapeHtml(range.prefix ?? '') +
              ' · Resolución ' +
              this.escapeHtml(range.resolution_number ?? ''),
          )
          .join('; ') +
        '. No sirve para facturar de verdad, y una vez guardada nada en Vendix la distingue de una resolución real.'
      : '';

    const environmentLabel = this.environmentLabel();
    const environmentNote = environmentLabel
      ? ' Se traerá la que tiene registrada en <strong>' +
        this.escapeHtml(environmentLabel) +
        '</strong>, que es el ambiente al que se consultó.'
      : '';
    const configLabel = this.configEnvironmentLabel();
    const crossEnvironmentWarning = this.environmentDiffersFromConfig()
      ? '<br><br><strong>OJO:</strong> ese NO es el ambiente de la configuración' +
        (configLabel ? ', que está en ' + this.escapeHtml(configLabel) : '') +
        '. Estás copiando la clave técnica de un ambiente distinto del que firma hoy, y una ClTec del ambiente equivocado hace que la DIAN recalcule otro CUFE y rechace cada factura por FAD06 con el consecutivo ya gastado.'
      : '';

    return (
      header +
      '<br>' +
      lines +
      '<br><br>En cada una se sobrescribirá la clave técnica guardada con la que la DIAN tiene ligada a esa resolución: es justo el dato con el que la DIAN recalcula el CUFE.' +
      environmentNote +
      crossEnvironmentWarning +
      habilitationWarning +
      '<br><br>El backend decide qué campos son escribibles: los que la resolución ya consumió quedan como están y se te dirá cuáles fueron. Nada se emite ni se numera con esta acción.'
    );
  }

  formatDate(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : formatDateOnlyUTC(parsed);
  }

  /**
   * Identidad mínima para poder aplicar: sin `resolution_number` y `prefix` el
   * POST no puede apuntar a ninguna autorización.
   */
  private hasIdentity(range: DianNumberingRange): boolean {
    return !!range.resolution_number && !!range.prefix;
  }

  private presentValue(field: string, raw: unknown): string {
    if (raw === null || raw === undefined || raw === '') return '—';
    if (DATE_FIELDS.includes(field)) return this.formatDate(String(raw));
    return String(raw);
  }

  /** Lo que viene de la DIAN entra en un innerHTML: nunca crudo. */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Los controladores responden `{ success, data }`; algunos rails, el objeto pelado. */
  private unwrap(response: unknown): unknown {
    const envelope = response as { data?: unknown } | null;
    if (envelope && typeof envelope === 'object' && 'data' in envelope) {
      return envelope.data ?? null;
    }
    return response ?? null;
  }

  private messageOf(error: unknown): string {
    const candidate = error as {
      error?: { message?: string; error?: { message?: string } };
      message?: string;
    };
    return (
      candidate?.error?.message ??
      candidate?.error?.error?.message ??
      candidate?.message ??
      'No se pudo consultar la numeración en la DIAN.'
    );
  }
}
