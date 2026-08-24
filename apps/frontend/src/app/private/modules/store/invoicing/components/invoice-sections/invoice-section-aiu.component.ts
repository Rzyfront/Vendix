import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  effect,
} from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';

import { AlertBannerComponent } from '../../../../../../shared/components/alert-banner/alert-banner.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { SelectorComponent } from '../../../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { AccountCodeSelectComponent } from '../../../products/components/account-code-select.component';
import {
  AIU_COMPONENTS,
  formatPercentScaled,
  parsePercentScaled,
} from '../../../../../../core/utils/invoice-profile-config.contract';
import type {
  AiuBucket,
  AiuComponentLiteral,
  AiuComponentsBasis,
  AiuTaxableBasis,
  ProfileConfigIssue,
} from '../../../../../../core/utils/invoice-profile-config.contract';
import type { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import type { InvoiceSectionContext } from './invoice-section-context';
import { optionalControl, requireControl } from './invoice-section-controls';
import {
  AIU_COMPONENTS_BASIS_OPTIONS,
  AIU_COMPONENT_LABELS,
  AIU_MATRIX_BUCKET_OPTIONS,
  AIU_TAXABLE_BASIS_OPTIONS,
  AIU_TAX_CODE_OPTIONS,
  aiuBucketListLabel,
  aiuComponentUnitSuffix,
  aiuComponentsBasisExplainer,
  aiuComponentsSumOk,
  aiuComponentsSumScaled,
  aiuComponentsSumTarget,
  aiuCostRuleNote,
  aiuMinimumBaseHelp,
  aiuSuggestionPlan,
  aiuTaxCodeLabel,
  aiuTaxMatrixMismatchMessage,
  aiuTaxSuggestionOrigin,
  aiuTaxSuggestions,
  asAiuComponentsBasis,
  asAiuTaxableBasis,
  derivedCostTaxRule,
  reprojectAiuTaxRules,
} from './invoice-section-aiu.logic';
import type {
  AiuTaxRuleValue,
  AiuTaxSuggestion,
} from './invoice-section-aiu.logic';

/**
 * Una sugerencia YA RESUELTA para la plantilla: el tributo, de dónde sale, qué
 * escribiría y qué respetaría.
 *
 * Se arma en un `computed` y no en la plantilla porque la plantilla no puede
 * decidir nada: `applicable` depende de que la ley fije una tarifa Y de que
 * quede alguna porción donde escribirla, y esa conjunción escrita en un `@if`
 * sería la clase de regla que se duplica y luego divergirá del botón.
 */
interface AiuTaxSuggestionRow {
  tax_code: string;
  tax_label: string;
  /** Tarifa con su símbolo, o cadena vacía cuando no hay tarifa determinada. */
  rate_label: string;
  origin: string;
  caveat: string;
  /** ¿Hay algo que aplicar? Decide el botón, no la plantilla. */
  applicable: boolean;
  /** Porciones que recibirían la fila. Vacío si no hay ninguna. */
  writes_label: string;
  /** Porciones que ya declaran otro tributo y no se tocan. */
  keeps_label: string;
}

/** Rutas de los controles AIU en el formulario de la pantalla que los aloja. */
export interface AiuSectionPaths {
  taxable_basis: string;
  contract_object: string;
  enforce_minimum_base: string;
  minimum_base_percent: string;
  components_basis: string;
  /** Los tres porcentajes, por porción. */
  components: Readonly<Record<AiuComponentLiteral, string>>;
  /** Cuenta de ingreso por porción, incluido el costo reembolsable. */
  revenue_account: Readonly<Record<AiuBucket, string>>;
  /** IVA generado. Quinta cuenta de la sección. */
  vat_payable_account: string;
}

/**
 * Campos que pueden apartarse del perfil. La factura los calcula; el editor
 * de perfiles no manda ninguno, porque en un perfil no hay perfil del que
 * apartarse.
 */
export type AiuDepartureField =
  | 'taxable_basis'
  | 'contract_object'
  | 'enforce_minimum_base'
  | 'minimum_base_percent'
  | 'components_basis'
  | 'components'
  | 'accounts'
  | 'taxes';

const SECTION = 'AIU';

/**
 * La sección AIU, una sola vez, para las DOS pantallas que la capturan.
 *
 * ## Qué problema cierra
 *
 * «Nueva factura» tenía 359 líneas de sección AIU con **un** control editable
 * —el objeto del contrato— y todo lo demás en sólo lectura, remitiendo a
 * «Facturación → Perfiles». Corregir una base gravable obligaba a salir de la
 * pantalla de emisión, editar el perfil —creando una versión N+1 que afecta a
 * TODAS las facturas futuras— y volver. El editor de perfiles, en cambio, tenía
 * los controles completos con marcado propio. Dos marcados de la misma cosa es
 * lo que produjo la divergencia que este componente elimina: un arreglo urgente
 * se aplicaba en la pantalla donde se reportó y la otra quedaba atrás.
 *
 * ## Qué decide `context` y qué NO
 *
 * Decide **la ayuda contextual y la sugerencia de tributos**. No decide la
 * estructura ni qué controles existen: los mismos campos se pintan en las dos
 * pantallas, porque lo que cambia es el significado de dejar uno vacío, no el
 * campo. Un componente que escondiera controles según el contexto volvería a
 * ser dos secciones con un `@if` en medio.
 *
 * ## Por qué recibe RUTAS y no usa `formControlName`
 *
 * Las dos pantallas tienen los controles con otro nombre y en otro sitio: el
 * objeto del contrato es `aiu_contract_object` en la raíz del formulario de
 * factura y `aiu.contract_object` en el del perfil. Renombrar cualquiera de los
 * dos lados es un cambio de contrato con el backend, y del lado del perfil
 * además rompería la lectura de snapshots ya persistidos, que son inmutables a
 * propósito. Así que se recibe el `FormGroup` y un mapa de rutas, y se enlaza
 * con `[formControl]`. Ver `invoice-section-controls.ts`.
 *
 * ## La base y la matriz se escriben JUNTAS
 *
 * Escribir sólo `taxable_basis` deja la matriz contradiciendo a la base y el
 * guardado responde 422 sobre una casilla que la persona nunca tocó. La
 * reproyección va en una suscripción a `valueChanges` y **no** en un `computed`:
 * un `computed` sobre el valor de un `FormControl` no reacciona —el valor no es
 * una señal— y ese bug ya se pagó una vez en este mismo editor.
 */
@Component({
  selector: 'vendix-invoice-section-aiu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    ReactiveFormsModule,
    AccountCodeSelectComponent,
    AlertBannerComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    ToggleComponent,
  ],
  template: `
    <div class="space-y-4">
      <!--
        LA BASE GRAVABLE, no el régimen. Es la pregunta que el operador sabe
        contestar —«qué se grava»— y la única que puede decir «el contrato
        completo»: el régimen se DERIVA de ella al guardar. Cambiarla reproyecta
        la matriz de tributos en el MISMO acto.
      -->
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <app-selector
            label="Base gravable del contrato"
            [formControl]="taxableBasisControl()"
            [options]="basisOptions"
            size="sm"
            helpText="Qué porción del contrato lleva IVA. Al cambiarla, la matriz de tributos de abajo se reajusta sola para no contradecirla."
            [errorText]="issueFor('aiu.taxable_basis')"
          ></app-selector>
          @if (departed('taxable_basis')) {
            <p class="mt-1 flex items-start gap-1.5 text-[11px] text-warning">
              <app-icon name="git-branch" [size]="12" class="mt-0.5 shrink-0" />
              <span>{{ departureFieldNote }}</span>
            </p>
          }
          @if (frozen('taxable_basis')) {
            <p
              class="mt-1 flex items-start gap-1.5 text-[11px] text-text-secondary"
            >
              <app-icon name="lock" [size]="12" class="mt-0.5 shrink-0" />
              <span>{{ frozenReason() }}</span>
            </p>
          }
        </div>
        <div>
          <app-textarea
            label="Objeto del contrato"
            [formControl]="contractObjectControl()"
            [rows]="2"
            [helperText]="contractObjectHelp()"
            [error]="issueFor('aiu.contract_object')"
          ></app-textarea>
          @if (departed('contract_object')) {
            <p class="mt-1 flex items-start gap-1.5 text-[11px] text-warning">
              <app-icon name="git-branch" [size]="12" class="mt-0.5 shrink-0" />
              <span>{{ departureFieldNote }}</span>
            </p>
          }
        </div>
      </div>

      <!--
        AVISO DE ALCANCE. ADR-3 lo exige: «Exige mostrar en pantalla cuándo el
        documento se apartó del perfil, o el operador creerá que emitió con la
        configuración configurada». Se dice una vez, arriba, enumerando los
        campos, además de la marca por campo — un operador que pliega la sección
        no vería ninguna de las marcas.
      -->
      @if (departureSummary(); as summary) {
        <app-alert-banner
          variant="warning"
          icon="git-branch"
          tone="token"
          heading="Este documento se apartó de su perfil"
        >
          {{ summary }}
        </app-alert-banner>
      }

      <!-- ── BLOQUE 1 · Modelo de contabilización ── -->
      <div class="rounded-lg border border-border overflow-hidden">
        <div
          class="flex items-center gap-2 bg-[var(--color-surface-secondary)] px-3 py-2"
        >
          <app-icon
            name="git-branch"
            [size]="14"
            class="text-[var(--color-text-secondary)]"
          ></app-icon>
          <h4
            class="text-xs font-semibold uppercase tracking-wide text-text-primary"
          >
            Modelo de contabilización
          </h4>
        </div>
        <div class="p-3 space-y-2">
          <!--
            Los dos modelos NO son una bandera de presentación: cambian la forma
            del XML. En el sumado, A/I/U son LÍNEAS del documento. En el no
            sumado, el AIU deja de ser línea y pasa a ser sólo base de
            impuestos, lo que exige una línea cuya base gravable es MENOR que su
            propio importe. El segundo está deshabilitado a propósito y con el
            motivo a la vista: ofrecerlo antes de que el armado del XML esté
            verificado produciría documentos que la compuerta de totales rechaza
            al firmar, y el usuario no tendría forma de saber por qué.
          -->
          <div
            class="rounded-lg border-2 border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)] p-3"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-text-primary">
                  Base AIU sumada al total de la factura
                </p>
                <p
                  class="mt-1 text-xs leading-relaxed text-text-secondary"
                >
                  Administración, Imprevistos y Utilidad son líneas del
                  documento. El valor del contrato es su suma, y la base gravable
                  sólo la componen las líneas que la base declarada grava.
                </p>
              </div>
              <span
                class="shrink-0 rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-text-on-primary)]"
              >
                ACTIVO
              </span>
            </div>
          </div>

          <div
            class="rounded-lg border border-border bg-[var(--color-surface-muted)] p-3 opacity-70"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-text-primary">
                  Base AIU NO sumada al total de la factura
                </p>
                <p class="mt-1 text-xs leading-relaxed text-text-secondary">
                  El AIU deja de ser línea y pasa a ser sólo base de impuestos:
                  una línea por el valor del contrato, con una base gravable
                  menor que su propio importe.
                </p>
              </div>
              <span
                class="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-bold text-text-secondary"
              >
                NO DISPONIBLE
              </span>
            </div>
            <p
              class="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-warning"
            >
              <app-icon
                name="alert-triangle"
                [size]="13"
                class="mt-0.5 shrink-0"
              ></app-icon>
              <span>
                Cambia los totales monetarios del XML (FAU02, FAU04, FAU06). Se
                habilita cuando el armado del documento pase la compuerta de
                totales en los dos modelos; hasta entonces elegirlo produciría
                facturas rechazadas al firmar.
              </span>
            </p>
          </div>
        </div>
      </div>

      <!-- ── BLOQUE 2 · Cuentas para contabilización AIU ── -->
      <div class="rounded-lg border border-border overflow-hidden">
        <div
          class="flex items-center gap-2 bg-[var(--color-surface-secondary)] px-3 py-2"
        >
          <app-icon
            name="book-open"
            [size]="14"
            class="text-[var(--color-text-secondary)]"
          ></app-icon>
          <h4
            class="text-xs font-semibold uppercase tracking-wide text-text-primary"
          >
            Cuentas para contabilización AIU
          </h4>
        </div>
        <div class="p-3 space-y-2">
          <p class="text-xs text-text-secondary">
            Cuenta del PUC contra la que se reconoce el ingreso de cada porción,
            más el IVA generado. Vacío = se usa el mapeo contable de la tienda.
          </p>
          <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
            @for (component of components; track component) {
              <app-account-code-select
                [label]="componentLabel(component)"
                [formControl]="revenueAccountControl(component)"
                placeholder="Mapeo contable de la tienda"
                [error]="
                  issueFor('accounting.revenue_account_by_bucket.' + component)
                "
              ></app-account-code-select>
            }
          </div>
          <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
            <app-account-code-select
              label="Ingreso · Costo reembolsable"
              [formControl]="revenueAccountControl('costo')"
              placeholder="Mapeo contable de la tienda"
              [error]="issueFor('accounting.revenue_account_by_bucket.costo')"
            ></app-account-code-select>
            @if (vatPayableAccountControl(); as vatControl) {
              <app-account-code-select
                label="Cuenta de IVA por pagar"
                [formControl]="vatControl"
                placeholder="Mapeo contable de la tienda"
                [error]="issueFor('accounting.vat_payable_account')"
              ></app-account-code-select>
            }
          </div>
          @if (departed('accounts')) {
            <p class="flex items-start gap-1.5 text-[11px] text-warning">
              <app-icon name="git-branch" [size]="12" class="mt-0.5 shrink-0" />
              <span>{{ departureFieldNote }}</span>
            </p>
          }
        </div>
      </div>

      <!-- ── BLOQUE 3 · Base AIU ── -->
      <div class="rounded-lg border border-border overflow-hidden">
        <div
          class="flex items-center gap-2 bg-[var(--color-surface-secondary)] px-3 py-2"
        >
          <app-icon
            name="percent"
            [size]="14"
            class="text-[var(--color-text-secondary)]"
          ></app-icon>
          <h4
            class="text-xs font-semibold uppercase tracking-wide text-text-primary"
          >
            Base AIU
          </h4>
        </div>
        <div class="p-3 space-y-3">
          <p class="text-xs text-text-secondary">
            {{ componentsBasisExplainer() }}
          </p>
          <div class="md:max-w-xs">
            <app-selector
              label="Los porcentajes se miden sobre"
              [formControl]="componentsBasisControl()"
              [options]="componentsBasisOptions"
              size="sm"
              helpText="Los mismos tres números significan cosas distintas según la unidad. Los perfiles guardados antes de este campo usan «el AIU»."
            ></app-selector>
          </div>
          <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
            @for (component of components; track component) {
              <app-input
                [label]="componentLabel(component) + componentUnitSuffix()"
                [formControl]="componentControl(component)"
                type="text"
                size="sm"
                [control]="componentControl(component)"
                [error]="issueFor('aiu.components.' + component)"
              ></app-input>
            }
          </div>

          <div
            class="rounded-lg border px-3 py-2 text-xs md:text-sm"
            [class.border-danger]="!componentsSumOk()"
            [class.text-danger]="!componentsSumOk()"
            [class.border-border]="componentsSumOk()"
            [class.text-text-secondary]="componentsSumOk()"
            role="status"
          >
            Suma de componentes: {{ componentsSumLabel() }} %
            {{ componentsSumTarget() }}
          </div>
          @if (departed('components') || departed('components_basis')) {
            <p class="flex items-start gap-1.5 text-[11px] text-warning">
              <app-icon name="git-branch" [size]="12" class="mt-0.5 shrink-0" />
              <span>{{ departureFieldNote }}</span>
            </p>
          }

          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-end">
            <app-toggle
              [formControl]="enforceMinimumBaseControl()"
              label="Exigir base gravable mínima"
            ></app-toggle>
            <app-input
              label="Base mínima (% del valor del contrato)"
              [formControl]="minimumBasePercentControl()"
              type="text"
              size="sm"
              [control]="minimumBasePercentControl()"
              [error]="issueFor('aiu.minimum_base_percent')"
              [helperText]="minimumBaseHelp()"
            ></app-input>
          </div>
          @if (departed('minimum_base_percent') || departed('enforce_minimum_base')) {
            <p class="flex items-start gap-1.5 text-[11px] text-warning">
              <app-icon name="git-branch" [size]="12" class="mt-0.5 shrink-0" />
              <span>{{ departureFieldNote }}</span>
            </p>
          }
          @if (frozen('minimum_base_percent') || frozen('enforce_minimum_base')) {
            <p class="flex items-start gap-1.5 text-[11px] text-text-secondary">
              <app-icon name="lock" [size]="12" class="mt-0.5 shrink-0" />
              <span>{{ frozenReason() }}</span>
            </p>
          }
        </div>
      </div>

      <!-- ── BLOQUE 4 · Base impuestos ── -->
      <div class="rounded-lg border border-border overflow-hidden">
        <div
          class="flex items-center justify-between gap-2 bg-[var(--color-surface-secondary)] px-3 py-2"
        >
          <div class="flex items-center gap-2">
            <app-icon
              name="receipt"
              [size]="14"
              class="text-[var(--color-text-secondary)]"
            ></app-icon>
            <h4
              class="text-xs font-semibold uppercase tracking-wide text-text-primary"
            >
              Base impuestos
            </h4>
          </div>
          <!--
            «Agregar impuesto» y no «Regla»: la fila que crea es (impuesto,
            base, tarifa), y quien busca dónde añadir un IVA no reconoce
            «Regla» como el sitio.
          -->
          <app-button variant="secondary" size="sm" (clicked)="addTaxRule()">
            <app-icon slot="icon" name="plus" [size]="14"></app-icon>
            Agregar impuesto
          </app-button>
        </div>
        <div class="p-3 space-y-2">
          <p class="text-xs text-text-secondary">
            Qué impuesto grava qué base. Lo que aquí se marque gravable es lo que
            emite <code>cac:TaxTotal</code> en el XML; lo que no, no emite
            totalización alguna —y por eso no se rechaza por declarar una tarifa
            del 0 %—.
          </p>
          @if (aiuOfContractLabel(); as aiuPct) {
            <!-- Las bases del bloque 3, ya calculadas, para que elegir una base
                 acá no obligue a volver arriba a sumar de cabeza. -->
            <div
              class="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-border bg-[var(--color-surface-secondary)] px-3 py-2 text-xs text-text-secondary"
            >
              <span
                >Subtotal
                <strong class="text-text-primary">100.00 %</strong></span
              >
              <span
                >Base AIU
                <strong class="text-text-primary">{{ aiuPct }} %</strong></span
              >
              @if (utilidadOfContractLabel(); as utilidadPct) {
                <span
                  >Utilidad
                  <strong class="text-text-primary"
                    >{{ utilidadPct }} %</strong
                  ></span
                >
              }
              <span class="italic">del valor del contrato</span>
            </div>
          }
          @if (taxableBasis() === 'subtotal') {
            <app-alert-banner
              variant="warning"
              icon="alert-triangle"
              tone="token"
              heading="Esta base grava el contrato completo"
            >
              Con la base Subtotal se declina el tratamiento AIU: el IVA se
              calcula sobre el valor TOTAL del contrato —costo reembolsable
              incluido— y el piso del 10 % no aplica.
            </app-alert-banner>
          }
          <!--
            El costo reembolsable no tiene fila en esta matriz bajo ninguna
            base: su regla la escribe la base elegida, no una persona. Pero SE
            GUARDA, así que hay que decir qué se guardó: un dato fiscal que se
            persiste y no se puede leer en pantalla es peor que no tenerlo.
          -->
          <p class="text-[11px] italic leading-relaxed text-text-secondary">
            {{ costRuleNote() }}
          </p>
          @if (taxMatrixMismatch(); as mismatch) {
            <app-alert-banner
              variant="danger"
              icon="alert-triangle"
              tone="token"
            >
              {{ mismatch }}
            </app-alert-banner>
          }
          <!--
            Procedencia de la sugerencia de tributos. Es lo OTRO que decide
            «context»: en un perfil no hay adquiriente del que derivar
            responsabilidades fiscales, y el hueco tiene que leerse como una
            decisión y no como algo que se rompió.
          -->
          <p class="text-[11px] leading-relaxed text-text-secondary">
            {{ taxSuggestionNote }}
          </p>
          <!--
            LOS TRIBUTOS SUGERIDOS. Viven FUERA de la matriz hasta que alguien
            los aplica, y eso no es estética: si se aplicaran solos, un cliente
            marcado «Gran contribuyente» —agente de retención por ley— sembraría
            una retención que nadie pidió, y una retención RESTA de lo que se
            cobra. El operador vería un total menor sin haber tocado nada.

            Cada tarjeta dice de dónde sale (la responsabilidad del RUT, con
            nombre y código), qué habría que confirmar, y qué escribiría si se
            aplica. Las que la ley no tarifa no traen botón: proponer un
            porcentaje de retefuente sería inventarlo, y un número inventado en
            una casilla de impuestos se guarda igual que uno correcto.
          -->
          @if (taxSuggestionRows().length > 0) {
            <div
              class="rounded-lg border border-dashed border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_4%,transparent)] p-3 space-y-2"
            >
              <div class="flex items-start gap-1.5">
                <app-icon
                  name="lightbulb"
                  [size]="14"
                  class="mt-0.5 shrink-0 text-[var(--color-primary)]"
                ></app-icon>
                <p class="text-xs font-semibold text-text-primary">
                  Sugeridos por las responsabilidades fiscales del cliente
                </p>
              </div>
              <p class="text-[11px] leading-relaxed text-text-secondary">
                Nada de esto está aplicado. Son pistas del RUT del adquiriente,
                no conclusiones sobre este contrato: aplicar es una acción tuya,
                y lo que descartes no se vuelve a proponer.
              </p>
              @for (
                suggestion of taxSuggestionRows();
                track suggestion.tax_code
              ) {
                <div
                  class="rounded-lg border border-border bg-[var(--color-surface)] p-2.5"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 space-y-1">
                      <p class="text-sm font-semibold text-text-primary">
                        {{ suggestion.tax_label }}
                        @if (suggestion.rate_label) {
                          <span class="font-normal text-text-secondary">
                            · {{ suggestion.rate_label }}
                          </span>
                        }
                      </p>
                      <p
                        class="text-[11px] leading-relaxed text-text-secondary"
                      >
                        {{ suggestion.origin }}
                      </p>
                      <p class="text-[11px] leading-relaxed text-warning">
                        {{ suggestion.caveat }}
                      </p>
                      @if (suggestion.applicable) {
                        <p
                          class="text-[11px] leading-relaxed text-text-secondary"
                        >
                          Al aplicar se escribe en:
                          <strong class="text-text-primary">{{
                            suggestion.writes_label
                          }}</strong
                          >.
                        </p>
                      }
                      @if (suggestion.keeps_label) {
                        <p
                          class="text-[11px] leading-relaxed text-text-secondary"
                        >
                          {{ suggestion.keeps_label }}
                        </p>
                      }
                    </div>
                    <div class="flex shrink-0 items-center gap-1.5">
                      @if (suggestion.applicable) {
                        <app-button
                          variant="secondary"
                          size="sm"
                          (clicked)="applyTaxSuggestion(suggestion.tax_code)"
                        >
                          Aplicar
                        </app-button>
                      }
                      <app-button
                        variant="ghost"
                        size="sm"
                        ariaLabel="Descartar este tributo sugerido"
                        (clicked)="dismissTaxSuggestion(suggestion.tax_code)"
                      >
                        <app-icon slot="icon" name="x" [size]="15"></app-icon>
                      </app-button>
                    </div>
                  </div>
                </div>
              }
            </div>
          }
          @if (visibleTaxRules().length === 0) {
            <p class="text-xs italic text-text-secondary">
              Sin impuestos. El documento no declararía ninguno: agrégalos con el
              botón de arriba.
            </p>
          }
          <!--
            Se recorre «visibleTaxRules()» y NO el arreglo entero: la fila del
            costo reembolsable sigue EXISTIENDO en el formulario cuando la base
            la deja fuera —es la constancia de que ese costo estaba exento— pero
            no se pinta. Cada fila lleva su índice REAL, que es el que el
            «FormArray» y los mensajes del validador usan.
          -->
          <div class="space-y-2">
            @for (row of visibleTaxRules(); track row.index) {
              <div
                class="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2 md:grid-cols-5"
              >
                <app-selector
                  label="Impuesto"
                  [formControl]="ruleControl(row.index, 'tax_code')"
                  [options]="taxCodeOptions"
                  size="sm"
                ></app-selector>
                <app-selector
                  label="Base"
                  [formControl]="ruleControl(row.index, 'bucket')"
                  [options]="bucketOptions"
                  size="sm"
                ></app-selector>
                <app-input
                  label="Tarifa (%)"
                  [formControl]="ruleControl(row.index, 'rate')"
                  size="sm"
                  [error]="
                    issueFor('taxes.rules[' + row.index + '].rate')
                  "
                ></app-input>
                <div class="flex items-center pb-2">
                  <app-toggle
                    [formControl]="ruleControl(row.index, 'taxable')"
                    label="Gravable"
                  ></app-toggle>
                </div>
                <!--
                  SÓLO EL ICONO. La palabra «Quitar» repetida en cada fila no
                  aporta nada que el bote de basura no diga, y ensancha el botón
                  hasta empujar los campos. El nombre accesible viaja en
                  «ariaLabel»: sin él, un botón de sólo icono se anuncia sin
                  nombre.
                -->
                <app-button
                  variant="outline-danger"
                  size="sm"
                  ariaLabel="Quitar esta regla de impuesto"
                  (clicked)="removeTaxRule(row.index)"
                >
                  <app-icon slot="icon" name="trash-2" [size]="15"></app-icon>
                </app-button>
              </div>
            }
          </div>
          @if (departed('taxes')) {
            <p class="flex items-start gap-1.5 text-[11px] text-warning">
              <app-icon name="git-branch" [size]="12" class="mt-0.5 shrink-0" />
              <span>{{ departureFieldNote }}</span>
            </p>
          }
        </div>
      </div>
    </div>
  `,
})
export class InvoiceSectionAiuComponent {
  private readonly fb = inject(FormBuilder);

