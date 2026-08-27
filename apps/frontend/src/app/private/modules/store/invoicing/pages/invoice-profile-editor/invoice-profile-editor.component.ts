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
    AbstractControl,
    FormBuilder,
    FormArray,
    FormControl,
    FormGroup,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
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
} from '../../../../../../shared/components/index';
import type { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';
import {
    AIU_BUCKETS,
    AIU_LEGAL_FLOOR_PERCENT_SCALED,
    CONFIG_LIMITS,
    INVOICE_PROFILE_CONFIG_VERSION,
    PROFILE_DOCUMENT_TYPES,
    blockingIssues,
    buildDefaultAiuProfileConfig,
    formatPercentScaled,
    isBlockingIssue,
    normalizeInvoiceProfileConfig,
    regimeFromTaxableBasis,
    resolveAccountingModel,
    resolveAiuComponentsBasis,
    resolveAiuTaxableBasis,
    validateInvoiceProfileConfig,
} from '../../../../../../core/utils/invoice-profile-config.contract';
import type {
    AccountingModel,
    AiuBucket,
    AiuComponentsBasis,
    AiuTaxableBasis,
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
/**
 * SECCIÓN AIU COMPARTIDA con «Nueva factura». Ver el docblock del componente:
 * los controles son los mismos en las dos pantallas y `context` sólo cambia la
 * ayuda. Este editor le entrega su propio `FormGroup` y el mapa de rutas.
 */
import {
    InvoiceSectionAiuComponent,
    derivedCostTaxRule as derivedAiuCostTaxRule,
    asAiuTaxableBasis,
    aiuComponentsSumScaled,
    aiuTaxableBasisShortLabel,
    firstTaxableAiuComponent,
} from '../../../../../../shared/components/invoice-sections/index';
import type {
    AiuSectionPaths,
    AiuTaxRuleValue,
} from '../../../../../../shared/components/invoice-sections/index';
/**
 * SECCIÓN DOCUMENTO COMPARTIDA con «Nueva factura» (B.2). Mismo componente,
 * mismos controles: resolución, tipo de documento, forma y medio de pago, y
 * notas de cabecera. Las fechas se ocultan en este contexto («profile»).
 */
import { InvoiceSectionDocumentoComponent } from '../../../../../../shared/components/invoice-sections/index';
import type {
    DocumentoSectionErrors,
    DocumentoSectionNotice,
    DocumentoSectionPaths,
} from '../../../../../../shared/components/invoice-sections/index';
/**
 * SECCIÓN LÍNEAS COMPARTIDA con «Líneas» de la factura (B.3). El componente
 * tiene dos plantillas internas por contexto —acá no hay picker de producto
 * ni impuestos por línea—, así que el editor sólo le pasa `context="profile"`
 * y su propio mapa de rutas. Ver el docblock del componente.
 */
import { InvoiceSectionLineasComponent } from '../../../../../../shared/components/invoice-sections/index';
import type {
    LineasRowErrors,
    LineasRowPaths,
} from '../../../../../../shared/components/invoice-sections/index';
/**
 * SECCIÓN IMPUESTOS COMPARTIDA con el agregado de línea de la factura (B.4).
 * El editor le pasa `context="profile"`: el componente pinta la matriz
 * editable por porción (`taxes` FormArray) y el editor sigue dueño de
 * `addTaxRule()`/`removeTaxRule()`. Ver el docblock del componente.
 */
import { InvoiceSectionImpuestosComponent } from '../../../../../../shared/components/invoice-sections/index';
/**
 * SECCIÓN RETENCIONES COMPARTIDA con la factura (B.5). El editor no tiene
 * importe manual ni base gravable —la base es del documento, no del
 * perfil—, así que sólo le pasa concepto, lado y tarifa. Ver el docblock
 * del componente.
 */
import { InvoiceSectionRetencionesComponent } from '../../../../../../shared/components/invoice-sections/index';
import type { RetencionesRowErrors } from '../../../../../../shared/components/invoice-sections/index';
/**
 * SECCIÓN DIVISA COMPARTIDA con la factura (B.6). El perfil no consulta
 * ninguna TRM —eso es del día de cada factura, no algo que un perfil pueda
 * congelar—, así que sólo le pasa el interruptor y la divisa. Ver el
 * docblock del componente.
 */
import { InvoiceSectionDivisaComponent } from '../../../../../../shared/components/invoice-sections/index';
import type { DivisaSectionPaths } from '../../../../../../shared/components/invoice-sections/index';
/**
 * SECCIONES FORMATO Y NOTAS INTERNAS COMPARTIDAS con «Nueva factura» (B.7 —
 * cierre del re-cableado del editor). Mismo componente, mismos controles: el
 * editor le pasa `context="profile"` y sus rutas `format.*` / `general.*`.
 * Ver el docblock de cada componente.
 */
import {
    InvoiceSectionFormatoComponent,
    InvoiceSectionNotasComponent,
} from '../../../../../../shared/components/invoice-sections/index';
import type {
    FormatoSectionPaths,
    NotasSectionPaths,
} from '../../../../../../shared/components/invoice-sections/index';
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
/**
 * SELECTOR DE CUENTA PUC CON BÚSQUEDA. Vive bajo `products` porque nació allí,
 * y se importa desde aquí en vez de duplicarse: es el único sitio del frontend
 * que traduce código↔id contra el plan de cuentas, y su propio docblock explica
 * qué se rompe cuando alguien guarda un id donde el motor contable espera un
 * código. Una segunda copia de esa traducción es exactamente el fallo mudo que
 * ese componente existe para evitar. Merece subir a `shared/components`.
 */
import { AccountCodeSelectComponent } from '../../../products/components/account-code-select.component';
import * as ProfileActions from '../../state/actions/invoice-profile.actions';
import { loadResolutions } from '../../state/actions/invoicing.actions';
import { selectResolutions } from '../../state/selectors/invoicing.selectors';
import type { InvoiceResolution } from '../../interfaces/invoice.interface';
import { profileHelp } from '../../utils/invoice-section-help';
import { sectionsFor } from '../../utils/invoice-section-order';
import type { ProfileScreenSectionId } from '../../utils/invoice-section-order';
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
 * Secciones del editor. NO se enumeran aquí: se derivan del orden canónico que
 * comparte con «Nueva factura» (`utils/invoice-section-order.ts`).
 *
 * El editor es un espejo de la emisión —quien configura un perfil y quien emite
 * una factura recorren la misma pantalla—, y una sección que aquí va tercera y
 * allá séptima obliga a aprender dos mapas de la misma cosa. Enumerarlas por
 * separado en cada pantalla es exactamente lo que hizo que AIU acabara antes de
 * Líneas en una y después en la otra.
 *
 * Del lado de la emisión hay dos secciones que un perfil NO tiene, y no por
 * falta de trabajo:
 *
 *  - **Perfil** — un perfil no se preconfigura con otro perfil.
 *  - **Adquiriente** — el cliente es del documento, no de la configuración.
 *    Precargar un adquiriente sería el peor default imaginable en una pantalla
 *    que gasta numeración autorizada.
 *
 * **Divisa sí está en las dos**: lo que el perfil no puede llevar congelado es
 * la TASA, que es del día de cada factura. La divisa sí se preconfigura.
 *
 * Las que hoy existen sólo aquí —Formato, Notas internas, Previsualización e
 * Historial— están en la constante compartida marcadas como tales; el orden es
 * el mismo para el día en que las tres primeras suban a la emisión.
 */
type SectionId = ProfileScreenSectionId;

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
        StickyHeaderComponent,
        InvoiceFormSectionComponent,
        AlertBannerComponent,
        ButtonComponent,
        IconComponent,
        InputComponent,
        SelectorComponent,
        AccountCodeSelectComponent,
        InvoiceSectionAiuComponent,
        InvoiceSectionDocumentoComponent,
        InvoiceSectionLineasComponent,
        InvoiceSectionImpuestosComponent,
        InvoiceSectionRetencionesComponent,
        InvoiceSectionDivisaComponent,
        InvoiceSectionFormatoComponent,
        InvoiceSectionNotasComponent,
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
                        <!--
                            B.2: sección compartida con «Nueva factura»
                            («InvoiceSectionDocumentoComponent», contexto
                            «profile»). El aviso de retenciones inaplicables
                            se queda en la PÁGINA, no en el componente
                            compartido: depende de «withholdingRules», que es
                            ajeno a esta sección —la decisión de negocio
                            («¿aplica retención a una exportación?») sigue
                            siendo de la pantalla; el componente sólo pinta el
                            marcado compartido de resolución, tipo de
                            documento, forma/medio de pago y notas—.
                        -->
                        @if (inapplicableWithholdings(); as count) {
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
                        <vendix-invoice-section-documento
                            context="profile"
                            [form]="form"
                            [paths]="documentoSectionPaths"
                            [invoiceTypeOptions]="document_type_options"
                            [paymentFormOptions]="payment_form_options"
                            [paymentMeansOptions]="payment_means_options"
                            [resolutionControl]="resolutionControl"
                            [resolutionOptions]="resolution_options()"
                            resolutionPlaceholder="Sin preferencia — la factura elige la vigente más antigua"
                            resolutionHelpText="Para cuando la tienda tiene varios rangos autorizados vivos a la vez. Es una preferencia: si el rango no puede numerar el día de la emisión, la factura usa la vigente más antigua y lo avisa."
                            [resolutionHint]="documentoResolutionHint()"
                            [notices]="documentoNotices()"
                            [errors]="documentoErrors()"
                            [headerNoteErrors]="headerNoteErrors()"
                            [headerNoteLimit]="header_note_limit"
                        ></vendix-invoice-section-documento>
                    </vendix-invoice-form-section>

                    <!-- ══ AIU ══ los CUATRO BLOQUES.
                         La BASE GRAVABLE y el objeto del contrato van antes de
                         los cuatro porque la base decide qué porciones son
                         gravables, y el bloque 4 se lee contra esa decisión:
                         presentar la matriz de tributos antes de la base invita
                         a llenarla y que después se contradiga con la base que
                         el propio perfil declara. -->
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
                            <!--
                                LA SECCIÓN AIU ES UN SOLO COMPONENTE, COMPARTIDO
                                CON «Nueva factura».

                                Antes eran dos marcados de los mismos campos: acá
                                los controles completos, allá 359 líneas de sólo
                                lectura con UN control editable. Esa duplicación
                                es la que hacía que un arreglo urgente se aplicara
                                en la pantalla donde se reportó y la otra quedara
                                atrás sin que nadie lo note.

                                «context» decide sólo la AYUDA y la sugerencia de
                                tributos, no qué controles existen: en un perfil
                                no hay adquiriente del que derivar
                                responsabilidades fiscales, y dejar un campo
                                vacío significa «lo decide cada factura», no «no
                                aplica».

                                «issues» son los del validador del contrato, que
                                sólo existen en esta pantalla: un perfil se
                                valida contra el contrato al guardarlo, y una
                                factura no se guarda como perfil.
                            -->
                            <vendix-invoice-section-aiu
                                context="profile"
                                [form]="form"
                                [paths]="aiuSectionPaths"
                                [taxRules]="taxRules"
                                [issues]="issues()"
                            ></vendix-invoice-section-aiu>
                        </vendix-invoice-form-section>
                    }

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
                            </div>
                            @if (modelLines.controls.length === 0) {
                                <p class="text-xs text-text-secondary italic">
                                    Sin líneas modelo. La factura abrirá con una
                                    línea vacía, como en el flujo manual.
                                </p>
                            }
                            <!--
                                B.3: sección compartida con «Líneas» de la
                                factura («InvoiceSectionLineasComponent»). El
                                botón «Línea» del pie lo pinta el propio
                                componente en su rama de contexto «profile».
                            -->
                            <vendix-invoice-section-lineas
                                context="profile"
                                [rows]="modelLines.controls"
                                [rowPaths]="lineasRowPaths"
                                [isAiu]="isAiu()"
                                [aiuComponentOptions]="component_options"
                                [descriptionLimit]="line_description_limit"
                                [rowErrors]="lineasRowErrors()"
                                [carriesAiu]="lineCarriesAiuBound"
                                [toggleAiu]="toggleLineAiuBound"
                                [maxLines]="999"
                                emptyStateText="Sin líneas modelo. La factura abrirá con una línea vacía, como en el flujo manual."
                                (addBlankLine)="addModelLine()"
                                (removeLine)="removeModelLine($event)"
                            ></vendix-invoice-section-lineas>
                        </div>
                    </vendix-invoice-form-section>

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
                            <vendix-invoice-section-impuestos
                                context="profile"
                                [rows]="taxRules.controls"
                                [bucketOptions]="bucket_options()"
                                [taxCodeOptions]="tax_code_options"
                                [rateErrors]="taxRateErrors()"
                                (addRule)="addTaxRule()"
                                (removeRule)="removeTaxRule($event)"
                            ></vendix-invoice-section-impuestos>
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
                            <vendix-invoice-section-retenciones
                                context="profile"
                                [rows]="withholdingRules.controls"
                                [conceptOptions]="withholding_concept_options()"
                                [roleOptions]="withholding_role_options"
                                [rowErrors]="retencionesRowErrors()"
                                [catalogRateFor]="catalogRateForBound"
                                emptyStateText="Sin retenciones. La factura abrirá sin ninguna fila, y se pueden añadir al emitir."
                                [exportWarningText]="
                                    isExport() && withholdingRules.length > 0
                                        ? 'El tipo de documento es exportación y una exportación no está sujeta a retención en Colombia. Estas filas se seguirán precargando: quítalas si no corresponden.'
                                        : null
                                "
                                (addWithholding)="addWithholding()"
                                (removeWithholding)="removeWithholding($event)"
                            ></vendix-invoice-section-retenciones>
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
                        <vendix-invoice-section-divisa
                            context="profile"
                            [form]="form"
                            [paths]="divisaSectionPaths"
                            [currencyOptions]="currency_options"
                            [errors]="divisaErrors()"
                        ></vendix-invoice-section-divisa>
                    </vendix-invoice-form-section>

                    <!-- ══ CONTABILIDAD ══ espejo de la sección homónima.
                         En un perfil AIU las CINCO cuentas —las tres porciones,
                         el costo reembolsable y el IVA por pagar— viven en el
                         bloque 2 de la sección AIU, que es el componente que la
                         factura comparte. Pintarlas también aquí ataría DOS
                         controles a la misma casilla del formulario: se
                         mantendrían sincronizados, pero el operador no sabría
                         cuál es la que manda y buscaría la diferencia. Aquí
                         quedan sólo cuando el perfil NO es AIU, donde no hay
                         sección AIU que las aloje.

                         B.6 evaluó extraer TAMBIÉN esta rama (no-AIU) a un
                         componente compartido con la factura y concluyó que
                         no hay campo en común: aquí son dos cuentas FIJAS
                         por bucket («revenue_costo», «vat_payable_account»);
                         la factura fuerza una cuenta por defecto MÁS un mapa
                         de overrides por línea, porque una factura tiene
                         líneas que un perfil no tiene. Cero controles
                         compartibles — ver el comentario espejo en
                         «invoice-create-page.component.ts». -->
                    <vendix-invoice-form-section
                        title="Contabilidad"
                        [help]="help('contabilidad')"
                        icon="book"
                        [summary]="accountingSummary()"
                        [errorCount]="sectionErrors().contabilidad"
                        [expanded]="isSectionOpen('contabilidad')"
                        (expandedChange)="setSection('contabilidad', $event)"
                    >
                        <div class="space-y-2" formGroupName="accounting">
                            <p class="text-xs text-text-secondary">
                                Vacío = se usa el mapeo contable de la tienda.
                            </p>
                            @if (isAiu()) {
                                <app-alert-banner
                                    variant="info"
                                    icon="info"
                                    tone="token"
                                >
                                    Las cinco cuentas de este perfil —
                                    Administración, Imprevistos, Utilidad, Costo
                                    reembolsable e IVA por pagar— se configuran en
                                    <strong>Configuración AIU</strong>, bloque
                                    «Cuentas para contabilización AIU». Es la misma
                                    sección que ve quien emite la factura.
                                </app-alert-banner>
                            } @else {
                                <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                                    <app-account-code-select
                                        label="Ingreso · Costo reembolsable"
                                        formControlName="revenue_costo"
                                        placeholder="Mapeo contable de la tienda"
                                        [error]="
                                            issueFor(
                                                'accounting.revenue_account_by_bucket.costo'
                                            )
                                        "
                                    ></app-account-code-select>
                                    <app-account-code-select
                                        label="Cuenta de IVA por pagar"
                                        formControlName="vat_payable_account"
                                        placeholder="Mapeo contable de la tienda"
                                        [error]="issueFor('accounting.vat_payable_account')"
                                    ></app-account-code-select>
                                </div>
                            }
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
                        <!--
                            B.7: sección compartida con «Nueva factura»
                            («InvoiceSectionFormatoComponent», contexto
                            «profile»). El aviso del Hub, el selector de
                            plantilla, la clave legada, el desglose AIU y los
                            decimales viven en el componente; esta página sólo
                            aporta su FormGroup, las rutas y la biblioteca ya
                            cargada del Hub.
                        -->
                        <vendix-invoice-section-formato
                            context="profile"
                            [form]="form"
                            [paths]="formatoSectionPaths()"
                            [templateOptions]="print_template_options()"
                            [libraryFailed]="print_templates_failed()"
                            [templateKeyLimit]="template_key_limit"
                            [errors]="formatoErrors()"
                        ></vendix-invoice-section-formato>
                    </vendix-invoice-form-section>

                    <!-- ══ GENERAL ══ va al FINAL: es documentación interna, no
                         configuración fiscal. Arriba empujaba las secciones que
                         deciden el XML por debajo del pliegue. -->
                    <vendix-invoice-form-section
                        title="Notas internas"
                        [help]="help('notas_internas')"
                        icon="info"
                        summary="No viajan al XML"
                        [errorCount]="sectionErrors().notas_internas"
                        [expanded]="isSectionOpen('notas_internas')"
                        (expandedChange)="setSection('notas_internas', $event)"
                    >
                        <!-- B.7: misma sustitución — el par Descripción/Nota
                             interna vive ahora en el componente compartido. -->
                        <vendix-invoice-section-notas
                            context="profile"
                            [form]="form"
                            [paths]="notasSectionPaths"
                        ></vendix-invoice-section-notas>
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
                        [expanded]="isSectionOpen('previsualizacion')"
                        (expandedChange)="setSection('previsualizacion', $event)"
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
                    <app-alert-banner
                        variant="danger"
                        icon="alert-triangle"
                        tone="token"
                        heading="Falta esto para poder guardar"
                    >
                        <ul class="list-inside list-disc">
                            @for (
                                blocker of blockers();
                                track blocker.field + blocker.code
                            ) {
                                <li>{{ blocker.message }}</li>
                            }
                        </ul>
                    </app-alert-banner>
                }

                @if (server_error(); as message) {
                    <app-alert-banner
                        variant="danger"
                        icon="alert-triangle"
                        tone="token"
                    >
                        {{ message }}
                    </app-alert-banner>
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

    readonly line_description_limit = CONFIG_LIMITS.line_description;
    readonly template_key_limit = CONFIG_LIMITS.template_key;
    readonly header_note_limit = CONFIG_LIMITS.header_note;

    readonly operation_options = Object.entries(INVOICE_PROFILE_OPERATION_LABELS).map(
        ([value, label]) => ({ value, label }),
    );

    // Las TRES bases gravables —Subtotal / AIU / Utilidad— las enumera ahora
    // `AIU_TAXABLE_BASIS_OPTIONS` en `invoice-section-aiu.logic.ts`, junto al
    // selector que las pinta. Duplicar la lista acá fue lo que dejó la
    // pantalla de emisión enumerando dos bases cuando el perfil ya ofrecía
    // tres.

    /**
     * Bases que la matriz de tributos ofrece.
     *
     * En un perfil AIU «Costo reembolsable» NO se ofrece bajo NINGUNA de las
     * tres bases, y su fila no la escribe una persona: la escribe
     * `derivedCostTaxRule` desde la base elegida. La razón es que su valor
     * correcto está completamente determinado —`AIU_TAXABLE_BUCKETS_BY_BASIS`
     * dice si entra a la base, y el servidor rechaza cualquier otra
     * combinación— así que una casilla ahí sólo podía ofrecer decisiones que se
     * devuelven con 422: `TAX_COST_MUST_NOT_BE_TAXABLE` si se grava bajo `aiu` o
     * `utilidad`, `TAX_MATRIX_CONTRADICTS_REGIME` si se deja exento bajo
     * `subtotal`, y `TAX_RATE_ON_NON_TAXABLE` si conserva tarifa estando exento.
     *
     * En un perfil ESTÁNDAR sí se ofrece: ahí no hay base AIU que aplicar, las
     * líneas nacen precisamente en `costo` y sin esa opción no habría porción
     * alguna que gravar.
     */
    readonly bucket_options = computed<SelectorOption[]>(() => {
        const base: SelectorOption[] = [
            { value: 'administracion', label: 'Administración' },
            { value: 'imprevistos', label: 'Imprevistos' },
            { value: 'utilidad', label: 'Utilidad' },
        ];
        return this.isAiu()
            ? base
            : [...base, { value: 'costo', label: 'Costo reembolsable' }];
    });

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
            // La BASE GRAVABLE es el control; `regime` ya no lo es —se deriva
            // de ella al construir el snapshot—. Tener los dos como controles
            // habría dejado dos fuentes de verdad para la misma decisión, y la
            // que el cálculo lee es la base.
            taxable_basis: ['aiu' as AiuTaxableBasis],
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
            // Modelo de contabilización. `'sumada'` por omisión porque es el
            // ÚNICO habilitado (`ENABLED_ACCOUNTING_MODELS`) y porque es lo que
            // el calculador hace por construcción: un perfil que abre con este
            // valor no cambia de comportamiento ni nace `dirty`.
            accounting_model: ['sumada' as AccountingModel],
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
     * DÓNDE VIVE CADA CONTROL AIU EN ESTE FORMULARIO.
     *
     * La sección compartida no usa `formControlName`: recibe el `FormGroup` y
     * este mapa. Si usara `formControlName` obligaría a las dos pantallas a
     * nombrar sus controles igual, y no lo hacen —el documento tiene el objeto
     * del contrato en la raíz y la cuenta del costo reembolsable la comparte
     * con la cuenta por omisión de sus líneas—. El mapa es el precio de no
     * duplicar el marcado.
     *
     * Las cinco cuentas apuntan a `accounting`: siguen siendo del perfil, sólo
     * que se editan dentro del bloque AIU, que es donde se entienden.
     */
    readonly aiuSectionPaths: AiuSectionPaths = {
        taxable_basis: 'aiu.taxable_basis',
        contract_object: 'aiu.contract_object',
        enforce_minimum_base: 'aiu.enforce_minimum_base',
        minimum_base_percent: 'aiu.minimum_base_percent',
        components_basis: 'aiu.components_basis',
        components: {
            administracion: 'aiu.administracion',
            imprevistos: 'aiu.imprevistos',
            utilidad: 'aiu.utilidad',
        },
        revenue_account: {
            administracion: 'accounting.revenue_administracion',
            imprevistos: 'accounting.revenue_imprevistos',
            utilidad: 'accounting.revenue_utilidad',
            costo: 'accounting.revenue_costo',
        },
        vat_payable_account: 'accounting.vat_payable_account',
        // El control ya existía en el formulario de arriba (hidratado desde el
        // snapshot, viaja en el payload); lo que faltaba era pintarlo. C.6 lo
        // cierra: el BLOQUE 1 de `invoice-section-aiu.component.ts` pasó de dos
        // `div` estáticos a un radio real enlazado a esta ruta.
        accounting_model: 'aiu.accounting_model',
    };

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

    /**
     * SECCIÓN DOCUMENTO COMPARTIDA (B.2). El componente no usa
     * `formControlName`: recibe el `FormGroup` raíz y este mapa de rutas.
     * `issue_date`/`due_date`/`notes` quedan en `null` a propósito —un
     * perfil no tiene fecha de emisión propia y guarda sus notas en un
     * `FormArray` (`header_notes`), no en un control de texto único—.
     */
    readonly documentoSectionPaths: DocumentoSectionPaths = {
        invoice_type: 'dian.document_type',
        payment_form: 'dian.payment_method_code',
        payment_means_code: 'dian.payment_means_code',
        issue_date: null,
        due_date: null,
        notes: null,
        header_notes: 'dian.header_notes',
    };

    /**
     * Texto plano para el estado «sin resoluciones registradas». Sólo el
     * perfil lo pinta así: la factura ya tiene su propio aviso de peligro
     * dentro de `notices` (ver `resolutionEmptyReason` en «Nueva factura»).
     */
    readonly documentoResolutionHint = computed<string | null>(() =>
        this.resolution_options().length === 0
            ? 'No hay resoluciones de factura de venta registradas. Regístralas en Facturación → Resoluciones; sin rango autorizado la emisión no tiene de dónde tomar el consecutivo.'
            : null,
    );

    /**
     * `resolutionWarning()` pasa de párrafo suelto a `app-alert-banner`: es
     * la MISMA regla de accesibilidad que ya se aplicó en «Nueva factura»
     * —un aviso que un lector de pantalla no anuncia no es un aviso—, y de
     * paso queda dentro del vocabulario `notices` que ya entiende la
     * sección compartida.
     */
    readonly documentoNotices = computed<readonly DocumentoSectionNotice[]>(() => {
        const notices: DocumentoSectionNotice[] = [];
        const warning = this.resolutionWarning();
        if (warning) {
            notices.push({ variant: 'warning', text: warning });
        }
        return notices;
    });

    /**
     * Antes de este mapa, «Documento» era la única sección del editor que no
     * marcaba ninguno de sus cuatro campos con el error del validador del
     * contrato: la resolución, el tipo de documento y las dos formas de pago
     * se guardaban sin decir nada cuando estaban mal. `issueFor` ya resolvía
     * la ruta correcta —la usan las demás secciones—; sólo faltaba pintarla
     * aquí.
     */
    readonly documentoErrors = computed<DocumentoSectionErrors>(() => ({
        resolution: this.issueFor('dian.resolution_id'),
        invoice_type: this.issueFor('dian.document_type'),
        payment_form: this.issueFor('dian.payment_method_code'),
        payment_means_code: this.issueFor('dian.payment_means_code'),
    }));

    /** Un mensaje por índice de nota de cabecera, reactivo al `FormArray`. */
    readonly headerNoteErrors = computed<readonly string[]>(() => {
        this.form_value();
        return this.headerNotes.controls.map((_, index) =>
            this.issueFor('dian.header_notes[' + index + ']'),
        );
    });

    /**
     * SECCIÓN LÍNEAS COMPARTIDA (B.3). `aiu_field` apunta a `bucket` —así se
     * llama el control acá—; la factura apunta el mismo campo canónico a
     * `aiu_component`, el suyo (ADR-2). `discount_amount` y `taxes` quedan en
     * `null`: un perfil no descuenta por línea modelo ni declara impuestos
     * por línea —los declara por PORCIÓN, en la sección Impuestos (B.4)—.
     */
    readonly lineasRowPaths: LineasRowPaths = {
        description: 'description',
        quantity: 'quantity',
        unit_code: 'unit_code',
        unit_price: 'unit_price',
        discount_amount: null,
        aiu_field: 'bucket',
        taxes: null,
    };

    /** Un objeto de errores por línea modelo, en el vocabulario del componente. */
    readonly lineasRowErrors = computed<readonly LineasRowErrors[]>(() => {
        this.form_value();
        return this.modelLines.controls.map((_, i) => ({
            description: this.issueFor('model_lines[' + i + '].description'),
            unit_code: this.issueFor('model_lines[' + i + '].unit_code'),
            unit_price: this.issueFor('model_lines[' + i + '].unit_price'),
        }));
    });

    /**
     * Envoltorios de `lineCarriesAiu`/`toggleLineAiu` con la firma que espera
     * el componente compartido —`(row, index[, on])`—: esta pantalla
     * identifica la línea modelo por su ÍNDICE, no por su control, así que la
     * fila se ignora. Son campos de flecha, no métodos, para que `this` quede
     * fijo sin `.bind()` en la plantilla.
     */
    readonly lineCarriesAiuBound = (_row: AbstractControl, index: number): boolean =>
        this.lineCarriesAiu(index);
    readonly toggleLineAiuBound = (
        _row: AbstractControl,
        index: number,
        on: boolean,
    ): void => this.toggleLineAiu(index, on);

    /** Error de `rate` por fila de la matriz de impuestos (B.4). */
    readonly taxRateErrors = computed<readonly string[]>(() => {
        this.form_value();
        return this.taxRules.controls.map((_, i) =>
            this.issueFor('taxes.rules[' + i + '].rate'),
        );
    });

    /** Errores por fila de «Retenciones» (B.5): concepto y tarifa. */
    readonly retencionesRowErrors = computed<readonly RetencionesRowErrors[]>(() => {
        this.form_value();
        return this.withholdingRules.controls.map((_, i) => ({
            concept_id: this.issueFor('withholdings.rules[' + i + '].concept_id'),
            rate: this.issueFor('withholdings.rules[' + i + '].rate'),
        }));
    });

    /**
     * Envoltorio de `catalogRateFor` para el componente compartido: el método
     * usa `this.withholdingRules`/`this.withholding_concepts()`, así que
     * pasarlo desnudo perdería el `this`. Mismo criterio que en la factura.
     */
    readonly catalogRateForBound = (index: number): string | null =>
        this.catalogRateFor(index);

    /**
     * Rutas de «Divisa» (B.6). `exchange_rate`/`exchange_rate_date` quedan
     * en `null`: el perfil no guarda ninguna TRM, es del día de cada
     * factura.
     */
    readonly divisaSectionPaths: DivisaSectionPaths = {
        declare_foreign: 'currency.declare_foreign',
        currency_code: 'currency.code',
        exchange_rate: null,
        exchange_rate_date: null,
    };

    readonly divisaErrors = computed<{ currency_code?: string }>(() => ({
        currency_code: this.issueFor('currency.code'),
    }));

    /**
     * Rutas de «Formato» (B.7). Las cuatro existen en el formulario; la clave
     * legada sólo se EXPONE cuando el perfil guardado ya la trae —igual que
     * hacía el bloque inline—: enseñar siempre un input vacío del catálogo
     * anterior invitaría a escribir donde el Hub ya decidió. Es un `computed`
     * y no una constante por eso: el mapa respira con `hasLegacyTemplateKey`.
     */
    readonly formatoSectionPaths = computed<FormatoSectionPaths>(() => ({
        template_id: 'format.template_id',
        template_key: this.hasLegacyTemplateKey()
            ? 'format.template_key'
            : null,
        show_aiu_breakdown: 'format.show_aiu_breakdown',
        display_decimals: 'format.display_decimals',
    }));

    /** Errores del validador del contrato, en el vocabulario del componente. */
    readonly formatoErrors = computed<{
        template_id?: string;
        display_decimals?: string;
    }>(() => ({
        template_id: this.issueFor('format.template_id'),
        display_decimals: this.issueFor('format.display_decimals'),
    }));

    /**
     * Rutas de «Notas internas» (B.7). Los dos controles son del perfil y
     * viajan en el snapshot (`general`); no hay campo en `null` porque no
     * existe ninguno que este contexto legítimamente omita.
     */
    readonly notasSectionPaths: NotasSectionPaths = {
        description: 'general.description',
        internal_note: 'general.internal_note',
    };

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

    /**
     * ¿Es un perfil AIU? Decide qué secciones se pintan —la configuración AIU
     * frente a la matriz de impuestos ordinaria— y qué valida el snapshot.
     *
     * `form_value()` se lee sólo para DECLARAR LA DEPENDENCIA. El valor de un
     * `FormControl` no es una señal: sin ese disparador el `computed` se
     * calculaba una vez con el tipo inicial y no volvía a evaluarse nunca.
     * Cambiar «Tipo de operación» de AIU a Estándar dejaba la sección AIU
     * pintada y escondía la de Impuestos, así que se guardaba un perfil
     * Estándar habiendo configurado —y visto— un reparto AIU que el backend
     * descarta. Un perfil que muestra una cosa y guarda otra es peor que uno
     * incompleto.
     */
    readonly isAiu = computed(() => {
        this.form_value();
        return this.operationType() === '09';
    });

    /**
     * Secciones abiertas al entrar.
     *
     * Se abren las tres que TODO perfil necesita tocar, en el orden en que se
     * recorren: documento, AIU y líneas modelo. Abrirlas todas convierte la
     * página en un muro de ocho metros; abrir sólo una obliga a descubrir las
     * otras siete a ciegas.
     *
     * AIU va abierta ANTES de líneas porque decide qué componente lleva cada
     * línea: si se capturan primero las líneas, hay que recorrerlas otra vez.
     */
    private readonly openSections = signal<Set<SectionId>>(
        new Set<SectionId>(['documento', 'aiu', 'lineas']),
    );

    /**
     * Problemas del snapshot actual, con las MISMAS DOS MITADES que corre el
     * backend y en el mismo orden.
     *
     * ─── POR QUÉ NO BASTA CON `validateInvoiceProfileConfig` ─────────────────
     *
     * Porque no es la puerta del servidor. La única por la que un `config`
     * puede entrar a `invoice_profile_versions.config` es
     * `normalizeAndAssertProfileConfig`, que corre
     * `normalizeInvoiceProfileConfig` **antes** de validar y concatena los
     * problemas de las dos mitades en una sola lista: primero los
     * ESTRUCTURALES —claves desconocidas, contenedores del tipo equivocado— y
     * luego los FISCALES.
     *
     * Los `UNKNOWN_KEY` nacen en el normalizador, y este editor no lo corría.
     * Así que la pantalla decía «sin problemas», habilitaba «Guardar», y el
     * POST volvía con un 422 sobre un campo que la UI acababa de pintar —el
     * peor momento posible, porque el usuario ya dio la orden y el mensaje
     * nombra una clave que él no escribió—. Validar media puerta es peor que no
     * validar: promete un veredicto que el servidor no honra.
     *
     * El validador corre sobre el config NORMALIZADO, no sobre el crudo, por lo
     * mismo que en el backend: es la forma que de verdad se va a persistir.
     */
    readonly issues = computed<ProfileConfigIssue[]>(() => {
        // Se lee `form_value()` sólo para declarar la dependencia: el snapshot
        // se arma desde el formulario, que es la fuente de verdad de los
        // `FormArray` (el valor plano no distingue arreglos vacíos de ausentes).
        this.form_value();
        const { config, issues: structural } = normalizeInvoiceProfileConfig(
            this.buildConfig(),
        );
        return [
            ...structural,
            ...validateInvoiceProfileConfig(config, {
                operation_type: this.operationType(),
            }),
        ];
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
        // Se cuentan las filas VISIBLES: una fila de costo conservada y no
        // pintada haría que el resumen dijera «4 regla(s)» sobre una matriz de
        // tres, y el operador buscaría la cuarta sin encontrarla.
        const visible = this.visibleTaxRules();
        const taxable = visible.filter((row) =>
            Boolean(this.taxRules.at(row.index)?.get('taxable')?.value),
        ).length;
        if (visible.length === 0) return 'Sin reglas';
        return visible.length + ' regla(s) · ' + taxable + ' gravable(s)';
    });

    /**
     * Las filas de la matriz que se PINTAN, con su índice real en el `FormArray`.
     *
     * En un perfil AIU la fila del costo reembolsable NUNCA se pinta —bajo las
     * tres bases— pero SIEMPRE se guarda: la escribe `derivedCostTaxRule` desde
     * la base elegida. Sigue existiendo en el formulario porque es la constancia
     * de qué hizo el perfil con ese costo, y es lo que hace que la
     * previsualización lo liste entre las porciones omitidas.
     *
     * Cada fila lleva su índice REAL: es el que el `FormArray` usa y el que
     * nombran los mensajes del validador (`taxes.rules[i].rate`).
     */
    readonly visibleTaxRules = computed<{ index: number; bucket: string }[]>(() => {
        this.form_value();
        const hideCost = this.isAiu();
        return this.taxRules.controls
            .map((control, index) => ({
                index,
                bucket: String(control.get('bucket')?.value ?? ''),
            }))
            .filter((row) => !hideCost || row.bucket !== 'costo');
    });

    /**
     * Resumen de la cabecera de «Contabilidad».
     *
     * Cambia con el régimen porque el CONTENIDO de la sección cambia: en un
     * perfil AIU las cinco cuentas se editan en la sección AIU —la misma que
     * ve quien emite la factura— y acá sólo queda el señalamiento. Anunciar
     * «Costo reembolsable e IVA por pagar» sobre una sección que no los pinta
     * mandaría al operador a abrirla para no encontrarlos.
     */
    readonly accountingSummary = computed<string>(() => {
        return this.isAiu()
            ? 'Las cuentas AIU se editan en Configuración AIU'
            : 'Costo reembolsable e IVA por pagar';
    });

    readonly aiuSummary = computed<string>(() => {
        this.form_value();
        const basis =
            this.componentsBasis() === 'contract' ? ' del contrato' : ' del AIU';
        return (
            aiuTaxableBasisShortLabel(this.taxableBasis()) +
            ' · componentes ' +
            this.componentsSumLabel() +
            ' %' +
            basis
        );
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
        // Disparador explícito: además de `blockers()` esta cuenta mira si el
        // control «name» está TOCADO, y tocar un control sin cambiar su valor no
        // mueve ninguna señal. Sin esto, salir del nombre vacío no pintaba el
        // contador hasta el siguiente cambio en cualquier otro campo.
        this.form_value();
        // Se deriva del orden compartido en vez de escribirse a mano: una
        // sección nueva aparece aquí sola. Escribirlas dos veces es lo que hace
        // que una sección quede sin contador y su badge no se pinte nunca.
        const empty = Object.fromEntries(
            sectionsFor('profile').map((section) => [section, 0]),
        ) as Record<SectionId, number>;
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

        // LA BASE GRAVABLE Y LA MATRIZ SE ESCRIBEN JUNTAS, pero esa
        // reproyección YA NO VIVE ACÁ: la hace la sección compartida
        // (`vendix-invoice-section-aiu`), que es la que pinta el control de la
        // base. Duplicarla también acá dejaría DOS suscripciones escribiendo la
        // misma matriz sobre el mismo formulario: la segunda reproyectaría lo
        // que la primera acababa de reproyectar, y con la fila del costo —que se
        // AÑADE cuando falta— eso significa añadirla dos veces y que el
        // validador acuse una porción duplicada.
        //
        // Lo que sí sigue siendo de esta pantalla es guardar: `buildConfig`
        // vuelve a derivar la fila del costo desde el módulo de lógica
        // compartido, para que el snapshot que viaja al backend no dependa de
        // que la sección se haya pintado.

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

    taxableBasis(): AiuTaxableBasis {
        this.form_value();
        return asAiuTaxableBasis(this.aiuGroup.get('taxable_basis')?.value);
    }

    /** ¿Existe ya una regla de impuesto para esta porción? */
    private hasTaxRule(bucket: AiuBucket): boolean {
        return this.taxRules.controls.some(
            (control) => control.get('bucket')?.value === bucket,
        );
    }

    /** Unidad efectiva de los tres porcentajes. Ver `AiuComponentsBasis`. */
    componentsBasis(): AiuComponentsBasis {
        this.form_value();
        return this.aiuGroup.get('components_basis')?.value === 'aiu'
            ? 'aiu'
            : 'contract';
    }

    componentsSumLabel(): string {
        this.form_value();
        return formatPercentScaled(
            aiuComponentsSumScaled(this.aiuGroup.getRawValue()),
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
        // LAS CINCO CUENTAS DE UN PERFIL AIU SE EDITAN EN LA SECCIÓN AIU, así
        // que su error tiene que encender esa sección y no «Contabilidad»: el
        // costo reembolsable y el IVA por pagar dejaron de pintarse allí cuando
        // la sección pasó a ser el componente compartido, y señalar una sección
        // que ya no contiene el campo manda al usuario a buscarlo donde no está.
        if (
            field.startsWith('accounting.revenue_account_by_bucket.') ||
            field === 'accounting.vat_payable_account'
        ) {
            return this.isAiu() ? 'aiu' : 'contabilidad';
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
                // Fallback deliberado: un campo cuya raíz no reconocemos vive,
                // por descarte, en el bloque de datos generales del perfil —el
                // que la pantalla titula «Notas internas»—. Mandar el foco a
                // una sección concreta y equivocada es peor que mandarlo a la
                // única que no valida nada.
                return 'notas_internas';
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
     * Al encender se propone el primer componente GRAVABLE de la BASE elegida:
     * bajo la base Utilidad sólo la Utilidad lleva IVA, así que proponer
     * «Administración» ahí sembraría en el perfil una línea que declara una base
     * que el propio perfil no grava. Es la misma regla que aplica la vista de
     * emisión, y está escrita dos veces a propósito: cada pantalla lee la base
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
        control.setValue(firstTaxableAiuComponent(this.taxableBasis()));
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

    // Añadir/quitar una nota de cabecera ahora vive DENTRO de
    // `InvoiceSectionDocumentoComponent` (B.2): opera sobre
    // `headerNotesArray()`, resuelto vía `documentoSectionPaths.header_notes`
    // contra este mismo `this.form`. El getter `headerNotes` de abajo sigue
    // vivo porque lo usan `hydrate()` y el armado del payload.

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
                    // Un snapshot anterior a `taxable_basis` no lo trae: se
                    // DERIVA de `regime` sin reescribir nada. `resolveAiuTaxableBasis`
                    // es el único punto de lectura, el mismo que usan el
                    // validador y el calculador.
                    taxable_basis: resolveAiuTaxableBasis(config.aiu),
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
                    // Un perfil guardado antes de que existiera este campo no
                    // lo trae, y la ausencia significa `'sumada'`. Se resuelve
                    // por el único punto de lectura del contrato para que la
                    // pantalla y el cálculo no puedan discrepar.
                    accounting_model: resolveAccountingModel(config.aiu),
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
            // F.3: la misma cota (header_note_limit) que el `maxlength` nativo
            // del `app-input` en pantalla — sin esto, una nota hidratada que ya
            // venía larga (dato antiguo, o escrita antes de que este tope
            // existiera) se mostraría válida hasta el próximo guardado.
            this.headerNotes.push(
                this.fb.control(note, Validators.maxLength(this.header_note_limit)),
                { emitEvent: false },
            );
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

        // LA FILA DEL COSTO SE EMITE SIEMPRE Y NO LA ESCRIBE NADIE.
        //
        // Se reemplaza EN SU SITIO —no se filtra y se añade al final— para que
        // los índices que ve el validador sigan siendo los del `FormArray`: los
        // mensajes vuelven como `taxes.rules[i].rate` y la pantalla los pinta en
        // la fila `i`. Filtrar movería cada fila un puesto y el error aparecería
        // en la línea de al lado.
        //
        // Si no había fila, se añade AL FINAL: ahí su índice queda más allá de
        // toda fila visible, así que no le roba el sitio a ninguna.
        const aiuProfile = this.isAiu();
        const taxableBasisForRules = this.taxableBasis();
        // Instantánea CRUDA de la matriz antes de tocar nada:
        // `derivedAiuCostTaxRule` elige la tarifa de referencia leyendo las
        // OTRAS porciones, así que necesita la matriz completa. Derivarla
        // mientras se recorre habría leído filas ya reemplazadas.
        const rawRules: AiuTaxRuleValue[] = this.taxRules.controls.map((control) => ({
            bucket: control.get('bucket')?.value as AiuBucket,
            taxable: Boolean(control.get('taxable')?.value),
            tax_code: String(control.get('tax_code')?.value ?? ''),
            rate: String(control.get('rate')?.value ?? '0.00'),
        }));
        const rules: ProfileTaxRule[] = rawRules.map((rule) =>
            aiuProfile && rule.bucket === 'costo'
                ? derivedAiuCostTaxRule(rawRules, taxableBasisForRules)
                : rule,
        );
        if (aiuProfile && !this.hasTaxRule('costo')) {
            rules.push(derivedAiuCostTaxRule(rawRules, taxableBasisForRules));
        }

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
                      // `regime` se DERIVA de la base y se sigue persistiendo
                      // para los consumidores que todavía lo leen. Bajo
                      // «subtotal» no hay régimen legal al que colapsar, así que
                      // se escribe el MÁS AMPLIO —`et_462_1`—: un lector que
                      // ignore `taxable_basis` declarará de más (recuperable con
                      // nota crédito) y nunca de menos (sanción e intereses).
                      // Escribir `decreto_1372_1992` ahí gravaría sólo la
                      // utilidad de un contrato declarado gravado completo.
                      regime:
                          regimeFromTaxableBasis(
                              asAiuTaxableBasis(aiuRaw['taxable_basis']),
                          ) ?? 'et_462_1',
                      // Explícito y nunca ausente: es lo que gobierna el cálculo
                      // y la matriz, y su ausencia obligaría al servidor a
                      // deducirlo del régimen que este mismo objeto acaba de
                      // derivar de él.
                      taxable_basis: asAiuTaxableBasis(aiuRaw['taxable_basis']),
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
                      // Explícito y nunca ausente, igual que `components_basis`:
                      // decide la FORMA del XML, así que un perfil recién
                      // guardado no debe depender del default implícito. Se
                      // resuelve por el contrato, de modo que un valor corrupto
                      // en el formulario cae en `'sumada'` —el conservador— en
                      // vez de viajar y hacer que el guardado responda 422.
                      accounting_model: resolveAccountingModel({
                          accounting_model:
                              aiuRaw['accounting_model'] as AccountingModel | null,
                      }),
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
