import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { IconComponent } from '../icon/icon.component';
import { InputComponent } from '../input/input.component';
import { SelectorComponent } from '../selector/selector.component';
import type { SelectorOption } from '../selector/selector.component';
import { ToggleComponent } from '../toggle/toggle.component';
import { optionalControl } from './invoice-section-controls';
import type { InvoiceSectionContext } from './invoice-section-context';
import { isInvoiceContext, isProfileContext } from './invoice-section-context';

const SECTION = 'Formato';

/** FORMAT_TYPE del formato fiscal, único tipo que las dos pantallas comparten. */
export const FISCAL_INVOICE_FORMAT_TYPE = 'fiscal_electronic_invoice' as const;

/**
 * Dónde vive cada campo. En contexto `profile` las cuatro rutas existen; en
 * `invoice` el contrato de creación NO declara ninguno (`CreateInvoiceDto` no
 * trae `template_id`, `show_aiu_breakdown` ni `display_decimals`), así que la
 * página pasa `null` y los controles de perfil no se pintan: un selector que
 * escribiera donde el servidor no lee sería el fallo mudo de este módulo.
 */
export interface FormatoSectionPaths {
  template_id: string | null;
  template_key: string | null;
  show_aiu_breakdown: string | null;
  display_decimals: string | null;
}

/**
 * Sección «Formato de impresión»: B.7 del plan CP-INVOICE-PROFILE-MIRROR-AIU.
 *
 * ## Qué comparte y qué no
 *
 * El PERFIL elige plantilla, desglose AIU y decimales: tres controles que se
 * congelan con cada versión y rigen todas las facturas que nazcan de él.
 * La FACTURA no puede elegir nada de eso por documento —el DTO no lo declara y
 * añadirlo es decisión de contrato (reclasificación de B.7)—; lo que sí muestra
 * es CON QUÉ se va a imprimir este documento (la plantilla congelada por su
 * perfil, o la activa de la tienda) y le permite mantener la plantilla ACTIVA
 * DE TIENDA contra la biblioteca de la organización, que es la única superficie
 * de escritura real (`PUT /store/print-formats/:formatType`).
 *
 * ## La biblioteca es de la ORGANIZACIÓN
 *
 * `print_templates` se consulta sin filtro de tienda a propósito: una
 * organización comparte sus diseños entre tiendas. Lo dice la pantalla porque
 * quien viene de «ajustes de tienda» espera un catálogo propio.
 *
 * ## El formato no toca el XML
 *
 * Ni este componente ni la página calculan importes: cambiar de plantilla sólo
 * cambia lo que ve el cliente. Si algún día un valor llegara al XML desde aquí,
 * la garantía fiscal de E.1 («el papel dice lo mismo que la DIAN») se rompería
 * en silencio.
 */