  /** En qué pantalla se pinta. Decide la ayuda y la sugerencia de tributos. */
  readonly context = input.required<InvoiceSectionContext>();

  /** Formulario de la pantalla. Las rutas se resuelven contra él. */
  readonly form = input.required<FormGroup>();

  /** Dónde vive cada control AIU en ese formulario. */
  readonly paths = input.required<AiuSectionPaths>();

  /** La matriz de gravabilidad, como arreglo de filas del formulario. */
  readonly taxRules = input.required<FormArray>();

  /** Problemas que devolvió el validador del contrato, por campo. */
  readonly issues = input<readonly ProfileConfigIssue[]>([]);

  /** Campos en los que este documento se apartó del perfil que lo precargó. */
  readonly departures = input<readonly AiuDepartureField[]>([]);

  /**
   * Campos que la pantalla que aloja la sección NO PUEDE PERSISTIR hoy.
   *
   * No es lo mismo que `context` y por eso no se deriva de él: `context` dice
   * en qué pantalla estamos, y esto dice qué puede guardar el endpoint de esa
   * pantalla. Son dos hechos distintos y el segundo cambia solo cuando el
   * backend cambia.
   *
   * Los controles se pintan igual —la estructura es la misma en las dos
   * pantallas— pero se DESHABILITAN, porque un control que acepta un valor que
   * el servidor va a ignorar es la peor variante del error de este módulo:
   * la pantalla instruye sobre una base gravable y el documento se emite con
   * otra, la DIAN acepta el XML porque cuadra consigo mismo, y el faltante sólo
   * aparece en una fiscalización.
   */
  readonly frozenFields = input<readonly AiuDepartureField[]>([]);

