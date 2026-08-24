import {
    Component,
    DestroyRef,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
    FormBuilder,
    FormArray,
    FormControl,
    FormGroup,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { map } from 'rxjs/operators';

import {
    AlertBannerComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    StickyHeaderActionButton,
    StickyHeaderComponent,
    TextareaComponent,
    ToggleComponent,
} from '../../../../../../shared/components/index';
import type { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';
import {
    AIU_BUCKETS,
    AIU_COMPONENTS,
    AIU_LEGAL_FLOOR_PERCENT_SCALED,
    CONFIG_LIMITS,
    INVOICE_PROFILE_CONFIG_VERSION,
    PROFILE_DOCUMENT_TYPES,
    blockingIssues,
    buildDefaultAiuProfileConfig,
    formatPercentScaled,
    isBlockingIssue,
    parsePercentScaled,
    resolveAiuComponentsBasis,
    validateInvoiceProfileConfig,
} from '../../../../../../core/utils/invoice-profile-config.contract';
import type {
    AiuBucket,
    AiuComponentsBasis,
    InvoiceProfileConfig,
    ProfileConfigIssue,
    ProfileDocumentType,
    ProfileModelLine,
    ProfileTaxRule,
    ProfileWithholdingRule,
    WithholdingRole,
} from '../../../../../../core/utils/invoice-profile-config.contract';
import type {
    InvoiceProfileDetail,
    UpdateInvoiceProfilePayload,
} from '../../interfaces/invoice-profile.interface';
import { INVOICE_PROFILE_OPERATION_LABELS } from '../../interfaces/invoice-profile.interface';
import { InvoiceProfilePreviewPanelComponent } from '../../components/invoice-profile-preview-panel/invoice-profile-preview-panel.component';
import { InvoiceProfileVersionsPanelComponent } from '../../components/invoice-profile-versions-panel/invoice-profile-versions-panel.component';
import { InvoiceFormSectionComponent } from '../../components/invoice-create/invoice-form-section.component';
import {
    FOREIGN_CURRENCY_OPTIONS,
    INVOICE_TYPE_OPTIONS,
    PAYMENT_FORM_OPTIONS,
    PAYMENT_MEANS_OPTIONS,
} from '../../components/invoice-create/invoice-dian-catalogs';
import {
    InvoiceWithholdingCatalogService,
    WithholdingConceptOption,
} from '../../components/invoice-create/invoice-withholding-catalog.service';
import { PrintGatewayClientService } from '../../../../../../shared/services/print/print-gateway-client.service';
import * as ProfileActions from '../../state/actions/invoice-profile.actions';
import { loadResolutions } from '../../state/actions/invoicing.actions';
import { selectResolutions } from '../../state/selectors/invoicing.selectors';
import type { InvoiceResolution } from '../../interfaces/invoice.interface';
import { profileHelp } from '../../utils/invoice-section-help';
import {
    compareResolutionsForSelection,
    hasRemainingRange,
    isWithinValidity,
    nextConsecutive,
    toDateOnly,
} from '../../utils/resolution-selection.util';
import { isHabilitationNumbering } from '../../../../../../shared/utils/habilitation-numbering.util';
import {
    selectCurrentProfile,
    selectCurrentProfileConfig,
    selectCurrentProfileLoading,
    selectProfileSaving,
    selectProfileTemplates,
} from '../../state/selectors/invoice-profile.selectors';

/**
 * Secciones del editor, en el MISMO orden con que la vista de emisión presenta
 * las suyas. No es cosmético: el editor es un semi espejo de «Nueva factura»
 * —quien configura un perfil y quien emite una factura recorren la misma
 * pantalla— y una sección que aquí va tercera y allá séptima obliga a aprender
 * dos mapas de la misma cosa.
 *
 * «Semi» porque tres secciones de la emisión NO existen en un perfil, y no por
 * falta de trabajo:
 *
 *  - **Adquiriente** — el cliente es del documento, no de la configuración.
 *    Precargar un adquiriente sería el peor default imaginable en una pantalla
 *    que gasta numeración autorizada.
 *  - **Divisa** — la TRM tiene fecha; un perfil no puede llevarla congelada.
 */
type SectionId =
    | 'documento'
    | 'lineas'
    | 'impuestos'
    | 'aiu'
    | 'retenciones'
    | 'divisa'
    | 'contabilidad'
    | 'formato'
    | 'general'
    | 'preview'
    | 'historial';

/**
 * Editor de un perfil de facturación — VISTA, no modal.
 *
 * ## Por qué dejó de ser un modal
 *
 * Un perfil tiene nueve secciones, matriz de impuestos, líneas modelo y
 * previsualización. Metido en un modal, cada una de esas cosas competía por
 * 600 px de alto con desplazamiento propio, y el resultado medido con usuarios
 * fue: nadie encontraba nada. La vista de emisión —que tiene MÁS campos— sí se
 * entiende, porque es una página con secciones plegables y una cabecera fija.
 * Este editor usa exactamente ese armazón, con las mismas secciones y en el
 * mismo orden, para que configurar un perfil se aprenda una sola vez.
 *
 * ## Por qué el id sale de la ruta y no de un `input()`
 *
 * La aplicación NO registra `withComponentInputBinding` (ver `app.config.ts`),
 * así que un `input()` nunca recibiría el parámetro de ruta: se quedaría en
 * `null` para siempre y el editor abriría en blanco sobre un perfil existente.
 * Se lee de `ActivatedRoute`.
 *
 * ## Por qué la plantilla de siembra viaja por query param y no por objeto
 *
 * Antes la lista pasaba el `config` completo de la plantilla por un `input()`.
 * Al volverse ruta eso ya no cabe en una URL, y guardarlo en un servicio
 * intermedio haría que recargar la página perdiera la siembra sin decir nada.
 * Viaja la CLAVE (`?template=`), y el editor la resuelve contra el catálogo
 * —que ya está en el store y es constante versionada—. Recargar funciona.
 *
 * ## Por qué la validación de cliente es la MISMA función del backend
 *
 * `validateInvoiceProfileConfig` se importa de
 * `core/utils/invoice-profile-config.contract`, espejo del contrato con que el
 * backend traduce a `INVOICING_PROFILE_005`. Escribir acá una validación
 * "equivalente" produciría dos reglas que divergen con el primer cambio, y la
 * divergencia se paga de la peor forma: el editor deja guardar algo que la
 * puerta de emisión rechaza semanas después, con el consecutivo en juego.
 *
 * ## Por qué los porcentajes son `string` y no `number`
 *
 * El contrato los mueve como cadenas de dos decimales (`'19.00'`) porque son
 * `cbc:Percent` del anexo. Meterlos a `number` los expone al binario de punto
 * flotante: `0.1 + 0.2` no es `0.3`, y una suma de componentes que debe dar
 * exactamente 100,00 fallaría por una centésima invisible. Se comparan en
 * centésimas enteras con `parsePercentScaled`.
 *
 * ## Por qué NO hay `ngModel` en ninguna parte
 *
 * Un `ngModel` dentro de un `formGroup` lanza NG01350 y **aborta el ciclo de
 * detección de cambios** — la pantalla se queda a medio pintar sin error
 * visible. Todo el editor es Reactive Forms.
 */
@Component({
    selector: 'vendix-invoice-profile-editor',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        RouterLink,
        StickyHeaderComponent,
        InvoiceFormSectionComponent,
        AlertBannerComponent,
        ButtonComponent,
        IconComponent,
        InputComponent,
        TextareaComponent,
        SelectorComponent,
        ToggleComponent,
        InvoiceProfilePreviewPanelComponent,
        InvoiceProfileVersionsPanelComponent,
    ],
    template: `
        <div class="w-full max-w-[1400px] mx-auto">
            <!--
                La cabecera va en la RAÍZ, no dentro del contenedor acolchado:
                «sticky top-0» se ancla al padre y desde dentro de uno con
                padding queda pegada con salto.

                Sin botón de retroceso, igual que la vista de emisión: el de la
                cabecera es un RouterLink puro y saldría sin preguntar. La única
                salida es «Cancelar».
            -->
            <app-sticky-header
                [title]="pageTitle()"
                [subtitle]="pageSubtitle()"
                icon="layout-template"
                variant="glass"
                [showBackButton]="false"
                [metadataContent]="saveHint()"
                [actions]="headerActions()"
                (actionClicked)="onHeaderAction($event)"
            />

            <div class="px-2 md:px-4 pb-6 space-y-4">
                @if (loading() && isEdit() && !hydrated()) {
                    <div
                        class="rounded-lg border border-border bg-[var(--color-surface-secondary)] px-3 py-6 text-center text-sm text-text-secondary"
                    >
                        Cargando el perfil…
                    </div>
                }

                <!--
                    space-y-6 y no space-y-4: con el borde sutil de cada
                    sección, 16 px las hacía leer como una sola lista continua y
                    costaba ver dónde acababa una configuración y empezaba otra.
                -->
                <form [formGroup]="form" class="space-y-6">
                    <!--
                        IDENTIDAD DEL PERFIL. Fuera de toda sección y siempre
                        visible: «name» y «operation_type» son COLUMNAS de la
                        tabla, no parte del snapshot de configuración, y el tipo
                        de operación decide qué secciones aplican. Plegarlo
                        dejaría al usuario cambiando una matriz de impuestos sin
                        ver para qué tipo de documento la está cambiando.
                    -->
                    <div
                        class="rounded-lg border border-border bg-[var(--color-surface-secondary)] p-3"
                    >
                        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <app-input
                                label="Nombre del perfil"
                                formControlName="name"
                                [maxlength]="120"
                                [control]="form.get('name')"
                                [error]="controlError('name')"
                                helperText="Único por tienda y tipo de operación."
                                size="sm"
                            ></app-input>
                            <app-selector
                                label="Tipo de operación"
                                formControlName="operation_type"
                                [options]="operation_options"
                                [disabled]="isEdit()"
                                size="sm"
                                [helpText]="
                                    isEdit()
                                        ? 'No se cambia después de crear: la matriz de impuestos y el régimen se guardaron para este tipo.'
                                        : 'Determina qué secciones aplican y cómo se arma el XML.'
                                "
                            ></app-selector>
                        </div>
                    </div>

                    <!-- ══ DOCUMENTO ══ espejo de la sección homónima de la
                         vista de emisión: lo que allí se elige por factura,
                         aquí se preconfigura. -->
                    <vendix-invoice-form-section
                        title="Documento"
                        [help]="help('documento')"
                        icon="file-text"
                        summary="Resolución preferida, forma y medio de pago, y notas de cabecera"
                        [errorCount]="sectionErrors().documento"
                        [expanded]="isSectionOpen('documento')"
                        (expandedChange)="setSection('documento', $event)"
                    >
                        <div class="space-y-3" formGroupName="dian">
                            <!--
                                El TIPO va primero porque decide qué secciones
                                tienen sentido más abajo: una exportación no está
                                sujeta a retención en Colombia, y verlo después de
                                haber llenado retenciones es verlo tarde.
                            -->
                            <app-selector
                                label="Tipo de documento"
                                formControlName="document_type"
                                [options]="document_type_options"
                                size="sm"
                                helpText="Se precarga en la factura. Una exportación es un documento DIAN distinto de una venta nacional."
                            ></app-selector>

                            @if (inapplicableWithholdings(); as count) {
                                <!--
                                    «app-alert-banner» y no un párrafo teñido: un
                                    texto «text-warning» sobre fondo claro no
                                    llega al contraste AA, y el aviso es
                                    justamente el que evita emitir una
                                    exportación con retención colombiana.
                                -->
                                <app-alert-banner
                                    variant="warning"
                                    icon="alert-triangle"
                                >
                                    Este perfil tiene {{ count }}
                                    {{
                                        count === 1
                                            ? 'retención configurada'
                                            : 'retenciones configuradas'
                                    }}
                                    y una factura de exportación no está sujeta a
                                    retención en Colombia. Quítalas o cambia el
                                    tipo de documento: se seguirán precargando tal
                                    como están.
                                </app-alert-banner>
                            }

                            <div
                                class="rounded-lg border border-border p-3 space-y-2"
                            >
                                <app-selector
                                    label="Resolución de numeración preferida"
                                    [formControl]="resolutionControl"
                                    [options]="resolution_options()"
                                    [placeholder]="
                                        'Sin preferencia — la factura elige la vigente más antigua'
                                    "
                                    size="sm"
                                    helpText="Para cuando la tienda tiene varios rangos autorizados vivos a la vez. Es una preferencia: si el rango no puede numerar el día de la emisión, la factura usa la vigente más antigua y lo avisa."
                                ></app-selector>
                                @if (resolution_options().length === 0) {
                                    <p class="text-xs text-text-secondary">
                                        No hay resoluciones de factura de venta
                                        registradas. Regístralas en Facturación →
                                        Resoluciones; sin rango autorizado la
                                        emisión no tiene de dónde tomar el
                                        consecutivo.
                                    </p>
                                }
                                @if (resolutionWarning(); as warning) {
                                    <p
                                        class="text-xs text-warning flex items-start gap-1.5"
                                    >
                                        <app-icon
                                            name="alert-triangle"
                                            [size]="14"
                                            class="mt-0.5 shrink-0"
                                        ></app-icon>
                                        <span>{{ warning }}</span>
                                    </p>
                                }
                            </div>

                            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <app-selector
                                    label="Forma de pago"
                                    formControlName="payment_method_code"
                                    [options]="payment_form_options"
                                    size="sm"
                                    helpText="Se precarga en la factura. Contado o crédito."
                                ></app-selector>
                                <app-selector
                                    label="Medio de pago"
                                    formControlName="payment_means_code"
                                    [options]="payment_means_options"
                                    size="sm"
                                    helpText="Código del anexo (efectivo, transferencia, tarjeta…)."
                                ></app-selector>
                            </div>

                            <div
                                class="rounded-lg border border-border p-3 space-y-2"
                            >
                                <div
                                    class="flex flex-wrap items-center justify-between gap-2"
                                >
                                    <p class="text-xs text-text-secondary">
                                        Notas de cabecera. Se precargan en la
                                        factura y viajan como
                                        <code>cbc:Note</code> del documento.
                                    </p>
                                    <app-button
                                        variant="secondary"
                                        size="sm"
                                        (clicked)="addHeaderNote()"
                                    >
                                        <app-icon
                                            slot="icon"
                                            name="plus"
                                            [size]="14"
                                        ></app-icon>
                                        Nota
                                    </app-button>
                                </div>
                                @if (headerNotes.controls.length === 0) {
                                    <p class="text-xs text-text-secondary italic">
                                        Sin notas. La factura no llevará ninguna
                                        precargada.
                                    </p>
                                }
                                <div class="space-y-2" formArrayName="header_notes">
                                    @for (
                                        note of headerNotes.controls;
                                        track $index
                                    ) {
                                        <div class="flex items-end gap-2">
                                            <div class="flex-1">
                                                <app-input
                                                    [label]="'Nota ' + ($index + 1)"
                                                    [formControlName]="$index"
                                                    [maxlength]="header_note_limit"
                                                    size="sm"
                                                    [error]="
                                                        issueFor(
                                                            'dian.header_notes[' +
                                                                $index +
                                                                ']'
                                                        )
                                                    "
                                                ></app-input>
                                            </div>
                                            <app-button
                                                variant="outline-danger"
                                                size="sm"
                                                (clicked)="removeHeaderNote($index)"
                                            >
                                                <app-icon
                                                    slot="icon"
                                                    name="trash-2"
                                                    [size]="14"
                                                ></app-icon>
                                                Quitar
                                            </app-button>
                                        </div>
                                    }
                                </div>
                            </div>
                        </div>
                    </vendix-invoice-form-section>

                    <!-- ══ LÍNEAS MODELO ══ espejo de «Líneas». -->
                    <vendix-invoice-form-section
                        title="Líneas modelo"
                        [help]="help('lineas')"
                        icon="list"
                        [summary]="modelLinesSummary()"
                        [errorCount]="sectionErrors().lineas"
                        [expanded]="isSectionOpen('lineas')"
                        (expandedChange)="setSection('lineas', $event)"
                    >
                        <div class="space-y-3">
                            <div
                                class="flex flex-wrap items-center justify-between gap-2"
                            >
                                <p class="text-xs text-text-secondary">
                                    Las líneas con que nacerá la factura al elegir
                                    este perfil. Se pueden editar y borrar en la
                                    factura: son un punto de partida, no un
                                    candado.
                                </p>
                                <app-button
                                    variant="secondary"
                                    size="sm"
                                    (clicked)="addModelLine()"
                                >
                                    <app-icon
                                        slot="icon"
                                        name="plus"
                                        [size]="14"
                                    ></app-icon>
                                    Línea
                                </app-button>
                            </div>
                            @if (modelLines.controls.length === 0) {
                                <p class="text-xs text-text-secondary italic">
                                    Sin líneas modelo. La factura abrirá con una
                                    línea vacía, como en el flujo manual.
                                </p>
                            }
                            <div class="space-y-2" formArrayName="model_lines">
                                @for (line of modelLines.controls; track $index) {
                                    <div
                                        class="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2 md:grid-cols-7"
                                        [formGroupName]="$index"
                                    >
                                        <!--
                                            El COMPONENTE sólo existe en un
                                            documento AIU: las cubetas son
                                            porciones del AIU y en una venta
                                            ordinaria no significan nada. Fuera
                                            de AIU se oculta y la línea nace en
                                            «costo», que es la única cubeta que
                                            no es componente del régimen.

                                            El INTERRUPTOR es el mismo que la
                                            vista de emisión pone en cada línea:
                                            «lleva la base AIU» no es un campo
                                            nuevo, es bucket distinto de
                                            «costo». Sin él la decisión fiscal
                                            queda escondida en elegir una opción
                                            de un selector de cuatro, y nadie lee
                                            eso como encender o apagar el AIU de
                                            la línea.
                                        -->
                                        @if (isAiu()) {
                                            <div class="space-y-1">
                                                <!--
                                                    «app-toggle» y no un
                                                    «<input type="checkbox">»
                                                    suelto: es el control de
                                                    encendido/apagado del sistema,
                                                    así que hereda el color del
                                                    tenant, el foco visible y el
                                                    área táctil. Un checkbox de
                                                    16 px pintado con «accent-»
                                                    no tenía ninguna de las tres.
                                                    No se le pasa «styleVariant».
                                                -->
                                                <div
                                                    class="flex items-center"
                                                    [title]="
                                                        lineCarriesAiu($index)
                                                            ? 'Esta línea lleva la base AIU configurada'
                                                            : 'Costo reembolsable: no entra a la base AIU'
                                                    "
                                                >
                                                    <app-toggle
                                                        label="AIU"
                                                        ariaLabel="Aplicar la base AIU a esta línea"
                                                        [checked]="
                                                            lineCarriesAiu($index)
                                                        "
                                                        (changed)="
                                                            toggleLineAiu(
                                                                $index,
                                                                $event
                                                            )
                                                        "
                                                    ></app-toggle>
                                                </div>
                                                @if (lineCarriesAiu($index)) {
                                                    <app-selector
                                                        formControlName="bucket"
                                                        [options]="component_options"
                                                        size="sm"
                                                    ></app-selector>
                                                } @else {
                                                    <span
                                                        class="block truncate text-[11px] text-text-secondary"
                                                        >Costo reembolsable</span
                                                    >
                                                }
                                            </div>
                                        }
                                        <div
                                            [class.md:col-span-2]="isAiu()"
                                            [class.md:col-span-3]="!isAiu()"
                                        >
                                            <app-input
                                                label="Descripción"
                                                formControlName="description"
                                                [maxlength]="line_description_limit"
                                                size="sm"
                                                [error]="
                                                    issueFor(
                                                        'model_lines[' +
                                                            $index +
                                                            '].description'
                                                    )
                                                "
                                            ></app-input>
                                        </div>
                                        <app-input
                                            label="Cantidad"
                                            formControlName="quantity"
                                            size="sm"
                                        ></app-input>
                                        <app-input
                                            label="Unidad"
                                            formControlName="unit_code"
                                            [maxlength]="4"
                                            size="sm"
                                            [error]="
                                                issueFor(
                                                    'model_lines[' +
                                                        $index +
                                                        '].unit_code'
                                                )
                                            "
                                        ></app-input>
                                        <!--
                                            Precio en BLANCO = se teclea en cada
                                            factura. No es un campo de dinero con
                                            formato: es la cadena que viaja al
                                            snapshot, y darle formato de moneda
                                            acá la redondearía a dos decimales
                                            cuando el anexo admite seis en el
                                            precio unitario.
                                        -->
                                        <app-input
                                            label="Precio"
                                            formControlName="unit_price"
                                            size="sm"
                                            placeholder="Se teclea"
                                            [error]="
                                                issueFor(
                                                    'model_lines[' +
                                                        $index +
                                                        '].unit_price'
                                                )
                                            "
                                        ></app-input>
                                        <app-button
                                            variant="outline-danger"
                                            size="sm"
                                            (clicked)="removeModelLine($index)"
                                        >
                                            <app-icon
                                                slot="icon"
                                                name="trash-2"
                                                [size]="14"
                                            ></app-icon>
                                            Quitar
                                        </app-button>
                                    </div>
                                }
                            </div>
                        </div>
                    </vendix-invoice-form-section>

                    <!-- ══ AIU ══ los CUATRO BLOQUES.
                         El régimen y el objeto del contrato van antes de los
                         cuatro porque el régimen decide qué componentes son
                         gravables, y el bloque 4 se lee contra esa decisión:
                         presentar la matriz de impuestos antes del régimen
                         invita a llenarla y que después se contradiga con su
                         propio régimen. -->
                    @if (isAiu()) {
                        <!--
                            Este banner existe porque la pantalla ESCONDE
                            secciones según el tipo de operación y el tipo de
                            documento. Sin él, un usuario que no ve «Retenciones»
                            no puede distinguir «no aplica» de «se rompió»: dice
                            qué manda, y así el hueco se lee como una decisión.
                        -->
                        <app-alert-banner variant="info" icon="info">
                            Las secciones que ves dependen del tipo de operación
                            —ahora <strong>AIU (09)</strong>— y del tipo de
                            documento. Las que no aplican se ocultan, salvo que ya
                            tengan datos guardados.
                        </app-alert-banner>

                        <vendix-invoice-form-section
                            title="Configuración AIU"
                        [help]="help('aiu')"
                            icon="calculator"
                            [summary]="aiuSummary()"
                            [errorCount]="sectionErrors().aiu"
                            [expanded]="isSectionOpen('aiu')"
                            (expandedChange)="setSection('aiu', $event)"
                        >
                            <div class="space-y-4">
                                <div class="space-y-3" formGroupName="aiu">
                                    <div
                                        class="grid grid-cols-1 gap-3 md:grid-cols-2"
                                    >
                                        <app-selector
                                            label="Régimen de IVA del contrato"
                                            formControlName="regime"
                                            [options]="regime_options"
                                            size="sm"
                                            helpText="Decide qué componentes entran a la base gravable."
                                        ></app-selector>
                                        <app-textarea
                                            label="Objeto del contrato (valor por omisión)"
                                            formControlName="contract_object"
                                            [rows]="2"
                                            [helperText]="contractObjectHelp()"
                                        ></app-textarea>
                                    </div>
                                </div>

                                <!-- ── BLOQUE 1 · Modelo de contabilización ── -->
                                <div
                                    class="rounded-lg border border-border overflow-hidden"
                                >
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
                                            Los dos modelos NO son una bandera de
                                            presentación: cambian la forma del
                                            XML. En el modelo sumado, A/I/U son
                                            LÍNEAS del documento. En el no
                                            sumado, el AIU deja de ser línea y
                                            pasa a ser sólo base de impuestos, lo
                                            que exige una línea cuya base
                                            gravable es MENOR que su propio
                                            importe.

                                            El segundo está deshabilitado a
                                            propósito y con el motivo a la vista.
                                            Ofrecerlo operativo antes de que el
                                            armado del XML esté verificado
                                            produciría documentos que la
                                            compuerta de totales rechaza al
                                            firmar —y el usuario no tendría forma
                                            de saber por qué—.
                                        -->
                                        <div
                                            class="rounded-lg border-2 border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)] p-3"
                                        >
                                            <div
                                                class="flex items-start justify-between gap-2"
                                            >
                                                <div class="min-w-0">
                                                    <p
                                                        class="text-sm font-semibold text-text-primary"
                                                    >
                                                        Base AIU sumada al total
                                                        de la factura
                                                    </p>
                                                    <p
                                                        class="mt-1 text-xs leading-relaxed text-text-secondary"
                                                    >
                                                        Administración,
                                                        Imprevistos y Utilidad son
                                                        líneas del documento. El
                                                        valor del contrato es su
                                                        suma, y la base gravable
                                                        sólo la componen las
                                                        líneas que el régimen
                                                        grava.
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
                                            <div
                                                class="flex items-start justify-between gap-2"
                                            >
                                                <div class="min-w-0">
                                                    <p
                                                        class="text-sm font-semibold text-text-primary"
                                                    >
                                                        Base AIU NO sumada al
                                                        total de la factura
                                                    </p>
                                                    <p
                                                        class="mt-1 text-xs leading-relaxed text-text-secondary"
                                                    >
                                                        El AIU deja de ser línea y
                                                        pasa a ser sólo base de
                                                        impuestos: una línea por el
                                                        valor del contrato, con una
                                                        base gravable menor que su
                                                        propio importe.
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
                                                    Cambia los totales monetarios
                                                    del XML (FAU02, FAU04, FAU06).
                                                    Se habilita cuando el armado
                                                    del documento pase la compuerta
                                                    de totales en los dos modelos;
                                                    hasta entonces elegirlo
                                                    produciría facturas rechazadas
                                                    al firmar.
                                                </span>
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <!-- ── BLOQUE 2 · Cuentas para contabilización AIU ── -->
                                <div
                                    class="rounded-lg border border-border overflow-hidden"
                                >
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
                                    <div class="p-3 space-y-2" formGroupName="accounting">
                                        <p class="text-xs text-text-secondary">
                                            Cuenta del PUC contra la que se
                                            reconoce el ingreso de cada
                                            componente. Vacío = se usa el mapeo
                                            contable de la tienda.
                                        </p>
                                        <div
                                            class="grid grid-cols-1 gap-2 md:grid-cols-3"
                                        >
                                            @for (
                                                component of aiu_components;
                                                track component
                                            ) {
                                                <app-input
                                                    [label]="componentLabel(component)"
                                                    [formControlName]="
                                                        'revenue_' + component
                                                    "
                                                    [maxlength]="account_code_limit"
                                                    size="sm"
                                                    placeholder="Ej. 413501"
                                                    [error]="
                                                        issueFor(
                                                            'accounting.revenue_account_by_bucket.' +
                                                                component
                                                        )
                                                    "
                                                ></app-input>
                                            }
                                        </div>
                                    </div>
                                </div>

                                <!-- ── BLOQUE 3 · Base AIU ── -->
                                <div
                                    class="rounded-lg border border-border overflow-hidden"
                                >
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
                                    <div class="p-3 space-y-3" formGroupName="aiu">
                                        <p class="text-xs text-text-secondary">
                                            {{ componentsBasisExplainer() }}
                                        </p>
                                        <div class="md:max-w-xs">
                                            <app-selector
                                                label="Los porcentajes se miden sobre"
                                                formControlName="components_basis"
                                                [options]="components_basis_options"
                                                size="sm"
                                                helpText="Los mismos tres números significan cosas distintas según la unidad. Los perfiles guardados antes de este campo usan «el AIU»."
                                            ></app-selector>
                                        </div>
                                        <div
                                            class="grid grid-cols-1 gap-2 md:grid-cols-3"
                                        >
                                            @for (
                                                component of aiu_components;
                                                track component
                                            ) {
                                                <app-input
                                                    [label]="
                                                        componentLabel(component) +
                                                        componentUnitSuffix()
                                                    "
                                                    [formControlName]="component"
                                                    type="text"
                                                    size="sm"
                                                    [control]="aiuGroup.get(component)"
                                                    [error]="
                                                        issueFor(
                                                            'aiu.components.' +
                                                                component
                                                        )
                                                    "
                                                ></app-input>
                                            }
                                        </div>

                                        <div
                                            class="rounded-lg border px-3 py-2 text-xs md:text-sm"
                                            [class.border-danger]="!componentsSumOk()"
                                            [class.text-danger]="!componentsSumOk()"
                                            [class.border-border]="componentsSumOk()"
                                            [class.text-text-secondary]="
                                                componentsSumOk()
                                            "
                                            role="status"
                                        >
                                            Suma de componentes:
                                            {{ componentsSumLabel() }} %
                                            {{ componentsSumTarget() }}
                                        </div>

                                        <div
                                            class="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-end"
                                        >
                                            <app-toggle
                                                formControlName="enforce_minimum_base"
                                                label="Exigir base gravable mínima"
                                            ></app-toggle>
                                            <app-input
                                                label="Base mínima (% del valor del contrato)"
                                                formControlName="minimum_base_percent"
                                                type="text"
                                                size="sm"
                                                [control]="
                                                    aiuGroup.get('minimum_base_percent')
                                                "
                                                [error]="
                                                    issueFor('aiu.minimum_base_percent')
                                                "
                                                [helperText]="minimumBaseHelp()"
                                            ></app-input>
                                        </div>
                                    </div>
                                </div>

                                <!-- ── BLOQUE 4 · Base impuestos ── -->
                                <div
                                    class="rounded-lg border border-border overflow-hidden"
                                >
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
                                        <app-button
                                            variant="secondary"
                                            size="sm"
                                            (clicked)="addTaxRule()"
                                        >
                                            <app-icon
                                                slot="icon"
                                                name="plus"
                                                [size]="14"
                                            ></app-icon>
                                            Regla
                                        </app-button>
                                    </div>
                                    <div class="p-3 space-y-2">
                                        <p class="text-xs text-text-secondary">
                                            Qué impuesto grava qué base. Lo que
                                            aquí se marque gravable es lo que
                                            emite <code>cac:TaxTotal</code> en el
                                            XML; lo que no, no emite totalización
                                            alguna —y por eso no se rechaza por
                                            declarar una tarifa del 0 %—.
                                        </p>
                                        @if (aiuOfContractLabel(); as aiuPct) {
                                            <!-- Las bases del bloque 3, ya
                                                 calculadas, para que elegir una
                                                 base acá no obligue a volver
                                                 arriba a sumar de cabeza. -->
                                            <div
                                                class="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-border bg-[var(--color-surface-secondary)] px-3 py-2 text-xs text-text-secondary"
                                            >
                                                <span
                                                    >Subtotal
                                                    <strong class="text-text-primary"
                                                        >100.00 %</strong
                                                    ></span
                                                >
                                                <span
                                                    >Base AIU
                                                    <strong class="text-text-primary"
                                                        >{{ aiuPct }} %</strong
                                                    ></span
                                                >
                                                @if (
                                                    utilidadOfContractLabel();
                                                    as utilidadPct
                                                ) {
                                                    <span
                                                        >Utilidad
                                                        <strong
                                                            class="text-text-primary"
                                                            >{{ utilidadPct }} %</strong
                                                        ></span
                                                    >
                                                }
                                                <span class="italic"
                                                    >del valor del contrato</span
                                                >
                                            </div>
                                        }
                                        @if (regimeMismatch(); as mismatch) {
                                            <div
                                                class="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger md:text-sm"
                                                role="alert"
                                            >
                                                {{ mismatch }}
                                            </div>
                                        }
                                        @if (taxRules.controls.length === 0) {
                                            <p
                                                class="text-xs italic text-text-secondary"
                                            >
                                                Sin reglas. El documento no
                                                declararía ningún impuesto.
                                            </p>
                                        }
                                        <div class="space-y-2" formArrayName="taxes">
                                            @for (
                                                rule of taxRules.controls;
                                                track $index
                                            ) {
                                                <div
                                                    class="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2 md:grid-cols-5"
                                                    [formGroupName]="$index"
                                                >
                                                    <app-selector
                                                        label="Impuesto"
                                                        formControlName="tax_code"
                                                        [options]="tax_code_options"
                                                        size="sm"
                                                    ></app-selector>
                                                    <app-selector
                                                        label="Base"
                                                        formControlName="bucket"
                                                        [options]="bucket_options"
                                                        size="sm"
                                                    ></app-selector>
                                                    <app-input
                                                        label="Tarifa (%)"
                                                        formControlName="rate"
                                                        size="sm"
                                                        [error]="
                                                            issueFor(
                                                                'taxes.rules[' +
                                                                    $index +
                                                                    '].rate'
                                                            )
                                                        "
                                                    ></app-input>
                                                    <div
                                                        class="flex items-center pb-2"
                                                    >
                                                        <app-toggle
                                                            formControlName="taxable"
                                                            label="Gravable"
                                                        ></app-toggle>
                                                    </div>
                                                    <app-button
                                                        variant="outline-danger"
                                                        size="sm"
                                                        (clicked)="removeTaxRule($index)"
                                                    >
                                                        <app-icon
                                                            slot="icon"
                                                            name="trash-2"
                                                            [size]="14"
                                                        ></app-icon>
                                                        Quitar
                                                    </app-button>
                                                </div>
                                            }
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </vendix-invoice-form-section>
                    }

                    <!-- ══ IMPUESTOS ══ sólo cuando NO es AIU: en un perfil AIU
                         la matriz vive dentro del bloque 4, que es donde la
                         referencia de negocio la pide y donde el régimen que la
                         gobierna está a la vista. Un mismo control no se enlaza
                         dos veces: son dos puntos de montaje y sólo uno está
                         activo a la vez. -->
                    @if (!isAiu()) {
                        <vendix-invoice-form-section
                            title="Impuestos"
                        [help]="help('impuestos')"
                            icon="percent"
                            [summary]="taxSummary()"
                            [errorCount]="sectionErrors().impuestos"
                            [expanded]="isSectionOpen('impuestos')"
                            (expandedChange)="setSection('impuestos', $event)"
                        >
                            <div class="space-y-2">
                                <div
                                    class="flex flex-wrap items-center justify-between gap-2"
                                >
                                    <p class="text-xs text-text-secondary">
                                        Qué impuesto grava qué base.
                                    </p>
                                    <app-button
                                        variant="secondary"
                                        size="sm"
                                        (clicked)="addTaxRule()"
                                    >
                                        <app-icon
                                            slot="icon"
                                            name="plus"
                                            [size]="14"
                                        ></app-icon>
                                        Regla
                                    </app-button>
                                </div>
                                <div class="space-y-2" formArrayName="taxes">
                                    @for (rule of taxRules.controls; track $index) {
                                        <div
                                            class="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2 md:grid-cols-5"
                                            [formGroupName]="$index"
                                        >
                                            <app-selector
                                                label="Impuesto"
                                                formControlName="tax_code"
                                                [options]="tax_code_options"
                                                size="sm"
                                            ></app-selector>
                                            <app-selector
                                                label="Base"
                                                formControlName="bucket"
                                                [options]="bucket_options"
                                                size="sm"
                                            ></app-selector>
                                            <app-input
                                                label="Tarifa (%)"
                                                formControlName="rate"
                                                size="sm"
                                                [error]="
                                                    issueFor(
                                                        'taxes.rules[' +
                                                            $index +
                                                            '].rate'
                                                    )
                                                "
                                            ></app-input>
                                            <div class="flex items-center pb-2">
                                                <app-toggle
                                                    formControlName="taxable"
                                                    label="Gravable"
                                                ></app-toggle>
                                            </div>
                                            <app-button
                                                variant="outline-danger"
                                                size="sm"
                                                (clicked)="removeTaxRule($index)"
                                            >
                                                <app-icon
                                                    slot="icon"
                                                    name="trash-2"
                                                    [size]="14"
                                                ></app-icon>
                                                Quitar
                                            </app-button>
                                        </div>
                                    }
                                </div>
                            </div>
                        </vendix-invoice-form-section>
                    }

                    <!-- ══ RETENCIONES ══ espejo de la sección homónima.

                         SE OCULTA cuando el tipo de documento es exportación Y
                         no hay nada configurado: una exportación no está sujeta
                         a retención en Colombia, así que la sección vacía sólo
                         estorba. Si YA hay filas, NO se oculta —se avisa arriba—
                         porque una sección invisible con datos dentro es un dato
                         fiscal que nadie puede revisar ni borrar. -->
                    @if (showWithholdings()) {
                        <vendix-invoice-form-section
                            title="Retenciones"
                            [help]="help('retenciones')"
                            icon="hand-coins"
                            [optional]="true"
                            [summary]="withholdingsSummary()"
                            [errorCount]="sectionErrors().retenciones"
                            [expanded]="isSectionOpen('retenciones')"
                            (expandedChange)="setSection('retenciones', $event)"
                        >
                            <div class="space-y-3">
                                <div
                                    class="flex flex-wrap items-center justify-between gap-2"
                                >
                                    <p class="text-xs text-text-secondary">
                                        Conceptos que se precargarán en la
                                        factura. La BASE no se guarda: es el
                                        importe de cada documento y se calcula al
                                        emitir.
                                    </p>
                                    <app-button
                                        variant="secondary"
                                        size="sm"
                                        (clicked)="addWithholding()"
                                    >
                                        <app-icon
                                            slot="icon"
                                            name="plus"
                                            [size]="14"
                                        ></app-icon>
                                        Retención
                                    </app-button>
                                </div>

                                @if (isExport() && withholdingRules.length > 0) {
                                    <p
                                        class="text-xs text-warning flex items-start gap-1.5"
                                    >
                                        <app-icon
                                            name="alert-triangle"
                                            [size]="14"
                                            class="mt-0.5 shrink-0"
                                        ></app-icon>
                                        <span
                                            >El tipo de documento es exportación y
                                            una exportación no está sujeta a
                                            retención en Colombia. Estas filas se
                                            seguirán precargando: quítalas si no
                                            corresponden.</span
                                        >
                                    </p>
                                }

                                @if (withholdingRules.controls.length === 0) {
                                    <p class="text-xs text-text-secondary italic">
                                        Sin retenciones. La factura abrirá sin
                                        ninguna fila, y se pueden añadir al
                                        emitir.
                                    </p>
                                }

                                <div
                                    class="space-y-2"
                                    formArrayName="withholdings"
                                >
                                    @for (
                                        rule of withholdingRules.controls;
                                        track $index
                                    ) {
                                        <div
                                            class="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2 md:grid-cols-6"
                                            [formGroupName]="$index"
                                        >
                                            <div class="md:col-span-3">
                                                <app-selector
                                                    label="Concepto"
                                                    formControlName="concept_id"
                                                    [options]="
                                                        withholding_concept_options()
                                                    "
                                                    size="sm"
                                                    placeholder="Elige el concepto"
                                                    [errorText]="
                                                        issueFor(
                                                            'withholdings.rules[' +
                                                                $index +
                                                                '].concept_id'
                                                        )
                                                    "
                                                ></app-selector>
                                            </div>
                                            <app-selector
                                                label="Lado"
                                                formControlName="role"
                                                [options]="
                                                    withholding_role_options
                                                "
                                                size="sm"
                                            ></app-selector>
                                            <app-input
                                                label="Tarifa %"
                                                formControlName="rate"
                                                size="sm"
                                                [helperText]="
                                                    catalogRateFor($index)
                                                        ? 'Catálogo: ' +
                                                          catalogRateFor($index) +
                                                          ' %'
                                                        : ''
                                                "
                                                [error]="
                                                    issueFor(
                                                        'withholdings.rules[' +
                                                            $index +
                                                            '].rate'
                                                    )
                                                "
                                            ></app-input>
                                            <app-button
                                                variant="outline-danger"
                                                size="sm"
                                                (clicked)="removeWithholding($index)"
                                            >
                                                <app-icon
                                                    slot="icon"
                                                    name="trash-2"
                                                    [size]="14"
                                                ></app-icon>
                                                Quitar
                                            </app-button>
                                        </div>
                                    }
                                </div>
                            </div>
                        </vendix-invoice-form-section>
                    }

                    <!-- ══ DIVISA ══ espejo de la sección homónima.

                         NO se oculta por tipo de documento: una venta nacional
                         pactada en dólares también declara la conversión, así
                         que gatearla por «exportación» esconderría una
                         configuración legítima. Lo que NO vive acá es la TASA:
                         es del día de la operación y se consulta al emitir. -->
                    <vendix-invoice-form-section
                        title="Divisa"
                        [help]="help('divisa')"
                        icon="globe"
                        [optional]="true"
                        [summary]="currencySummary()"
                        [errorCount]="sectionErrors().divisa"
                        [expanded]="isSectionOpen('divisa')"
                        (expandedChange)="setSection('divisa', $event)"
                    >
                        <div class="space-y-3" formGroupName="currency">
                            <app-toggle
                                label="Declarar conversión a divisa extranjera"
                                formControlName="declare_foreign"
                                helpText="La factura se emite SIEMPRE en pesos. Esto sólo añade la conversión al XML (Res. DIAN 000042/2020, art. 73)."
                            ></app-toggle>

                            <app-selector
                                label="Divisa"
                                formControlName="code"
                                [options]="currency_options"
                                size="sm"
                                placeholder="Sin divisa"
                                helpText="Se guarda la divisa, no la tasa: la tasa es del día de cada factura."
                                [errorText]="issueFor('currency.code')"
                            ></app-selector>
                        </div>
                    </vendix-invoice-form-section>

                    <!-- ══ CONTABILIDAD ══ espejo de la sección homónima. Las
                         cuentas por componente AIU NO están aquí: viven en el
                         bloque 2 del AIU. Aquí queda lo que no es por
                         componente. -->
                    <vendix-invoice-form-section
                        title="Contabilidad"
                        [help]="help('contabilidad')"
                        icon="book"
                        summary="Costo reembolsable e IVA por pagar"
                        [errorCount]="sectionErrors().contabilidad"
                        [expanded]="isSectionOpen('contabilidad')"
                        (expandedChange)="setSection('contabilidad', $event)"
                    >
                        <div class="space-y-2" formGroupName="accounting">
                            <p class="text-xs text-text-secondary">
                                Vacío = se usa el mapeo contable de la tienda.
                                @if (isAiu()) {
                                    Las cuentas de Administración, Imprevistos y
                                    Utilidad se configuran en el bloque «Cuentas
                                    para contabilización AIU».
                                }
                            </p>
                            <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                                <app-input
                                    label="Ingreso · Costo reembolsable"
                                    formControlName="revenue_costo"
                                    [maxlength]="account_code_limit"
                                    size="sm"
                                    [error]="
                                        issueFor(
                                            'accounting.revenue_account_by_bucket.costo'
                                        )
                                    "
                                ></app-input>
                                <app-input
                                    label="Cuenta de IVA por pagar"
                                    formControlName="vat_payable_account"
                                    [maxlength]="account_code_limit"
                                    size="sm"
                                    [error]="issueFor('accounting.vat_payable_account')"
                                ></app-input>
                            </div>
                        </div>
                    </vendix-invoice-form-section>

                    <!-- ══ FORMATO DE IMPRESIÓN ══ -->
                    <vendix-invoice-form-section
                        title="Formato de impresión"
                        [help]="help('formato')"
                        icon="printer"
                        [summary]="formatSummary()"
                        [errorCount]="sectionErrors().formato"
                        [expanded]="isSectionOpen('formato')"
                        (expandedChange)="setSection('formato', $event)"
                    >
                        <div class="space-y-3" formGroupName="format">
                            <div
                                class="flex items-start gap-2.5 rounded-lg border border-border bg-[var(--color-surface-muted)] px-3 py-2.5"
                            >
                                <app-icon
                                    name="info"
                                    [size]="15"
                                    class="mt-0.5 shrink-0 text-[var(--color-text-secondary)]"
                                ></app-icon>
                                <p
                                    class="text-xs leading-relaxed text-text-secondary"
                                >
                                    El diseño del documento —papel, secciones,
                                    columnas y estilos— se edita en el
                                    <a
                                        routerLink="/admin/settings/print-formats"
                                        class="font-semibold text-[var(--color-primary)] underline underline-offset-2"
                                        >Hub de formatos de impresión</a
                                    >, sobre el formato
                                    <strong>Factura Electrónica (DIAN)</strong>.
                                    Aquí sólo se elige la plantilla con que este
                                    perfil imprime y qué se muestra en ella.
                                </p>
                            </div>

                            <app-selector
                                label="Plantilla de impresión"
                                formControlName="template_id"
                                [options]="print_template_options()"
                                size="sm"
                                [errorText]="issueFor('format.template_id') ?? ''"
                                helpText="La factura se imprime con la plantilla que el perfil tenía al emitirse, no con la que la tienda tenga activa después."
                            ></app-selector>

                            @if (print_templates_failed()) {
                                <p
                                    class="text-[11px] text-[var(--color-warning)]"
                                >
                                    No se pudo leer la biblioteca del Hub. El
                                    perfil se guarda igual y la factura se
                                    imprimirá con la plantilla activa de la
                                    tienda.
                                </p>
                            }

                            <!--
                              LEGADO. Sólo se muestra si el perfil guardado ya
                              trae una clave de «default_templates». No se borra
                              en silencio: hay perfiles con este dato y borrarlo
                              al guardar cambiaría la impresión sin que nadie lo
                              haya pedido.
                            -->
                            @if (hasLegacyTemplateKey()) {
                                <app-input
                                    label="Clave de plantilla (legado)"
                                    formControlName="template_key"
                                    [maxlength]="template_key_limit"
                                    size="sm"
                                    helperText="Catálogo anterior. Si eliges una plantilla del Hub arriba, manda esa."
                                ></app-input>
                            }

                            <app-toggle
                                formControlName="show_aiu_breakdown"
                                label="Mostrar el desglose AIU en la impresión"
                            ></app-toggle>

                            <app-input
                                label="Decimales a mostrar"
                                formControlName="display_decimals"
                                type="number"
                                min="0"
                                max="6"
                                size="sm"
                                [error]="issueFor('format.display_decimals')"
                            ></app-input>
                        </div>
                    </vendix-invoice-form-section>

                    <!-- ══ GENERAL ══ va al FINAL: es documentación interna, no
                         configuración fiscal. Arriba empujaba las secciones que
                         deciden el XML por debajo del pliegue. -->
                    <vendix-invoice-form-section
                        title="Notas internas"
                        [help]="help('notas_internas')"
                        icon="info"
                        summary="No viajan al XML"
                        [errorCount]="sectionErrors().general"
                        [expanded]="isSectionOpen('general')"
                        (expandedChange)="setSection('general', $event)"
                    >
                        <div class="space-y-2" formGroupName="general">
                            <app-textarea
                                label="Descripción"
                                formControlName="description"
                                [rows]="2"
                                helperText="Para el operador. No viaja al XML."
                            ></app-textarea>
                            <app-textarea
                                label="Nota interna"
                                formControlName="internal_note"
                                [rows]="3"
                                helperText="Por qué existe este perfil. Queda en el historial de versiones."
                            ></app-textarea>
                        </div>
                    </vendix-invoice-form-section>
                </form>

                <!-- ══ PREVISUALIZACIÓN ══ fuera del «form»: el panel lanza su
                     propia petición y no enlaza controles. -->
                @if (isEdit()) {
                    <vendix-invoice-form-section
                        title="Previsualización"
                        [help]="help('previsualizacion')"
                        icon="eye"
                        summary="Cómo quedaría un documento con este perfil"
                        [errorCount]="0"
                        [expanded]="isSectionOpen('preview')"
                        (expandedChange)="setSection('preview', $event)"
                    >
                        <vendix-invoice-profile-preview-panel
                            [profileId]="profileId()"
                            [isAiu]="isAiu()"
                            [contractObject]="currentContractObject()"
                        ></vendix-invoice-profile-preview-panel>
                    </vendix-invoice-form-section>

                    <vendix-invoice-form-section
                        title="Historial de versiones"
                        [help]="help('historial')"
                        icon="history"
                        [summary]="'Versión vigente: v' + currentVersionNumber()"
                        [errorCount]="0"
                        [expanded]="isSectionOpen('historial')"
                        (expandedChange)="setSection('historial', $event)"
                    >
                        <vendix-invoice-profile-versions-panel
                            [profileId]="profileId()"
                            [currentVersion]="currentVersionNumber()"
                        ></vendix-invoice-profile-versions-panel>
                    </vendix-invoice-form-section>
                }

                <!-- Avisos que NO bloquean. Siempre visibles: el usuario tiene
                     que poder verlos antes de pulsar Guardar, desde donde esté. -->
                @if (warnings().length > 0) {
                    <!--
                        «bg-warning/5» era un tinte del 5 % con texto del mismo
                        tono: legible en la pantalla de quien lo escribió y por
                        debajo de AA en cualquier otra. El banner del sistema trae
                        el par fondo/texto ya calibrado.
                    -->
                    <app-alert-banner variant="warning" icon="alert-triangle">
                        <span role="status">
                            <ul class="list-inside list-disc">
                                @for (warning of warnings(); track warning.code) {
                                    <li>{{ warning.message }}</li>
                                }
                            </ul>
                        </span>
                    </app-alert-banner>
                }

                <!-- Bloqueos: la lista COMPLETA, no el primero. El validador
                     los devuelve todos a propósito. -->
                @if (blockers().length > 0) {
                    <div
                        class="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger md:text-sm"
                        role="alert"
                    >
                        <ul class="list-inside list-disc">
                            @for (
                                blocker of blockers();
                                track blocker.field + blocker.code
                            ) {
                                <li>{{ blocker.message }}</li>
                            }
                        </ul>
                    </div>
                }

                @if (server_error(); as message) {
                    <div
                        class="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger md:text-sm"
                        role="alert"
                    >
                        {{ message }}
                    </div>
                }

                <!--
                    El pie se conserva aunque la cabecera lleve las mismas
                    acciones: la página mide ocho secciones y quien acaba de
                    llenar la última está al final, no arriba.
                -->
                <div
                    class="flex flex-col gap-3 rounded-lg border border-border bg-[var(--color-surface-secondary)] p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                    <span
                        class="min-w-0 truncate text-xs text-[var(--color-text-secondary)]"
                    >
                        {{ saveHint() }}
                    </span>
                    <div class="flex flex-col gap-2 sm:flex-row">
                        <app-button variant="outline" (clicked)="cancel()">
                            Cancelar
                        </app-button>
                        <app-button
                            variant="primary"
                            [disabled]="saving() || blockers().length > 0"
                            (clicked)="save()"
                        >
                            <app-icon slot="icon" name="save" [size]="16"></app-icon>
                            {{ isEdit() ? 'Guardar cambios' : 'Crear perfil' }}
                        </app-button>
                    </div>
                </div>
            </div>
        </div>
    `,
})
export class InvoiceProfileEditorComponent {
    private readonly store = inject(Store);
    private readonly fb = inject(FormBuilder);
    private readonly destroyRef = inject(DestroyRef);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly printGateway = inject(PrintGatewayClientService);

    /**
     * Id del perfil, leído de la RUTA.
     *
     * `withComponentInputBinding` no está registrado en `app.config.ts`, así que
     * un `input()` nunca recibiría el parámetro: se quedaría en `null` y el
     * editor abriría en blanco sobre un perfil que existe. Se lee de
     * `ActivatedRoute`, que además hace la pantalla enlazable y recargable.
     */
    readonly profileId = toSignal(
        this.route.paramMap.pipe(
            map((params) => {
                const raw = params.get('id');
                if (raw === null) return null;
                const parsed = Number(raw);
                return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
            }),
        ),
        { initialValue: null },
    );

    /** Tipo de operación con que se siembra un perfil nuevo (`?operation_type=`). */
    private readonly seedOperationType = toSignal(
        this.route.queryParamMap.pipe(
            map((params) => params.get('operation_type') ?? '09'),
        ),
        { initialValue: '09' },
    );

    /** Clave de la plantilla DIAN con que se siembra (`?template=`). */
    private readonly seedTemplateKey = toSignal(
        this.route.queryParamMap.pipe(map((params) => params.get('template'))),
        { initialValue: null as string | null },
    );

    readonly server_error = signal<string | null>(null);

    /** Marca de hidratación: `null` mientras no se ha sembrado el formulario. */
    private readonly loaded_config = signal<string | null>(null);
    readonly hydrated = computed(() => this.loaded_config() !== null);

    readonly aiu_components = AIU_COMPONENTS;
    readonly aiu_buckets = AIU_BUCKETS;
    readonly account_code_limit = CONFIG_LIMITS.account_code;
    readonly line_description_limit = CONFIG_LIMITS.line_description;
    readonly template_key_limit = CONFIG_LIMITS.template_key;
    readonly header_note_limit = CONFIG_LIMITS.header_note;

    readonly operation_options = Object.entries(INVOICE_PROFILE_OPERATION_LABELS).map(
        ([value, label]) => ({ value, label }),
    );

    readonly regime_options = [
        { value: 'et_462_1', label: 'Art. 462-1 E.T. — IVA sobre A+I+U' },
        {
            value: 'decreto_1372_1992',
            label: 'Decreto 1372/1992 — IVA sólo sobre la Utilidad',
        },
    ];

    readonly bucket_options = [
        { value: 'administracion', label: 'Administración' },
        { value: 'imprevistos', label: 'Imprevistos' },
        { value: 'utilidad', label: 'Utilidad' },
        { value: 'costo', label: 'Costo reembolsable' },
    ];

    /**
     * Sólo los tres componentes del AIU, sin «costo».
     *
     * El selector de la línea lo gobierna el interruptor: si «costo» siguiera
     * entre las opciones, se podría dejar el interruptor encendido y elegir
     * «costo», que es la contradicción exacta que el interruptor existe para
     * impedir. La matriz de impuestos SÍ usa las cuatro, porque allí «costo» es
     * una porción que se declara o no se declara.
     */
    readonly component_options = [
        { value: 'administracion', label: 'Administración' },
        { value: 'imprevistos', label: 'Imprevistos' },
        { value: 'utilidad', label: 'Utilidad' },
    ];

    /**
     * Tributos de la tabla 13.2.2 del anexo, por CÓDIGO.
     *
     * Se ofrecen los seis que un contrato AIU usa en la práctica y no la tabla
     * de dieciséis: un selector con `Sordicom` y `FtoHorticultura` entre las
     * opciones esconde IVA y Retefuente, que son las dos que se buscan siempre.
     * El validador acepta cualquier par de dígitos, así que restringir el
     * selector no cierra ninguna puerta — sólo ordena la que se usa.
     */
    readonly tax_code_options = [
        { value: '01', label: 'IVA (01)' },
        { value: '04', label: 'INC (04)' },
        { value: '03', label: 'ICA (03)' },
        { value: '06', label: 'ReteFuente (06)' },
        { value: '07', label: 'ReteICA (07)' },
        { value: '05', label: 'ReteIVA (05)' },
    ];

    /**
     * La ayuda larga de una sección, leída desde el catálogo compartido con la
     * vista de emisión. Es un método y no un mapa inline para que las dos
     * pantallas no puedan divergir en cómo explican la misma regla fiscal.
     */
    readonly help = profileHelp;

    /** Mismas listas que la vista de emisión: un solo catálogo, dos pantallas. */
    readonly payment_form_options = PAYMENT_FORM_OPTIONS;
    readonly payment_means_options = PAYMENT_MEANS_OPTIONS;
    readonly document_type_options = INVOICE_TYPE_OPTIONS;
    readonly currency_options = FOREIGN_CURRENCY_OPTIONS;

    // ─── Retenciones ──────────────────────────────────────────────────────

    private readonly withholdingCatalog = inject(InvoiceWithholdingCatalogService);

    /** Conceptos de `withholding_concepts` del tenant. */
    private readonly withholding_concepts = signal<WithholdingConceptOption[]>([]);

    /**
     * Opciones del selector de concepto, con la tarifa del catálogo a la vista.
     *
     * La tarifa se MUESTRA pero no se impone: el perfil guarda la suya porque un
     * concepto admite tarifas distintas según el contrato, y sustituirla en
     * silencio por la del catálogo cambiaría un dato fiscal que alguien decidió.
     */
    readonly withholding_concept_options = computed<SelectorOption[]>(() =>
        this.withholding_concepts().map((concept) => ({
            value: concept.id,
            label: concept.code + ' · ' + concept.name,
            description:
                concept.ratePercent.toFixed(2) +
                ' %' +
                (concept.withholdingType ? ' · ' + concept.withholdingType : ''),
        })),
    );

    /** Los dos lados, con las mismas etiquetas que la vista de emisión. */
    readonly withholding_role_options: SelectorOption[] = [
        { value: 'practiced', label: 'La tienda retiene' },
        { value: 'suffered', label: 'A la tienda le retienen' },
    ];

    // ─── Resolución preferida ─────────────────────────────────────────────

    /**
     * TODAS las resoluciones de la tienda, activas e inactivas.
     *
     * Deliberadamente NO es `selectActiveResolutions`: ese selector filtra
     * `is_active` y aquí no se numera nada, se elige una preferencia. Si una
     * resolución se desactiva, con el selector de activas desaparecería del
     * combo y el perfil que la tenía guardada pasaría de «prefiero una que está
     * inactiva» a «nunca elegí nada» — sin que nadie tocara el perfil. Lo que
     * corresponde es seguir mostrándola y DECIR que está inactiva.
     */
    private readonly resolutions = toSignal(
        this.store.select(selectResolutions),
        { initialValue: [] as InvoiceResolution[] },
    );

    /**
     * La preferencia tal como venía guardada, para no perderla al reguardar.
     *
     * Si la resolución preferida se borró de la tienda ya no está en
     * `resolutions()`, así que `selectedResolution()` devuelve `null`. Sin esta
     * copia, guardar el perfil por cualquier OTRA razón escribiría
     * `resolution_number: null` conservando el id, y la versión nueva tendría
     * una preferencia que nadie puede nombrar: el aviso de la emisión pasaría de
     * «prefiere la 18764000000123, que ya no figura» a un aviso sin sujeto.
     */
    private readonly hydrated_resolution = signal<{
        id: number | null;
        number: string | null;
    }>({ id: null, number: null });

    /**
     * Las resoluciones que un perfil puede PREFERIR.
     *
     * Filtra por documento —una resolución de documento soporte no numera una
     * factura de venta— y por nada más. En particular NO filtra por vigencia ni
     * por actividad, que es la diferencia con la pantalla de emisión y no es un
     * descuido:
     *
     *  - una resolución cuya vigencia EMPIEZA el mes entrante es una preferencia
     *    perfectamente legítima, y esconderla obligaría a volver a editar el
     *    perfil el día que entre a regir;
     *  - una VENCIDA o DESACTIVADA se sigue mostrando porque es la que el perfil
     *    ya tiene guardada, y desaparecerla del selector convertiría «tengo una
     *    preferencia que caducó» en «nunca elegí nada».
     *
     * Lo que sí se hace es DECIRLO en la descripción de cada opción, y que la
     * precarga la ignore cuando no pueda numerar el día de la emisión.
     */
    readonly resolution_options = computed<SelectorOption[]>(() => {
        const today = toLocalDateString();
        return this.resolutions()
            .filter(
                (res) =>
                    (res.document_type ?? 'sales_invoice') === 'sales_invoice',
            )
            .sort(compareResolutionsForSelection)
            .map((res) => ({
                value: res.id,
                label:
                    (isHabilitationNumbering(res) ? 'PRUEBAS · ' : '') +
                    (res.prefix || 'sin prefijo') +
                    ' · ' +
                    res.resolution_number,
                description: this.describeResolution(res, today),
            }));
    });

    /** El estado de un rango, en el lenguaje del operador. */
    private describeResolution(res: InvoiceResolution, today: string): string {
        const parts: string[] = [];
        if (isHabilitationNumbering(res)) {
            parts.push('Numeración de habilitación: nunca emite una factura real');
        }
        if (res.is_active !== true) {
            parts.push('Inactiva');
        }
        const from = toDateOnly(res.valid_from);
        if (from && today < from) {
            parts.push('Empieza a regir el ' + from);
        } else if (!isWithinValidity(res, today)) {
            parts.push('Fuera de vigencia desde el ' + toDateOnly(res.valid_to));
        }
        if (!hasRemainingRange(res)) {
            parts.push('Rango agotado');
        } else {
            parts.push(
                'Consecutivo ' + nextConsecutive(res) + ' de ' + res.range_to,
            );
        }
        return parts.join(' · ');
    }

    /**
     * El control se expone tipado porque se pinta con `[formControl]` fuera del
     * `formGroupName`, y `form.get(...)` en la plantilla está prohibido por
     * `vendix-angular-forms`. Es un getter y no un `computed`: devolvería la
     * REFERENCIA, que nunca cambia, así que un `computed` sólo aparentaría
     * reactividad.
     */
    get resolutionControl(): FormControl<number | null> {
        return this.form.get('dian.resolution_id') as FormControl<number | null>;
    }

    selectedResolutionId(): number | null {
        const raw = Number(this.form.get('dian.resolution_id')?.value);
        return Number.isInteger(raw) && raw > 0 ? raw : null;
    }

    selectedResolution(): InvoiceResolution | null {
        const id = this.selectedResolutionId();
        if (id === null) return null;
        return this.resolutions().find((res) => res.id === id) ?? null;
    }

    /**
     * El número que se guarda junto al id: el de la fila viva si se puede leer
     * y, si no, el que ya venía guardado — siempre que el id NO haya cambiado.
     * Si el usuario eligió otra resolución, el número viejo no aplica.
     */
    private resolvedResolutionNumber(): string | null {
        const id = this.selectedResolutionId();
        if (id === null) return null;
        const live = this.selectedResolution()?.resolution_number;
        if (live) return live;
        const hydrated = this.hydrated_resolution();
        return hydrated.id === id ? hydrated.number : null;
    }

    /**
     * El aviso que acompaña a la preferencia elegida.
     *
     * Se calcula con la fecha de HOY, que es lo único que se puede saber al
     * configurar. No bloquea el guardado: un perfil con una preferencia que hoy
     * no numera sigue siendo un perfil correcto —la resolución puede entrar a
     * regir mañana— y lo que hace falta es que quien lo guarda sepa qué va a
     * pasar cuando alguien lo use.
     */
    resolutionWarning(): string | null {
        this.form_value();
        const res = this.selectedResolution();

        // Hay id guardado pero no hay fila que lo respalde: la resolución se
        // borró, o el id venía de otra tienda. Sin este aviso el selector se ve
        // VACÍO y el operador concluye «este perfil no tiene preferencia»,
        // cuando en realidad la tiene y es inservible: la emisión va a avisar en
        // cada factura y nadie va a saber dónde arreglarlo. No se limpia solo
        // —seria una escritura silenciosa sobre configuración fiscal—: se dice.
        if (!res && this.selectedResolutionId() !== null) {
            const hydrated = this.hydrated_resolution();
            const named =
                hydrated.id === this.selectedResolutionId() && hydrated.number
                    ? 'la resolución ' + hydrated.number
                    : 'una resolución';
            return (
                'El perfil tiene guardada ' +
                named +
                ' que ya no figura entre las de esta tienda. La emisión la ignora y elige la vigente más antigua: elige una de la lista o déjalo sin preferencia.'
            );
        }
        if (!res) return null;
        const today = toLocalDateString();

        if (isHabilitationNumbering(res)) {
            return 'Es la numeración de habilitación, idéntica para todos los contribuyentes. La emisión NUNCA la preselecciona sola: si la dejas como preferencia del perfil, tampoco la va a usar.';
        }
        if (res.is_active !== true) {
            return 'Esta resolución está inactiva. Mientras lo esté, la emisión la ignora y elige la vigente más antigua.';
        }
        if (!hasRemainingRange(res)) {
            return 'Este rango ya está agotado. La emisión lo ignora y elige la vigente más antigua; solicita el rango nuevo a la DIAN.';
        }
        const from = toDateOnly(res.valid_from);
        if (from && today < from) {
            return (
                'Esta resolución empieza a regir el ' +
                from +
                '. Hasta entonces la emisión elige la vigente más antigua y desde esa fecha usará esta.'
            );
        }
        if (!isWithinValidity(res, today)) {
            return (
                'Esta resolución quedó fuera de vigencia el ' +
                toDateOnly(res.valid_to) +
                '. La emisión la ignora y elige la vigente más antigua.'
            );
        }
        return null;
    }

    readonly form: FormGroup = this.fb.group({
        name: ['', [Validators.required, Validators.maxLength(120)]],
        operation_type: ['09', Validators.required],
        general: this.fb.group({
            description: [''],
            internal_note: [''],
        }),
        aiu: this.fb.group({
            regime: ['et_462_1'],
            contract_object: [''],
            enforce_minimum_base: [true],
            minimum_base_percent: [formatPercentScaled(AIU_LEGAL_FLOOR_PERCENT_SCALED)],
            // Unidad de los tres porcentajes de abajo. `'contract'` por
            // omisión: es como se redacta un contrato AIU y es la única unidad
            // en la que el piso legal se puede comprobar al guardar.
            components_basis: ['contract' as AiuComponentsBasis],
            administracion: ['5.00'],
            imprevistos: ['2.00'],
            utilidad: ['3.00'],
        }),
        accounting: this.fb.group({
            revenue_administracion: [''],
            revenue_imprevistos: [''],
            revenue_utilidad: [''],
            revenue_costo: [''],
            vat_payable_account: [''],
        }),
        taxes: this.fb.array([] as FormGroup[]),
        model_lines: this.fb.array([] as FormGroup[]),
        format: this.fb.group({
            template_id: [null as number | null],
            template_key: [''],
            show_aiu_breakdown: [true],
            display_decimals: [2],
        }),
        // Retenciones y divisa: dos secciones que NO son de la operación AIU
        // sino del CLIENTE al que se factura, y por eso viven fuera del grupo
        // `aiu` y sobreviven a un cambio de tipo de operación.
        withholdings: this.fb.array([] as FormGroup[]),
        currency: this.fb.group({
            declare_foreign: [false],
            code: [''],
        }),
        dian: this.fb.group({
            // Venta nacional por omisión: es el caso de la inmensa mayoría, y
            // el mismo valor con que abre el formulario de emisión.
            document_type: ['sales_invoice'],
            // Resolución PREFERIDA. `null` = sin preferencia, y es el valor por
            // omisión a propósito: sin preferencia manda el criterio de la
            // pantalla de emisión (la vigente más antigua), que es lo que evita
            // dejar vencer numeración autorizada sin gastar.
            resolution_id: [null as number | null],
            payment_means_code: [''],
            payment_method_code: [''],
            header_notes: this.fb.array([] as unknown[]),
        }),
    });

    /**
     * Espejo del formulario como señal.
     *
     * `computed` sobre un `FormControl` **no es reactivo** — un `FormGroup` no
     * es una señal, así que un `computed` que lo lea nunca se recalcula. La
     * única forma correcta de derivar estado del formulario en un componente
     * Zoneless es pasar por `valueChanges` con `toSignal`.
     */
    private readonly form_value = toSignal(this.form.valueChanges, {
        initialValue: this.form.getRawValue(),
    });

    readonly saving = toSignal(this.store.select(selectProfileSaving), {
        initialValue: false,
    });
    readonly loading = toSignal(this.store.select(selectCurrentProfileLoading), {
        initialValue: false,
    });
    private readonly current = toSignal(this.store.select(selectCurrentProfile), {
        initialValue: null,
    });
    private readonly current_config = toSignal(
        this.store.select(selectCurrentProfileConfig),
        { initialValue: null },
    );
    private readonly templates = toSignal(this.store.select(selectProfileTemplates), {
        initialValue: [],
    });

    readonly isEdit = computed(() => this.profileId() !== null);
    readonly isAiu = computed(() => this.operationType() === '09');

    /**
     * Secciones abiertas al entrar.
     *
     * Se abren las tres que TODO perfil necesita tocar —documento, líneas
     * modelo y AIU—, igual que la vista de emisión abre sus tres primeras.
     * Abrirlas todas convierte la página en un muro de ocho metros; abrir sólo
     * una obliga a descubrir las otras siete a ciegas.
     */
    private readonly openSections = signal<Set<SectionId>>(
        new Set<SectionId>(['documento', 'lineas', 'aiu']),
    );

    /** Problemas del snapshot actual, con la MISMA función que usa el backend. */
    readonly issues = computed<ProfileConfigIssue[]>(() => {
        // Se lee `form_value()` sólo para declarar la dependencia: el snapshot
        // se arma desde el formulario, que es la fuente de verdad de los
        // `FormArray` (el valor plano no distingue arreglos vacíos de ausentes).
        this.form_value();
        return validateInvoiceProfileConfig(this.buildConfig(), {
            operation_type: this.operationType(),
        });
    });
    readonly blockers = computed(() => blockingIssues(this.issues()));
    readonly warnings = computed(() => this.issues().filter((i) => !isBlockingIssue(i)));

    readonly pageTitle = computed(() =>
        this.isEdit() ? 'Editar perfil de facturación' : 'Nuevo perfil de facturación',
    );

    readonly pageSubtitle = computed(() => {
        const profile = this.current();
        if (!this.isEdit()) {
            return 'Preconfigura el documento — se precarga al crear la factura';
        }
        return profile
            ? 'Versión vigente: v' + profile.current_version
            : 'Cargando…';
    });

    /**
     * Frase del pie y del metadato de la cabecera.
     *
     * Es la MISMA en los dos sitios a propósito: un botón apagado sin motivo a
     * la vista es un callejón sin salida, y el motivo tiene que estar donde el
     * usuario está mirando —arriba si acaba de entrar, abajo si acaba de
     * escribir la última línea—.
     */
    readonly saveHint = computed<string>(() => {
        const blocked = this.blockers().length;
        if (blocked > 0) {
            return blocked === 1
                ? 'Hay 1 problema que impide guardar.'
                : 'Hay ' + blocked + ' problemas que impiden guardar.';
        }
        if (this.saving()) return 'Guardando…';
        return this.isEdit()
            ? 'Guardar crea una versión nueva; la anterior queda en el historial.'
            : 'Al guardar, este perfil queda disponible en el selector de «Nueva factura».';
    });

    readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
        { id: 'cancel', label: 'Cancelar', variant: 'outline', icon: 'x' },
        {
            id: 'save',
            label: this.isEdit() ? 'Guardar cambios' : 'Crear perfil',
            variant: 'primary',
            icon: 'save',
            loading: this.saving(),
            disabled: this.saving() || this.blockers().length > 0,
            title: this.saveHint(),
        },
    ]);

    // ── Resúmenes de sección (cabecera plegada) ─────────────────────────────
    //
    // La cabecera de una sección plegada es lo único que el usuario ve de ella.
    // Un resumen que diga «3 líneas · 4 reglas» convierte ocho cajas idénticas
    // en un índice.

    readonly modelLinesSummary = computed<string>(() => {
        this.form_value();
        const count = this.modelLines.controls.length;
        if (count === 0) return 'Sin líneas modelo';
        return count === 1 ? '1 línea' : count + ' líneas';
    });

    readonly taxSummary = computed<string>(() => {
        this.form_value();
        const total = this.taxRules.controls.length;
        const taxable = this.taxRules.controls.filter((control) =>
            Boolean(control.get('taxable')?.value),
        ).length;
        if (total === 0) return 'Sin reglas';
        return total + ' regla(s) · ' + taxable + ' gravable(s)';
    });

    readonly aiuSummary = computed<string>(() => {
        this.form_value();
        const regime = this.aiuGroup.get('regime')?.value;
        const label =
            regime === 'decreto_1372_1992' ? 'Decreto 1372/1992' : 'Art. 462-1 E.T.';
        const basis =
            this.componentsBasis() === 'contract' ? ' del contrato' : ' del AIU';
        return label + ' · componentes ' + this.componentsSumLabel() + ' %' + basis;
    });

    /**
     * Plantillas del Hub para «Factura Electrónica (DIAN)».
     *
     * Se piden acá y no en el store porque son de OTRO dominio (ajustes de
     * impresión) y este editor es su único consumidor en facturación: meterlas
     * al estado de perfiles obligaría a mantener acciones, efectos y selectores
     * para una lista que sólo se lee una vez al abrir la vista.
     *
     * Si la petición falla la lista queda vacía y el campo cae al modo legado
     * («plantilla de la tienda»). Nunca bloquea el guardado: el diseño del
     * documento no puede impedir configurar el régimen fiscal.
     */
    readonly print_templates = signal<{ id: number; name: string; is_system: boolean }[]>([]);
    readonly print_templates_failed = signal(false);

    readonly print_template_options = computed(() => [
        { value: '', label: 'Plantilla activa de la tienda' },
        ...this.print_templates().map((t) => ({
            value: String(t.id),
            label: t.is_system ? t.name + ' (del sistema)' : t.name,
        })),
    ]);

    /** ¿El perfil guardado trae la clave del catálogo anterior? */
    readonly hasLegacyTemplateKey = computed<boolean>(() => {
        this.form_value();
        return (
            String(this.form.get('format.template_key')?.value ?? '').trim()
                .length > 0
        );
    });

    // ─── Tipo de documento y qué secciones aplican ───────────────────────

    /**
     * `true` si el perfil precarga una factura de EXPORTACIÓN.
     *
     * Se lee del formulario y no del snapshot cargado: el usuario puede cambiar
     * el tipo antes de guardar, y las secciones tienen que responder a lo que
     * está viendo, no a lo que había en la base.
     */
    readonly isExport = computed<boolean>(() => {
        this.form_value();
        return this.form.get('dian.document_type')?.value === 'export_invoice';
    });

    /**
     * Si la sección de retenciones se pinta.
     *
     * Una exportación no está sujeta a retención en Colombia, así que la sección
     * vacía sólo estorba. Pero si YA hay filas configuradas NO se oculta: una
     * sección invisible con datos fiscales dentro es un dato que nadie puede
     * revisar ni borrar, y eso es peor que una sección de más.
     */
    readonly showWithholdings = computed<boolean>(() => {
        this.form_value();
        return !this.isExport() || this.withholdingRules.length > 0;
    });

    /**
     * Cuántas retenciones hay configuradas que el tipo de documento no aplica.
     * `0` se traduce a `null` para que la plantilla no pinte el aviso.
     */
    readonly inapplicableWithholdings = computed<number | null>(() => {
        this.form_value();
        if (!this.isExport()) return null;
        const count = this.withholdingRules.length;
        return count > 0 ? count : null;
    });

    readonly withholdingsSummary = computed<string>(() => {
        this.form_value();
        const count = this.withholdingRules.controls.filter(
            (control) => Number(control.get('concept_id')?.value ?? 0) > 0,
        ).length;
        if (count === 0) return 'Sin retenciones precargadas';
        return count === 1 ? '1 concepto' : count + ' conceptos';
    });

    readonly currencySummary = computed<string>(() => {
        this.form_value();
        const declares = this.form.get('currency.declare_foreign')?.value === true;
        const code = String(this.form.get('currency.code')?.value ?? '').trim();
        if (!declares) return 'Sólo pesos colombianos';
        return code ? 'Declara conversión a ' + code : 'Declara conversión — falta la divisa';
    });

    readonly formatSummary = computed<string>(() => {
        this.form_value();
        const id = this.numberOrNull(this.form.get('format.template_id')?.value);
        if (id !== null) {
            const found = this.print_templates().find((t) => t.id === id);
            return 'Plantilla ' + (found ? '«' + found.name + '»' : '#' + id);
        }
        const key = String(this.form.get('format.template_key')?.value ?? '').trim();
        return key.length > 0 ? 'Plantilla «' + key + '»' : 'Plantilla de la tienda';
    });

    /**
     * Errores por sección, para el contador de la cabecera plegable.
     *
     * Ocho secciones plegadas pueden esconder el campo que el validador
     * rechazó. Sin el contador, «revisa el formulario» es un callejón sin
     * salida: el problema vive tres secciones más abajo, cerrado.
     */
    readonly sectionErrors = computed<Record<SectionId, number>>(() => {
        const empty: Record<SectionId, number> = {
            documento: 0,
            lineas: 0,
            impuestos: 0,
            aiu: 0,
            retenciones: 0,
            divisa: 0,
            contabilidad: 0,
            formato: 0,
            general: 0,
            preview: 0,
            historial: 0,
        };
        for (const issue of this.blockers()) {
            empty[this.sectionOf(issue.field)] += 1;
        }
        // El nombre del perfil vive fuera de toda sección, pero su error tiene
        // que contarse en alguna o el usuario ve «1 problema» sin ninguna
        // sección marcada. Va a «documento», la primera.
        const name = this.form.get('name');
        if (name && name.touched && name.invalid) empty.documento += 1;
        return empty;
    });

    constructor() {
        // Biblioteca del Hub para el selector de plantilla de impresión. Se pide
        // una vez al abrir: es una lista corta y de otro dominio.
        this.printGateway
            .listLibraryTemplates('fiscal_electronic_invoice')
            .subscribe({
                next: (templates) =>
                    this.print_templates.set(
                        templates.map((t) => ({
                            id: t.id,
                            name: t.name,
                            is_system: t.is_system,
                        })),
                    ),
                error: () => this.print_templates_failed.set(true),
            });

        // El catálogo de plantillas se necesita para sembrar por `?template=`.
        // Es constante versionada en el backend, así que pedirlo al entrar no
        // compite con nada ni se invalida.
        this.store.dispatch(ProfileActions.loadProfileTemplates());

        // Los rangos autorizados de la tienda, para el selector de resolución
        // preferida. Se piden acá y no se asume que ya estén: al entrar por URL
        // directa al editor, nadie pasó por el listado que los carga.
        this.store.dispatch(loadResolutions());

        // Conceptos de retención. Mismo servicio que la vista de emisión: si el
        // editor tuviera su propia carga, un concepto nuevo aparecería en una
        // pantalla y no en la otra, y el perfil podría guardar un `concept_id`
        // que la factura no sabe pintar.
        this.withholdingCatalog
            .load()
            .pipe(takeUntilDestroyed())
            .subscribe((concepts) => this.withholding_concepts.set(concepts));

        // Al entrar en modo edición, cargar el detalle. El listado sólo trae la
        // fila; el snapshot de configuración viene con el detalle.
        effect(() => {
            const id = this.profileId();
            if (id !== null) {
                this.store.dispatch(ProfileActions.loadProfile({ id }));
            }
        });

        // Hidratar cuando llega el detalle. Se compara por id para no
        // re-hidratar —y perder lo que el usuario escribió— cada vez que el
        // store emite por otra razón.
        effect(() => {
            const profile = this.current();
            const config = this.current_config();
            if (!profile || profile.id !== this.profileId() || !config) return;
            if (this.loaded_config() !== null) return;
            this.hydrate(profile, config);
        });

        // En creación, sembrar una sola vez: la plantilla que nombra
        // `?template=` si ya llegó el catálogo, o la AIU por omisión.
        //
        // Se espera al catálogo ANTES de caer al default: sembrar el default y
        // luego pisarlo al llegar la plantilla borraría lo que el usuario
        // hubiera escrito en el intervalo.
        effect(() => {
            if (this.isEdit() || this.loaded_config() !== null) return;
            const key = this.seedTemplateKey();
            const catalog = this.templates();
            if (key !== null) {
                const template = catalog.find((entry) => entry.key === key);
                if (!template) return; // catálogo aún en vuelo
                this.hydrateFromConfig(template.config, '', template.operation_type);
                return;
            }
            this.hydrateFromConfig(
                buildDefaultAiuProfileConfig(),
                '',
                this.seedOperationType(),
            );
        });
    }

    // ── Secciones plegables ─────────────────────────────────────────────────
    isSectionOpen(section: SectionId): boolean {
        return this.openSections().has(section);
    }

    setSection(section: SectionId, open: boolean): void {
        const next = new Set(this.openSections());
        if (open) next.add(section);
        else next.delete(section);
        this.openSections.set(next);
    }

    onHeaderAction(id: string): void {
        if (id === 'save') this.save();
        else if (id === 'cancel') this.cancel();
    }

    // ── Accesos a los sub-grupos ────────────────────────────────────────────
    get aiuGroup(): FormGroup {
        return this.form.get('aiu') as FormGroup;
    }
    get taxRules(): FormArray {
        return this.form.get('taxes') as FormArray;
    }
    get modelLines(): FormArray {
        return this.form.get('model_lines') as FormArray;
    }
    get headerNotes(): FormArray {
        return this.form.get('dian.header_notes') as FormArray;
    }
    get withholdingRules(): FormArray {
        return this.form.get('withholdings') as FormArray;
    }
    get currencyGroup(): FormGroup {
        return this.form.get('currency') as FormGroup;
    }

    /** Versión vigente del perfil abierto; 0 mientras no hay detalle. */
    currentVersionNumber(): number {
        return this.current()?.current_version ?? 0;
    }

    /** Objeto de contrato tal como está en el formulario, para sembrar el panel. */
    currentContractObject(): string {
        return String(this.aiuGroup.get('contract_object')?.value ?? '');
    }

    operationType(): string {
        return String(this.form.get('operation_type')?.value ?? '09');
    }

    // ── Etiquetas ───────────────────────────────────────────────────────────
    componentLabel(component: string): string {
        return (
            {
                administracion: 'Administración',
                imprevistos: 'Imprevistos',
                utilidad: 'Utilidad',
            }[component] ?? component
        );
    }

    bucketLabel(bucket: string): string {
        return bucket === 'costo' ? 'Costo reembolsable' : this.componentLabel(bucket);
    }

    contractObjectHelp(): string {
        return (
            'Se puede sobrescribir en cada factura. Vacío se permite guardar, pero la ' +
            'emisión lo exige: sin objeto de contrato el documento se rechaza antes de ' +
            'tomar consecutivo.'
        );
    }

    minimumBaseHelp(): string {
        return this.aiuGroup.get('regime')?.value === 'decreto_1372_1992'
            ? 'El Decreto 1372/1992 no fija piso; desactivar la exigencia es lo habitual.'
            : 'El art. 462-1 E.T. fija el 10 % del valor del contrato como mínimo.';
    }

    // ── Suma de componentes, en centésimas ──────────────────────────────────
    private componentsSumScaled(): number {
        return AIU_COMPONENTS.reduce((total, component) => {
            const scaled = parsePercentScaled(this.aiuGroup.get(component)?.value);
            return total + (scaled ?? 0);
        }, 0);
    }

    /** Unidad efectiva de los tres porcentajes. Ver `AiuComponentsBasis`. */
    componentsBasis(): AiuComponentsBasis {
        this.form_value();
        return this.aiuGroup.get('components_basis')?.value === 'aiu'
            ? 'aiu'
            : 'contract';
    }

    /**
     * El párrafo que explica el reparto, dicho SOBRE LA UNIDAD ELEGIDA.
     *
     * Antes era prosa fija que explicaba la unidad `'contract'`. Con la unidad
     * puesta en `'aiu'` la pantalla quedaba diciendo que «la suma de los tres
     * ES el AIU y lo que falte hasta el 100 % es costo» justo al lado de un
     * contador que exige que sumen 100: dos afirmaciones incompatibles, y la
     * equivocada era la que se lee primero.
     *
     * Los mismos tres números significan cosas distintas según la unidad —es
     * la advertencia que ya trae el selector—, así que la explicación no puede
     * ser la misma en los dos casos.
     */
    componentsBasisExplainer(): string {
        return this.componentsBasis() === 'aiu'
            ? 'El reparto que se aplica a las líneas de la factura. Con la unidad «el AIU» los tres porcentajes reparten el AIU entre sí y por eso tienen que sumar 100 %: qué porción del contrato es AIU lo decide el importe de cada factura, no este reparto.'
            : 'El reparto que se aplica a las líneas de la factura. Con la unidad «valor del contrato» —como se redacta un contrato AIU— la suma de los tres ES el AIU, y lo que falte hasta el 100 % es costo reembolsable.';
    }

    componentsSumOk(): boolean {
        this.form_value();
        if (!this.isAiu()) return true;
        const sum = this.componentsSumScaled();
        if (this.componentsBasis() === 'aiu') return sum === 10000;
        // Sobre el contrato la suma ES el AIU: cualquier cosa entre un punto y
        // el 100 % es legítima, pero por debajo del piso exigido no lo es —y
        // eso se puede saber acá, antes de gastar un consecutivo.
        if (sum <= 0 || sum > 10000) return false;
        const floor = parsePercentScaled(
            this.aiuGroup.get('minimum_base_percent')?.value,
        );
        const enforced =
            this.aiuGroup.get('regime')?.value === 'et_462_1' &&
            this.aiuGroup.get('enforce_minimum_base')?.value === true;
        return !(enforced && floor !== null && sum < floor);
    }

    componentsSumLabel(): string {
        this.form_value();
        return formatPercentScaled(this.componentsSumScaled());
    }

    /**
     * La cifra que la referencia de negocio muestra como cabecera de la columna
     * «Base AIU» de la matriz de impuestos: el AIU como porcentaje del contrato.
     *
     * Sólo existe con la unidad `'contract'`. Con la unidad `'aiu'` la suma es
     * siempre 100 y no dice nada del contrato, así que aquí devuelve `null` en
     * vez de un 100 % que se leería como «todo el contrato es AIU».
     */
    aiuOfContractLabel(): string | null {
        this.form_value();
        if (this.componentsBasis() !== 'contract') return null;
        return formatPercentScaled(this.componentsSumScaled());
    }

    /**
     * Cabecera de la columna «Utilidad»: la utilidad como porcentaje del
     * contrato. Bajo el Decreto 1372/1992 es, literalmente, la base gravable
     * del documento — el número que hay que revisar dos veces.
     */
    utilidadOfContractLabel(): string | null {
        this.form_value();
        if (this.componentsBasis() !== 'contract') return null;
        const scaled = parsePercentScaled(this.aiuGroup.get('utilidad')?.value);
        return scaled === null ? null : formatPercentScaled(scaled);
    }

    /** Sufijo de la etiqueta de cada porcentaje: sobre qué se mide. */
    componentUnitSuffix(): string {
        return this.componentsBasis() === 'contract'
            ? ' (% del contrato)'
            : ' (% del AIU)';
    }

    /** Lo que el operador tiene que ver junto a la suma. */
    componentsSumTarget(): string {
        return this.componentsBasis() === 'contract'
            ? '= AIU del contrato'
            : '/ 100,00 %';
    }

    readonly components_basis_options = [
        { value: 'contract', label: 'Valor del contrato' },
        { value: 'aiu', label: 'El AIU (suman 100 %)' },
    ];

    /**
     * Aviso de contradicción entre el régimen y la matriz.
     *
     * No sustituye al validador —que lo reporta como bloqueo— sino que lo
     * explica en la sección donde se arregla, porque el mensaje del validador
     * aparece al pie y no dice en qué fila mirar.
     */
    regimeMismatch(): string | null {
        this.form_value();
        if (!this.isAiu()) return null;
        const regime = this.aiuGroup.get('regime')?.value;
        if (regime !== 'decreto_1372_1992') return null;
        const offenders = this.taxRules.controls.filter((control) => {
            const bucket = control.get('bucket')?.value as AiuBucket;
            const taxable = Boolean(control.get('taxable')?.value);
            return taxable && bucket !== 'utilidad';
        });
        if (offenders.length === 0) return null;
        return (
            'Bajo el Decreto 1372/1992 sólo la Utilidad lleva IVA. Hay ' +
            offenders.length +
            ' regla(s) gravando otros componentes: el XML declararía una base que sus ' +
            'propias líneas no respaldan y la DIAN lo rechaza (FAU04).'
        );
    }

    // ── Problemas por sección ───────────────────────────────────────────────

    /**
     * A qué sección pertenece el campo que el validador señaló.
     *
     * Las cuentas por componente AIU se mapean a `aiu` y NO a `contabilidad`,
     * porque es ahí donde ahora se editan (bloque 2 de la referencia). Marcar
     * «Contabilidad» por un error que vive dentro de «Configuración AIU»
     * mandaría al usuario a una sección donde el campo no está.
     *
     * Lo mismo con la matriz de impuestos: en un perfil AIU vive en el bloque 4,
     * así que su error enciende `aiu`; en uno estándar tiene sección propia.
     */
    private sectionOf(field: string): SectionId {
        if (field.startsWith('accounting.revenue_account_by_bucket.')) {
            const bucket = field.split('.').pop();
            return bucket === 'costo' ? 'contabilidad' : this.isAiu() ? 'aiu' : 'contabilidad';
        }
        const root = field.split(/[.[]/)[0];
        switch (root) {
            case 'aiu':
                return 'aiu';
            case 'accounting':
                return 'contabilidad';
            case 'taxes':
                return this.isAiu() ? 'aiu' : 'impuestos';
            case 'model_lines':
                return 'lineas';
            case 'format':
                return 'formato';
            case 'withholdings':
                return 'retenciones';
            case 'currency':
                return 'divisa';
            case 'dian':
                return 'documento';
            default:
                return 'general';
        }
    }

    issueFor(field: string): string {
        const issue = this.issues().find((candidate) => candidate.field === field);
        return issue ? issue.message : '';
    }

    controlError(path: string): string {
        const control = this.form.get(path);
        if (!control || !control.touched || control.valid) return '';
        if (control.hasError('required')) return 'Obligatorio';
        if (control.hasError('maxlength')) return 'Demasiado largo';
        return 'Valor inválido';
    }

    // ── Arreglos ────────────────────────────────────────────────────────────
    addTaxRule(): void {
        this.taxRules.push(
            this.fb.group({
                bucket: ['administracion'],
                taxable: [true],
                tax_code: ['01'],
                rate: ['19.00'],
            }),
        );
    }
    removeTaxRule(index: number): void {
        this.taxRules.removeAt(index);
    }
    addModelLine(): void {
        this.modelLines.push(
            this.fb.group({
                // Fuera de AIU el selector de componente no se pinta, así que el
                // valor por omisión es el único que la línea va a tener: tiene
                // que ser el que NO es componente del régimen. Con
                // «administracion» un perfil estándar habría precargado sus
                // líneas como parte de un AIU que ese documento no declara.
                bucket: [this.isAiu() ? 'administracion' : 'costo'],
                description: [''],
                unit_code: ['94'],
                quantity: ['1'],
                // Precio EN BLANCO por omisión, no cero: un cero se ve como un
                // precio decidido y una factura con línea a cero pasa la
                // validación de forma. El blanco dice «esto se teclea».
                unit_price: [''],
            }),
        );
    }
    removeModelLine(index: number): void {
        this.modelLines.removeAt(index);
    }

    /**
     * ¿Esta línea modelo lleva la base AIU configurada?
     *
     * Es `bucket` distinto de «costo», la misma semántica que la vista de
     * emisión lee de `aiu_component` no vacío. No hay campo nuevo en el
     * snapshot: el interruptor sólo hace visible una decisión que ya viajaba.
     */
    lineCarriesAiu(index: number): boolean {
        const bucket = this.modelLines.at(index)?.get('bucket')?.value;
        return String(bucket ?? '') !== 'costo';
    }

    /**
     * Enciende o apaga la base AIU de una línea modelo.
     *
     * Al encender se propone el primer componente GRAVABLE del régimen elegido:
     * bajo el Decreto 1372/1992 sólo la Utilidad lleva IVA, así que proponer
     * «Administración» ahí sembraría en el perfil una línea que declara una base
     * que su propio régimen no grava. Es la misma regla que aplica la vista de
     * emisión, y está escrita dos veces a propósito: cada pantalla lee el régimen
     * de una fuente distinta —acá el formulario, allá los ajustes de la tienda—.
     */
    toggleLineAiu(index: number, on: boolean): void {
        const control = this.modelLines.at(index)?.get('bucket');
        if (!control) return;
        if (!on) {
            control.setValue('costo');
            control.markAsDirty();
            return;
        }
        if (this.lineCarriesAiu(index)) return;
        const regime = this.form.get('aiu.regime')?.value;
        control.setValue(
            regime === 'decreto_1372_1992' ? 'utilidad' : 'administracion',
        );
        control.markAsDirty();
    }
    /**
     * Nueva fila de retención.
     *
     * La tarifa nace VACÍA a propósito. Sembrarla con la del catálogo en cuanto
     * se elige el concepto sería más cómodo, pero dejaría una tarifa fiscal
     * puesta por el sistema y con aspecto de revisada; acá el operador la
     * escribe, y el selector le muestra al lado la del catálogo para compararla.
     */
    addWithholding(): void {
        const group = this.fb.group({
            concept_id: [null as number | null],
            role: ['practiced'],
            rate: [''],
        });
        this.wireCatalogRate(group);
        this.withholdingRules.push(group);
    }
    removeWithholding(index: number): void {
        this.withholdingRules.removeAt(index);
    }

    /**
     * Al elegir concepto, escribe su tarifa de catálogo — pero SÓLO si la
     * casilla está vacía.
     *
     * Sin esto la fila nace en error: la tarifa vacía es inválida, y el mensaje
     * de error tapa justamente el texto de ayuda que decía cuál es la tarifa del
     * catálogo. El operador veía «la tarifa tiene que ser un porcentaje» sin
     * ninguna pista de cuál.
     *
     * No sobrescribe una tarifa ya escrita a propósito: el catálogo es el caso
     * normal, no la única verdad. Un mismo concepto se retiene a tarifa distinta
     * cuando hay un convenio o una base especial, y pisar ese número al volver a
     * tocar el selector sería cambiar un dato fiscal sin que nadie lo pidiera.
     *
     * `takeUntilDestroyed` necesita el `DestroyRef` explícito: esto corre desde
     * un método, fuera del contexto de inyección del constructor.
     */
    private wireCatalogRate(group: FormGroup): void {
        const concept = group.get('concept_id');
        const rate = group.get('rate');
        if (!concept || !rate) return;
        concept.valueChanges
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((value) => {
                if (String(rate.value ?? '').trim() !== '') return;
                const found = this.withholding_concepts().find(
                    (c) => c.id === Number(value ?? 0),
                );
                if (!found) return;
                rate.setValue(found.ratePercent.toFixed(2));
                // `setValue` NO marca el control como `dirty`, y el guardado se
                // apoya en el estado del formulario para saber que hay algo que
                // guardar. Sin esto la tarifa se ve en pantalla y no se envía.
                rate.markAsDirty();
            });
    }

    /** La tarifa del catálogo para el concepto de una fila, o `null`. */
    catalogRateFor(index: number): string | null {
        const id = Number(
            this.withholdingRules.at(index)?.get('concept_id')?.value ?? 0,
        );
        if (!id) return null;
        const concept = this.withholding_concepts().find((c) => c.id === id);
        return concept ? concept.ratePercent.toFixed(2) : null;
    }

    addHeaderNote(): void {
        this.headerNotes.push(this.fb.control(''));
    }
    removeHeaderNote(index: number): void {
        this.headerNotes.removeAt(index);
    }

    // ── Hidratación ─────────────────────────────────────────────────────────
    private hydrate(profile: InvoiceProfileDetail, config: InvoiceProfileConfig): void {
        this.hydrateFromConfig(config, profile.name, profile.operation_type);
    }

    private hydrateFromConfig(
        config: InvoiceProfileConfig,
        name: string,
        operation_type: string,
    ): void {
        // Antes del patch: lo que el snapshot ya decía de la resolución, para
        // poder reguardarlo si la fila viva desapareció (ver `hydrated_resolution`).
        this.hydrated_resolution.set({
            id: config.dian.resolution_id ?? null,
            number: config.dian.resolution_number ?? null,
        });
        this.form.patchValue(
            {
                name,
                operation_type,
                general: {
                    description: config.general.description ?? '',
                    internal_note: config.general.internal_note ?? '',
                },
                accounting: {
                    revenue_administracion:
                        config.accounting.revenue_account_by_bucket?.administracion ?? '',
                    revenue_imprevistos:
                        config.accounting.revenue_account_by_bucket?.imprevistos ?? '',
                    revenue_utilidad:
                        config.accounting.revenue_account_by_bucket?.utilidad ?? '',
                    revenue_costo:
                        config.accounting.revenue_account_by_bucket?.costo ?? '',
                    vat_payable_account: config.accounting.vat_payable_account ?? '',
                },
                format: {
                    template_id: config.format.template_id ?? null,
                    template_key: config.format.template_key ?? '',
                    show_aiu_breakdown: config.format.show_aiu_breakdown,
                    display_decimals: config.format.display_decimals,
                },
                dian: {
                    resolution_id: config.dian.resolution_id ?? null,
                    // Un snapshot anterior a este campo no dice nada del tipo de
                    // documento, y «nada» significa venta nacional: es el valor
                    // con que se guardó y con que se emitió entonces.
                    document_type: config.dian.document_type ?? 'sales_invoice',
                    payment_means_code: config.dian.payment_means_code ?? '',
                    payment_method_code: config.dian.payment_method_code ?? '',
                },
                currency: {
                    declare_foreign: config.currency?.declare_foreign === true,
                    code: config.currency?.code ?? '',
                },
            },
            { emitEvent: false },
        );

        if (config.aiu) {
            this.aiuGroup.patchValue(
                {
                    regime: config.aiu.regime,
                    contract_object: config.aiu.contract_object,
                    enforce_minimum_base: config.aiu.enforce_minimum_base,
                    minimum_base_percent: config.aiu.minimum_base_percent,
                    // Un perfil guardado antes de que existiera este campo
                    // trae los porcentajes medidos sobre el AIU. Leerlo como
                    // `'contract'` multiplicaría por diez su base gravable.
                    components_basis: resolveAiuComponentsBasis(config.aiu),
                    administracion: config.aiu.components.administracion,
                    imprevistos: config.aiu.components.imprevistos,
                    utilidad: config.aiu.components.utilidad,
                },
                { emitEvent: false },
            );
        }

        this.taxRules.clear({ emitEvent: false });
        for (const rule of config.taxes.rules) {
            this.taxRules.push(
                this.fb.group({
                    bucket: [rule.bucket],
                    taxable: [rule.taxable],
                    tax_code: [rule.tax_code],
                    rate: [rule.rate],
                }),
                { emitEvent: false },
            );
        }

        this.modelLines.clear({ emitEvent: false });
        for (const line of config.model_lines) {
            this.modelLines.push(
                this.fb.group({
                    bucket: [line.bucket],
                    description: [line.description],
                    unit_code: [line.unit_code ?? ''],
                    quantity: [line.quantity ?? ''],
                    unit_price: [line.unit_price ?? ''],
                }),
                { emitEvent: false },
            );
        }

        this.withholdingRules.clear({ emitEvent: false });
        for (const rule of config.withholdings?.rules ?? []) {
            const group = this.fb.group({
                concept_id: [rule.concept_id ?? null],
                role: [rule.role ?? 'practiced'],
                rate: [rule.rate ?? ''],
            });
            // También en las filas hidratadas: si alguien borra la tarifa y
            // cambia el concepto, el catálogo vuelve a rellenarla. Con la tarifa
            // ya escrita el enganche no hace nada, así que no puede pisar lo
            // guardado.
            this.wireCatalogRate(group);
            this.withholdingRules.push(group, { emitEvent: false });
        }

        this.headerNotes.clear({ emitEvent: false });
        for (const note of config.dian.header_notes ?? []) {
            this.headerNotes.push(this.fb.control(note), { emitEvent: false });
        }

        this.loaded_config.set(JSON.stringify(config));
        // Un `updateValueAndValidity` explícito porque todo lo anterior fue con
        // `emitEvent: false`: sin esto `form_value` no vería la hidratación y
        // los problemas se calcularían sobre el formulario vacío.
        this.form.updateValueAndValidity();
    }

    // ── Construcción del snapshot ───────────────────────────────────────────
    private nullIfEmpty(value: unknown): string | null {
        const text = String(value ?? '').trim();
        return text.length > 0 ? text : null;
    }

    /**
     * `'55'` → `55`. Cualquier otra cosa → `null`.
     *
     * El selector devuelve el valor como CADENA, y `template_id` es una FK a
     * `print_templates` que el validador exige entera y positiva. Mandar `'55'`
     * produciría un 422 que nombra un campo que el operador acaba de elegir de
     * una lista — el peor error posible: correcto a la vista, rechazado al
     * guardar.
     */
    private numberOrNull(value: unknown): number | null {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    /**
     * El tipo de documento del formulario, o `null` si no es uno de los dos.
     *
     * Un valor desconocido se guarda como `null` —«venta nacional»— y NO se
     * copia tal cual: el snapshot es lo que se precarga meses después, y un
     * literal inventado ahí acabaría traduciéndose a un `fiscal_document_type`
     * que no corresponde. El validador también lo rechaza; esto evita llegar a
     * enseñarle un 422 por algo que el selector nunca debió producir.
     */
    private documentTypeOrNull(value: unknown): ProfileDocumentType | null {
        return PROFILE_DOCUMENT_TYPES.includes(value as ProfileDocumentType)
            ? (value as ProfileDocumentType)
            : null;
    }

    private buildConfig(): InvoiceProfileConfig {
        const raw = this.form.getRawValue() as Record<string, any>;
        const accounting = raw['accounting'] ?? {};

        const revenue: Record<string, string> = {};
        for (const bucket of AIU_BUCKETS) {
            const account = this.nullIfEmpty(accounting['revenue_' + bucket]);
            if (account) revenue[bucket] = account;
        }

        const rules: ProfileTaxRule[] = this.taxRules.controls.map((control) => ({
            bucket: control.get('bucket')?.value as AiuBucket,
            taxable: Boolean(control.get('taxable')?.value),
            tax_code: String(control.get('tax_code')?.value ?? ''),
            rate: String(control.get('rate')?.value ?? '0.00'),
        }));

        const model_lines: ProfileModelLine[] = this.modelLines.controls.map((control) => ({
            bucket: control.get('bucket')?.value as AiuBucket,
            description: String(control.get('description')?.value ?? ''),
            unit_code: this.nullIfEmpty(control.get('unit_code')?.value),
            quantity: this.nullIfEmpty(control.get('quantity')?.value),
            unit_price: this.nullIfEmpty(control.get('unit_price')?.value),
        }));

        // Sólo las filas con concepto elegido. Una fila a medio llenar —el
        // usuario pulsó «Retención» y no eligió nada— no es una retención sin
        // concepto: es una fila que no existe. Guardarla produciría un 422 que
        // nombra un campo que el operador no llegó a tocar.
        const withholding_rules: ProfileWithholdingRule[] = this.withholdingRules.controls
            .filter((control) => Number(control.get('concept_id')?.value ?? 0) > 0)
            .map((control) => ({
                concept_id: Number(control.get('concept_id')?.value),
                role: (control.get('role')?.value === 'suffered'
                    ? 'suffered'
                    : 'practiced') as WithholdingRole,
                rate: String(control.get('rate')?.value ?? '').trim(),
            }));

        const currencyRaw = raw['currency'] ?? {};
        const currencyCode = this.nullIfEmpty(currencyRaw['code']);

        const notes = this.headerNotes.controls
            .map((control) => String(control.value ?? '').trim())
            .filter((note) => note.length > 0);

        const aiuRaw = raw['aiu'] ?? {};
        return {
            config_version: INVOICE_PROFILE_CONFIG_VERSION,
            general: {
                description: this.nullIfEmpty(raw['general']?.description),
                internal_note: this.nullIfEmpty(raw['general']?.internal_note),
            },
            // `null` y no un objeto vacío cuando la operación no es AIU: el
            // validador distingue las dos cosas, y un objeto con régimen
            // heredado en un perfil estándar reaparecería al cambiar el tipo.
            aiu: this.isAiu()
                ? {
                      regime: aiuRaw['regime'],
                      contract_object: String(aiuRaw['contract_object'] ?? ''),
                      enforce_minimum_base: Boolean(aiuRaw['enforce_minimum_base']),
                      minimum_base_percent: String(aiuRaw['minimum_base_percent'] ?? '0.00'),
                      // Explícito y nunca ausente: en el snapshot la ausencia
                      // significa la unidad heredada, y un perfil recién
                      // guardado no debe depender de ese default.
                      components_basis:
                          aiuRaw['components_basis'] === 'aiu' ? 'aiu' : 'contract',
                      components: {
                          administracion: String(aiuRaw['administracion'] ?? '0.00'),
                          imprevistos: String(aiuRaw['imprevistos'] ?? '0.00'),
                          utilidad: String(aiuRaw['utilidad'] ?? '0.00'),
                      },
                  }
                : null,
            accounting: {
                revenue_account_by_bucket: Object.keys(revenue).length > 0 ? revenue : null,
                vat_payable_account: this.nullIfEmpty(accounting['vat_payable_account']),
                mapping_key_overrides: null,
            },
            taxes: { rules },
            model_lines,
            format: {
                template_id: this.numberOrNull(raw['format']?.template_id),
                template_key: this.nullIfEmpty(raw['format']?.template_key),
                show_aiu_breakdown: Boolean(raw['format']?.show_aiu_breakdown),
                display_decimals: Number(raw['format']?.display_decimals ?? 2),
            },
            withholdings: { rules: withholding_rules },
            currency: {
                declare_foreign: currencyRaw['declare_foreign'] === true,
                // El código se guarda aunque la conversión esté apagada: apagar
                // la sección no debería borrar la divisa que alguien eligió, y
                // el validador ya declara legal ese par (`code` sin
                // `declare_foreign` no bloquea).
                code: currencyCode ? currencyCode.toUpperCase() : null,
            },
            dian: {
                document_type: this.documentTypeOrNull(raw['dian']?.document_type),
                payment_means_code: this.nullIfEmpty(raw['dian']?.payment_means_code),
                payment_method_code: this.nullIfEmpty(raw['dian']?.payment_method_code),
                header_notes: notes.length > 0 ? notes : null,
                resolution_id: this.selectedResolutionId(),
                // El número se guarda JUNTO al id para que un aviso pueda
                // nombrar la resolución a la que apuntaba el perfil cuando esa
                // fila ya no puede numerar. Con sólo el id, el aviso diría «la
                // preferencia no sirve» sin decir cuál era.
                resolution_number: this.resolvedResolutionNumber(),
            },
        };
    }


    // ── Guardar y salir ─────────────────────────────────────────────────────

    /** Vuelve al listado. Se usa desde «Cancelar» y tras guardar. */
    private leave(): void {
        this.store.dispatch(ProfileActions.clearCurrentProfile());
        void this.router.navigate(['/admin/invoicing/profiles']);
    }

    cancel(): void {
        this.leave();
    }

    save(): void {
        this.server_error.set(null);
        this.form.markAllAsTouched();

        if (this.form.get('name')?.invalid) {
            // El nombre vive fuera de las secciones y siempre está a la vista,
            // así que no hay nada que desplegar: basta con no continuar.
            return;
        }

        const issues = this.blockers();
        if (issues.length > 0) {
            // Desplegar la sección del primer bloqueo. Dejar al usuario en una
            // página con el pie diciendo que hay problemas mientras la sección
            // que los contiene está plegada es cómo se convierte un mensaje
            // correcto en un usuario perdido.
            const first = issues[0];
            if (first) this.setSection(this.sectionOf(first.field), true);
            return;
        }

        const config = this.buildConfig();
        const name = String(this.form.get('name')?.value ?? '').trim();
        const id = this.profileId();

        if (id === null) {
            this.store.dispatch(
                ProfileActions.createProfile({
                    payload: {
                        name,
                        operation_type: this.operationType(),
                        config,
                    },
                }),
            );
            this.leave();
            return;
        }

        // `config` sólo si cambió: mandarlo idéntico crea una versión nueva sin
        // diferencias y ensucia el historial que la auditoría fiscal lee.
        const payload: UpdateInvoiceProfilePayload = { name };
        if (JSON.stringify(config) !== this.loaded_config()) {
            payload.config = config;
        }
        this.store.dispatch(
            ProfileActions.updateProfile({
                id,
                payload: payload as unknown as Record<string, unknown>,
            }),
        );
        this.leave();
    }
}