@Component({
  selector: 'vendix-invoice-section-formato',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    ReactiveFormsModule,
    RouterLink,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
  ],
  template: `
    <!-- Biblioteca de la ORGANIZACIÓN: lo dicen las dos pantallas, porque es
         la pregunta que siempre surge («¿por qué veo plantillas de otra
         tienda?» — no son de otra tienda, son de la misma organización). -->
    <div
      class="mb-3 flex items-start gap-2.5 rounded-lg border border-border bg-[var(--color-surface-muted)] px-3 py-2.5"
    >
      <app-icon
        name="info"
        [size]="15"
        class="mt-0.5 shrink-0 text-[var(--color-text-secondary)]"
      ></app-icon>
      <p class="text-xs leading-relaxed text-text-secondary">
        @if (isProfile()) {
          El diseño del documento —papel, secciones, columnas y estilos— se
          edita en el
          <a
            routerLink="/admin/settings/print-formats"
            class="font-semibold text-[var(--color-primary)] underline underline-offset-2"
            >Hub de formatos de impresión</a
          >, sobre el formato <strong>Factura Electrónica (DIAN)</strong>.
          Aquí sólo se elige la plantilla con que este perfil imprime y qué se
          muestra en ella.
        } @else {
          El diseño se edita en el
          <a
            routerLink="/admin/settings/print-formats"
            class="font-semibold text-[var(--color-primary)] underline underline-offset-2"
            >Hub de formatos de impresión</a
          >. La biblioteca es de la <strong>ORGANIZACIÓN</strong>: la comparten
          todas sus tiendas. Cambiar el formato no altera ningún importe del XML.
        }
      </p>
    </div>

    <div class="space-y-3">
      <app-selector
        label="Plantilla de impresión"
        [formControl]="templateIdControl()!"
        [options]="templateOptions()"
        size="sm"
        [errorText]="errors().template_id ?? ''"
        [helpText]="
          isInvoice()
            ? 'Elegir una plantilla la guarda para TODA la tienda: rige los documentos que se imprimen sin plantilla congelada por un perfil.'
            : 'La factura se imprime con la plantilla que el perfil tenía al emitirse, no con la que la tienda tenga activa después.'
        "
        [disabled]="storeTemplateSaving()"
        (valueChange)="onTemplateSelection($event)"
      ></app-selector>

      @if (libraryFailed()) {
        <p class="text-[11px] text-warning">
          No se pudo leer la biblioteca del Hub.
          @if (isProfile()) {
            El perfil se guarda igual y la factura se imprimirá con la
            plantilla activa de la tienda.
          } @else {
            El documento se imprimirá con la plantilla activa de la tienda.
          }
        </p>
      }

      @if (isInvoice() && effectivePrintLabel()) {
        <!-- CON QUÉ se imprime ESTE documento: la precedencia real del
             gateway es plantilla congelada por el perfil → plantilla activa
             de la tienda → defecto del sistema. Sin esta línea, quien elige
             una plantilla cree que ésta va a salir en su factura cuando su
             perfil tiene otra congelada. -->
        <div
          class="flex items-start gap-2 rounded-lg border border-border px-3 py-2"
        >
          <app-icon
            name="printer"
            [size]="14"
            class="mt-0.5 shrink-0 text-[var(--color-text-secondary)]"
          ></app-icon>
          <p class="text-xs leading-relaxed text-text-primary">
            Este documento se imprime con:
            <strong>{{ effectivePrintLabel() }}</strong>
          </p>
        </div>
      }

      @if (legacyKeyControl(); as legacyControl) {
        <!--
          LEGADO. Sólo se muestra si el perfil guardado ya trae una clave de
          «default_templates». No se borra en silencio: hay perfiles con este
          dato y borrarlo al guardar cambiaría la impresión sin que nadie lo
          haya pedido.
        -->
        <app-input
          label="Clave de plantilla (legado)"
          [formControl]="legacyControl"
          [maxlength]="templateKeyLimit()"
          size="sm"
          helperText="Catálogo anterior. Si eliges una plantilla del Hub arriba, manda esa."
        ></app-input>
      }

      @if (aiuBreakdownControl(); as breakdownControl) {
        <app-toggle
          [formControl]="breakdownControl"
          label="Mostrar el desglose AIU en la impresión"
        ></app-toggle>
      }

      @if (displayDecimalsControl(); as decimalsControl) {
        <app-input
          label="Decimales a mostrar"
          [formControl]="decimalsControl"
          type="number"
          min="0"
          max="6"
          size="sm"
          [error]="errors().display_decimals ?? ''"
        ></app-input>
      }
    </div>
  `,
})
export class InvoiceSectionFormatoComponent {
  readonly context = input.required<InvoiceSectionContext>();
  readonly isInvoice = computed(() => isInvoiceContext(this.context()));
  readonly isProfile = computed(() => isProfileContext(this.context()));

  readonly form = input.required<FormGroup>();
  readonly paths = input.required<FormatoSectionPaths>();
  /** Opciones de `GET /store/print-formats/library?formatType=fiscal_electronic_invoice`. */
  readonly templateOptions = input<SelectorOption[]>([]);
  readonly libraryFailed = input<boolean>(false);
  readonly errors = input<{
    template_id?: string;
    display_decimals?: string;
  }>({});
  /** Tope del catálogo legado; la página lo aporta porque vive en CONFIG_LIMITS. */
  readonly templateKeyLimit = input<number>(100);

  // ── Sólo contexto `invoice` ────────────────────────────────────────────
  /**
   * Con qué se imprime ESTE documento, ya resuelto por la página con la
   * precedencia del gateway (perfil congelado → tienda → sistema).
   */
  readonly effectivePrintLabel = input<string>('');
  /** Mientras el PUT de la configuración de tienda está en vuelo. */
  readonly storeTemplateSaving = input<boolean>(false);
  /** Valor crudo del selector ('' = plantilla activa de la tienda). */
  readonly templateSelectionChange = output<string>();

  /**
   * Puente del selector al output. Existe porque la plantilla no puede llamar
   * a `String()` —los globales no están en el scope de expresiones de
   * Angular— y porque `valueChange` emite `null` al volver a «tienda activa»,
   * que aquí significa cadena vacía, el valor que las opciones entienden.
   */
  onTemplateSelection(value: string | number | null): void {
    this.templateSelectionChange.emit(value == null ? '' : `${value}`);
  }

  readonly templateIdControl = computed(
    () => optionalControl(this.form(), this.paths().template_id) as FormControl | null,
  );
  readonly legacyKeyControl = computed(
    () => optionalControl(this.form(), this.paths().template_key) as FormControl | null,
  );
  readonly aiuBreakdownControl = computed(
    () => optionalControl(this.form(), this.paths().show_aiu_breakdown) as FormControl | null,
  );
  readonly displayDecimalsControl = computed(
    () => optionalControl(this.form(), this.paths().display_decimals) as FormControl | null,
  );
}