  /** Por qué están congelados. Se pinta junto a ellos; obligatorio si hay. */
  readonly frozenReason = input<string>('');

  /**
   * Responsabilidades fiscales del ADQUIRIENTE — campo 9 de su RUT.
   *
   * Es el único dato de fuera de la sección que entra acá, y entra como valor
   * plano y no como ruta del formulario a propósito: no es un control del AIU
   * —vive en el bloque del adquiriente— y la sección no debe poder escribirlo.
   * De él sale la SUGERENCIA de tributos, que propone y nunca aplica.
   *
   * Vacío en el editor de perfiles, donde no hay adquiriente: un perfil se
   * configura antes de saber a quién se le factura. La pantalla lo dice en vez
   * de dejar el hueco, ver `taxSuggestionNote`.
   */
  readonly customerFiscalResponsibilities = input<readonly string[]>([]);

  readonly components = AIU_COMPONENTS;
  // Copias mutables de las listas del módulo de lógica: `app-selector` declara
  // `options` como `SelectorOption[]`, y un `readonly` no es asignable a él
  // bajo `strictTemplates`.
  readonly basisOptions: SelectorOption[] = [...AIU_TAXABLE_BASIS_OPTIONS];
  readonly componentsBasisOptions: SelectorOption[] = [
    ...AIU_COMPONENTS_BASIS_OPTIONS,
  ];
  readonly bucketOptions: SelectorOption[] = [...AIU_MATRIX_BUCKET_OPTIONS];
  readonly taxCodeOptions: SelectorOption[] = [...AIU_TAX_CODE_OPTIONS];

  readonly departureFieldNote =
    'Distinto de lo que trae el perfil. Se aplica a ESTE documento y no toca el perfil.';

  /**
   * Revisión del formulario.
   *
   * `FormGroup.value` es una propiedad plana, no una señal: leerla dentro de un
   * `computed` lo congelaría en el estado inicial —el bug que este repo ya pagó
   * con un botón «Guardar» permanentemente deshabilitado—. Este contador es el
   * puente: lo bombea una suscripción y todo lo derivado lo lee primero.
   */
  private readonly revision = signal(0);

  constructor() {
    // Puente formulario → señal. Se resuscribe si la pantalla cambia el grupo.
    effect((onCleanup) => {
      const group = this.form();
      const rules = this.taxRules();
      const bump = (): void => this.revision.update((value) => value + 1);
      const groupSub = group.valueChanges.subscribe(bump);
      const rulesSub = rules.valueChanges.subscribe(bump);
      onCleanup(() => {
        groupSub.unsubscribe();
        rulesSub.unsubscribe();
      });
    });

    // CONGELADO DE CONTROLES NO PERSISTIBLES. Se hace sobre el control y no con
    // un `[disabled]` en la plantilla: `app-selector`, `app-input` y
    // `app-toggle` son CVAs, y en Reactive Forms mezclar `[disabled]` con un
    // `formControl` deja el control habilitado en el modelo aunque se vea gris
    // —la advertencia que Angular imprime como `ReactiveFormsModule`— así que el
    // valor seguiría viajando.
    effect(() => {
      const frozen = new Set(this.frozenFields());
      const pairs: ReadonlyArray<readonly [AiuDepartureField, FormControl]> = [
        ['taxable_basis', this.taxableBasisControl()],
        ['contract_object', this.contractObjectControl()],
        ['components_basis', this.componentsBasisControl()],
        ['enforce_minimum_base', this.enforceMinimumBaseControl()],
        ['minimum_base_percent', this.minimumBasePercentControl()],
      ];
      for (const [field, control] of pairs) {
        const shouldFreeze = frozen.has(field);
        if (shouldFreeze === control.disabled) continue;
        // `emitEvent: false`: habilitar o deshabilitar no es un cambio de valor
        // y emitirlo re-dispararía la reproyección de la matriz.
        if (shouldFreeze) control.disable({ emitEvent: false });
        else control.enable({ emitEvent: false });
      }
    });

    // LA BASE Y LA MATRIZ SE ESCRIBEN JUNTAS. Suscripción y no `computed`: el
    // valor de un `FormControl` no es una señal, así que un `computed` sobre él
    // se evaluaría una vez y no volvería a reaccionar nunca.
    //
    // La hidratación de las dos pantallas pasa por `patchValue({ emitEvent:
    // false })`, así que abrir un documento o un perfil existente NO dispara
    // esto: sólo lo dispara cambiar la base a mano, que es cuando hay algo que
    // reproyectar.
    effect((onCleanup) => {
      const control = this.taxableBasisControl();
      const sub = control.valueChanges.subscribe((value) => {
        this.reprojectTaxMatrix(asAiuTaxableBasis(value));
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  // ── Controles ───────────────────────────────────────────────────────────

  readonly taxableBasisControl = computed<FormControl>(
    () =>
      requireControl(
        this.form(),
        this.paths().taxable_basis,
        SECTION,
      ) as FormControl,
  );

  readonly contractObjectControl = computed<FormControl>(
    () =>
      requireControl(
        this.form(),
        this.paths().contract_object,
        SECTION,
      ) as FormControl,
  );

  readonly componentsBasisControl = computed<FormControl>(
    () =>
      requireControl(
        this.form(),
        this.paths().components_basis,
        SECTION,
      ) as FormControl,
  );

  readonly enforceMinimumBaseControl = computed<FormControl>(
    () =>
      requireControl(
        this.form(),
        this.paths().enforce_minimum_base,
        SECTION,
      ) as FormControl,
  );

  readonly minimumBasePercentControl = computed<FormControl>(
    () =>
      requireControl(
        this.form(),
        this.paths().minimum_base_percent,
        SECTION,
      ) as FormControl,
  );

  /**
   * La quinta cuenta es OPCIONAL en el mapa a propósito: una pantalla que no
   * tenga dónde guardar el IVA generado no debe reventar por eso, y el campo
   * simplemente no se pinta. Las otras cuatro sí son obligatorias — un campo
   * fiscal que desaparece de la pantalla y viaja ausente al backend es peor que
   * un error en desarrollo.
   */
  readonly vatPayableAccountControl = computed<FormControl | null>(
    () =>
      optionalControl(
        this.form(),
        this.paths().vat_payable_account,
      ) as FormControl | null,
  );

  componentControl(component: AiuComponentLiteral): FormControl {
    return requireControl(
      this.form(),
      this.paths().components[component],
      SECTION,
    ) as FormControl;
  }

  revenueAccountControl(bucket: AiuBucket): FormControl {
    return requireControl(
      this.form(),
      this.paths().revenue_account[bucket],
      SECTION,
    ) as FormControl;
  }

  ruleControl(index: number, name: string): FormControl {
    const row = this.taxRules().at(index) as FormGroup;
    return requireControl(row, name, SECTION) as FormControl;
  }

  // ── Lecturas derivadas ──────────────────────────────────────────────────

  componentLabel(component: AiuComponentLiteral): string {
    return AIU_COMPONENT_LABELS[component];
  }

  taxableBasis(): AiuTaxableBasis {
    this.revision();
    return asAiuTaxableBasis(this.taxableBasisControl().value);
  }

  componentsBasis(): AiuComponentsBasis {
    this.revision();
    return asAiuComponentsBasis(this.componentsBasisControl().value);
  }

  /** Las filas del formulario como valores planos, para la lógica pura. */
  private ruleValues(): AiuTaxRuleValue[] {
    this.revision();
    return this.taxRules().controls.map((control) => ({
      bucket: String(control.get('bucket')?.value ?? '') as AiuBucket,
      taxable: Boolean(control.get('taxable')?.value),
      tax_code: String(control.get('tax_code')?.value ?? ''),
      rate: String(control.get('rate')?.value ?? '0.00'),
    }));
  }

  /**
   * Las filas que se PINTAN, con su índice real.
   *
   * La del costo reembolsable nunca se pinta bajo ninguna base, pero siempre
   * existe: la escribe la base elegida, y quitarla del formulario haría que
   * bajo «Subtotal» el guardado saliera 422 `TAX_RULE_MISSING`.
   */
  readonly visibleTaxRules = computed<{ index: number; bucket: string }[]>(
    () => {
      this.revision();
      return this.taxRules()
        .controls.map((control, index) => ({
          index,
          bucket: String(control.get('bucket')?.value ?? ''),
        }))
        .filter((row) => row.bucket !== 'costo');
    },
  );

  componentsSumLabel(): string {
    return formatPercentScaled(this.componentsSumScaled());
  }

  private componentsSumScaled(): number {
    this.revision();
    const values: Partial<Record<AiuComponentLiteral, unknown>> = {};
    for (const component of AIU_COMPONENTS) {
      values[component] = this.componentControl(component).value;
    }
    return aiuComponentsSumScaled(values);
  }

  componentsSumOk(): boolean {
    return aiuComponentsSumOk({
      componentsBasis: this.componentsBasis(),
      taxableBasis: this.taxableBasis(),
      sumScaled: this.componentsSumScaled(),
      floorScaled: parsePercentScaled(this.minimumBasePercentControl().value),
      enforceFloor: this.enforceMinimumBaseControl().value === true,
    });
  }

  componentsSumTarget(): string {
    return aiuComponentsSumTarget(this.componentsBasis());
  }

  componentUnitSuffix(): string {
    return aiuComponentUnitSuffix(this.componentsBasis());
  }

  componentsBasisExplainer(): string {
    return aiuComponentsBasisExplainer(this.componentsBasis());
  }

  minimumBaseHelp(): string {
    return aiuMinimumBaseHelp(this.taxableBasis());
  }

  costRuleNote(): string {
    return aiuCostRuleNote(this.ruleValues(), this.taxableBasis());
  }

  taxMatrixMismatch(): string | null {
    return aiuTaxMatrixMismatchMessage(this.ruleValues(), this.taxableBasis());
  }

  /**
   * El AIU como porcentaje del contrato. Sólo existe con la unidad
   * `'contract'`: con la unidad `'aiu'` la suma es siempre 100 y no dice nada
   * del contrato, así que devolver un 100 % se leería como «todo el contrato es
   * AIU».
   */
  aiuOfContractLabel(): string | null {
    if (this.componentsBasis() !== 'contract') return null;
    return formatPercentScaled(this.componentsSumScaled());
  }

  /**
   * La utilidad como porcentaje del contrato. Bajo el Decreto 1372/1992 es,
   * literalmente, la base gravable del documento — el número que hay que
   * revisar dos veces.
   */
  utilidadOfContractLabel(): string | null {
    this.revision();
    if (this.componentsBasis() !== 'contract') return null;
    const scaled = parsePercentScaled(this.componentControl('utilidad').value);
    return scaled === null ? null : formatPercentScaled(scaled);
  }

  // ── Ayuda contextual: lo ÚNICO que decide `context` ─────────────────────

  contractObjectHelp(): string {
    return this.context() === 'invoice'
      ? 'Se guarda con la factura, así que el documento conserva el contrato que describía aunque el perfil cambie el suyo después. Vacío hereda el del perfil o el de la tienda.'
      : 'Se puede sobrescribir en cada factura. Vacío se permite guardar, pero la emisión lo exige: sin objeto de contrato el documento se rechaza antes de tomar consecutivo.';
  }

  get taxSuggestionNote(): string {
    return this.context() === 'invoice'
      ? 'La matriz aplica a ESTE documento. Cambiarla no crea una versión nueva del perfil.'
      : 'Acá no hay adquiriente, así que no hay tributos sugeridos: un perfil se configura antes de saber a quién se le factura. La sugerencia por responsabilidades fiscales del cliente sólo existe al emitir.';
  }

  // ── Sugerencia de tributos: PROPONE, nunca aplica ───────────────────────
  //
  // Las cinco propiedades de C.4, y dónde vive cada una:
  //  · sólo en contexto «invoice» ......... `taxSuggestions`, primer return
  //  · nada se aplica sin acción .......... no hay escritura fuera de
  //                                        `applyTaxSuggestion`, que es un
  //                                        (clicked) de la plantilla
  //  · la procedencia se dice ............. `aiuTaxSuggestionOrigin`
  //  · lo quitado no vuelve ............... `dismissedTaxSuggestions`
  //  · en el perfil se explica ............ `taxSuggestionNote`, rama 'profile'

  /**
   * Huella de las responsabilidades, como CADENA.
   *
   * Tiene que ser una cadena y no el arreglo: la pantalla que aloja la sección
   * recalcula su lista en cada cambio del formulario, así que la referencia del
   * arreglo cambia con cada tecla aunque el contenido sea el mismo. Comparada
   * por referencia, esa huella «cambiaría» constantemente y borraría los
   * descartes en cada pulsación —reponiendo justo el tributo que la persona
   * acaba de quitar—. Comparada como cadena, sólo cambia cuando cambia el
   * cliente o cuando alguien edita sus responsabilidades a mano.
   */
  private readonly responsibilitiesKey = computed<string>(() =>
    [...this.customerFiscalResponsibilities()]
      .map((code) => String(code ?? '').trim())
      .filter((code) => code.length > 0)
      .sort()
      .join(','),
  );

  /**
   * Tributos que la persona QUITÓ o descartó, por código.
   *
   * Es la memoria que hace que una sugerencia no vuelva. Sin ella la sugerencia
   * se recalcularía sobre el estado actual de la matriz, así que quitar la fila
   * la devolvería a la lista de sugeridos y volvería a ofrecerla: el operador
   * quita, la pantalla repone. Se alimenta desde los dos caminos por los que un
   * tributo sugerido desaparece —el botón «Descartar» y el bote de basura de la
   * fila—, porque los dos significan lo mismo.
   *
   * `linkedSignal` y no `signal`: cuando cambia el ADQUIRIENTE cambian sus
   * responsabilidades, y con ellas la decisión. Los descartes del cliente
   * anterior no pueden esconder un tributo que el nuevo sí insinúa. La fuente
   * es la huella en cadena, no el arreglo, por lo dicho arriba.
   */
  private readonly dismissedTaxSuggestions = linkedSignal<
    string,
    readonly string[]
  >({
    source: () => this.responsibilitiesKey(),
    computation: () => [],
  });

  /** Las sugerencias vivas, ya filtradas por descartes y por lo ya declarado. */
  private readonly taxSuggestions = computed<AiuTaxSuggestion[]>(() => {
    if (this.context() !== 'invoice') return [];
    return aiuTaxSuggestions({
      responsibilities: this.customerFiscalResponsibilities(),
      rules: this.ruleValues(),
      dismissed: new Set(this.dismissedTaxSuggestions()),
    });
  });

  /** Lo que la plantilla pinta: sugerencia, procedencia y alcance. */
  readonly taxSuggestionRows = computed<AiuTaxSuggestionRow[]>(() => {
    const basis = this.taxableBasis();
    const rules = this.ruleValues();
    return this.taxSuggestions().map((suggestion) => {
      const plan = aiuSuggestionPlan({ suggestion, rules, basis });
      const keeps = plan.keeps
        .map(
          (kept) =>
            AIU_COMPONENT_LABELS[kept.bucket] +
            ' ya declara ' +
            aiuTaxCodeLabel(kept.tax_code),
        )
        .join('; ');
      return {
        tax_code: suggestion.tax_code,
        tax_label: suggestion.tax_label,
        rate_label: suggestion.rate === null ? '' : suggestion.rate + ' %',
        origin: aiuTaxSuggestionOrigin(suggestion),
        caveat: suggestion.caveat,
        // Aplicable exige las DOS cosas: una tarifa que la ley fije, y alguna
        // porción donde escribirla. Un botón que no escribiera nada sería peor
        // que no tenerlo: la persona lo pulsaría y creería que quedó aplicado.
        applicable: suggestion.rate !== null && plan.writes.length > 0,
        writes_label: aiuBucketListLabel(plan.writes),
        // Sólo se dice qué se respeta cuando aplicar es posible: en una
        // sugerencia sin tarifa nada se va a escribir, y enumerar lo que «no se
        // toca» sugeriría que algo sí se toca.
        keeps_label:
          suggestion.rate !== null && keeps ? keeps + ', y no se toca.' : '',
      };
    });
  });

  /**
   * Aplica una sugerencia. ES UN ACTO EXPLÍCITO y el único escritor.
   *
   * Escribe UNA fila por porción que la base grava, respetando la que ya
   * declara otro tributo: la matriz admite una sola regla por porción
   * —`TAX_BUCKET_DUPLICATED` rechaza dos— así que escribir encima no añadiría
   * un tributo, reemplazaría el que alguien eligió.
   *
   * NO llama a la reproyección completa: reproyectar volteando también las
   * porciones que hoy contradicen la base sería un efecto que nadie pidió al
   * pulsar «Aplicar», y la sección ya avisa de esa contradicción por su cuenta.
   * Lo único que sí se sincroniza es la fila del costo, porque su tarifa se
   * DERIVA de la de las porciones y acaba de cambiar.
   */
  applyTaxSuggestion(taxCode: string): void {
    const suggestion = this.taxSuggestions().find(
      (candidate) => candidate.tax_code === taxCode,
    );
    if (!suggestion || suggestion.rate === null) return;

    const basis = this.taxableBasis();
    const rules = this.taxRules();
    const plan = aiuSuggestionPlan({
      suggestion,
      rules: this.ruleValues(),
      basis,
    });

    for (const bucket of plan.writes) {
      const index = this.taxRules().controls.findIndex(
        (control) => String(control.get('bucket')?.value ?? '') === bucket,
      );
      if (index >= 0) {
        const control = rules.at(index);
        control.patchValue({
          taxable: true,
          tax_code: suggestion.tax_code,
          rate: suggestion.rate,
        });
        control.markAsDirty();
        continue;
      }
      rules.push(
        this.fb.group({
          bucket: [bucket],
          taxable: [true],
          tax_code: [suggestion.tax_code],
          rate: [suggestion.rate],
        }),
      );
    }
    // Aplicar es una decisión sobre ESTE documento: la matriz queda `dirty` para
    // que un cambio de perfil posterior avise de que la reemplazaría.
    rules.markAsDirty();
    this.syncCostRule(basis);
  }

  /** «No aplica a este contrato». Se recuerda: no se vuelve a proponer. */
  dismissTaxSuggestion(taxCode: string): void {
    this.dismissedTaxSuggestions.update((codes) =>
      codes.includes(taxCode) ? codes : [...codes, taxCode],
    );
  }

  /**
   * Sincroniza la fila del costo reembolsable con la base y las tarifas de
   * arriba, sin tocar nada más.
   *
   * Bajo «Subtotal» el costo grava con la tarifa de referencia de las porciones,
   * así que aplicar un tributo la cambia; bajo las otras dos bases la fila queda
   * exenta y su ausencia o su tarifa sobrante son dos 422 distintos
   * (`TAX_RULE_MISSING`, `TAX_RATE_ON_NON_TAXABLE`).
   */
  private syncCostRule(basis: AiuTaxableBasis): void {
    const rules = this.taxRules();
    const derived = derivedCostTaxRule(this.ruleValues(), basis);
    const index = rules.controls.findIndex(
      (control) => String(control.get('bucket')?.value ?? '') === 'costo',
    );
    if (index < 0) {
      rules.push(
        this.fb.group({
          bucket: [derived.bucket],
          taxable: [derived.taxable],
          tax_code: [derived.tax_code],
          rate: [derived.rate],
        }),
      );
      return;
    }
    const control = rules.at(index);
    if (
      Boolean(control.get('taxable')?.value) === derived.taxable &&
      String(control.get('tax_code')?.value ?? '') === derived.tax_code &&
      String(control.get('rate')?.value ?? '') === derived.rate
    ) {
      return;
    }
    control.patchValue({
      taxable: derived.taxable,
      tax_code: derived.tax_code,
      rate: derived.rate,
    });
  }

  // ── Apartamiento del perfil ─────────────────────────────────────────────

  departed(field: AiuDepartureField): boolean {
    return this.departures().includes(field);
  }

  frozen(field: AiuDepartureField): boolean {
    return this.frozenFields().includes(field);
  }

  /** ¿Hay algo congelado? Decide el aviso de alcance de la sección. */
  readonly hasFrozenFields = computed<boolean>(
    () => this.frozenFields().length > 0,
  );

  private static readonly DEPARTURE_LABELS: Readonly<
    Record<AiuDepartureField, string>
  > = {
    taxable_basis: 'la base gravable',
    contract_object: 'el objeto del contrato',
    enforce_minimum_base: 'la exigencia del piso',
    minimum_base_percent: 'el porcentaje del piso',
    components_basis: 'la unidad de los porcentajes',
    components: 'el reparto del AIU',
    accounts: 'las cuentas contables',
    taxes: 'la matriz de tributos',
  };

  readonly departureSummary = computed<string | null>(() => {
    const fields = this.departures();
    if (fields.length === 0) return null;
    const named = fields
      .map((field) => InvoiceSectionAiuComponent.DEPARTURE_LABELS[field])
      .filter((label): label is string => !!label);
    return (
      'Se cambió ' +
      named.join(', ') +
      ' respecto de lo que trae el perfil. El cambio vale para este documento y ' +
      'no modifica el perfil ni crea una versión nueva. Revísalo antes de emitir: ' +
      'el consecutivo se gasta al emitir y una base gravable equivocada sólo se ' +
      'corrige con nota crédito.'
    );
  });

  // ── Problemas del validador ─────────────────────────────────────────────

  issueFor(field: string): string {
    const issue = this.issues().find((candidate) => candidate.field === field);
    return issue ? issue.message : '';
  }

  // ── Acciones ────────────────────────────────────────────────────────────

  addTaxRule(): void {
    this.taxRules().push(
      this.fb.group({
        bucket: ['administracion'],
        taxable: [true],
        tax_code: ['01'],
        rate: ['19.00'],
      }),
    );
    this.taxRules().markAsDirty();
  }

  /**
   * Quita una fila de la matriz — y RECUERDA el tributo que llevaba.
   *
   * Recordarlo es lo que cierra la casilla «quitar un tributo sugerido no lo
   * vuelve a poner». La sugerencia se calcula sobre lo que la matriz declara,
   * así que sin esta anotación quitar la fila devolvería el tributo a la lista
   * de sugeridos y la pantalla lo volvería a ofrecer, en el sitio exacto donde
   * la persona acaba de decir que no. Se anota el código pase lo que pase: no
   * proponer de más es el lado seguro del error.
   */
  removeTaxRule(index: number): void {
    const removed = String(
      this.taxRules().at(index)?.get('tax_code')?.value ?? '',
    ).trim();
    this.taxRules().removeAt(index);
    this.taxRules().markAsDirty();
    if (removed) this.dismissTaxSuggestion(removed);
  }

  /**
   * Escribe la matriz reproyectada sobre la base recién elegida.
   *
   * Se escribe con `emitEvent` por omisión a propósito: la pantalla se redibuja
   * por `valueChanges`, así que un `emitEvent:false` dejaría la matriz
   * reproyectada en el modelo y sin reproyectar en pantalla.
   */
  private reprojectTaxMatrix(basis: AiuTaxableBasis): void {
    const rules = this.taxRules();
    const before = rules.length;
    const projected = reprojectAiuTaxRules(this.ruleValues(), basis);

    for (let index = 0; index < rules.length; index++) {
      const control = rules.at(index);
      const next = projected[index];
      if (!next) continue;
      const current = {
        taxable: Boolean(control.get('taxable')?.value),
        tax_code: String(control.get('tax_code')?.value ?? ''),
        rate: String(control.get('rate')?.value ?? ''),
      };
      if (
        current.taxable === next.taxable &&
        current.tax_code === next.tax_code &&
        current.rate === next.rate
      ) {
        continue;
      }
      control.patchValue({
        taxable: next.taxable,
        tax_code: next.tax_code,
        rate: next.rate,
      });
      control.markAsDirty();
    }

    // La fila del costo que la reproyección AÑADIÓ. Nunca se borra: bajo
    // `subtotal` su ausencia es un 422 y bajo las otras dos su presencia es la
    // constancia de que ese costo quedó fuera de la base.
    for (let index = before; index < projected.length; index++) {
      const extra = projected[index];
      rules.push(
        this.fb.group({
          bucket: [extra.bucket],
          taxable: [extra.taxable],
          tax_code: [extra.tax_code],
          rate: [extra.rate],
        }),
      );
    }
    if (projected.length !== before) rules.markAsDirty();
  }
}
