import {
    Component,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
    FormArray,
    FormBuilder,
    FormGroup,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { Store } from '@ngrx/store';

import {
    ButtonComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    TextareaComponent,
    ToggleComponent,
} from '../../../../../../shared/components/index';
import {
    AIU_BUCKETS,
    AIU_COMPONENTS,
    AIU_LEGAL_FLOOR_PERCENT_SCALED,
    CONFIG_LIMITS,
    INVOICE_PROFILE_CONFIG_VERSION,
    blockingIssues,
    buildDefaultAiuProfileConfig,
    formatPercentScaled,
    isBlockingIssue,
    parsePercentScaled,
    validateInvoiceProfileConfig,
} from '../../../../../../core/utils/invoice-profile-config.contract';
import type {
    AiuBucket,
    InvoiceProfileConfig,
    ProfileConfigIssue,
    ProfileModelLine,
    ProfileTaxRule,
} from '../../../../../../core/utils/invoice-profile-config.contract';
import type {
    InvoiceProfileDetail,
    UpdateInvoiceProfilePayload,
} from '../../interfaces/invoice-profile.interface';
import { INVOICE_PROFILE_OPERATION_LABELS } from '../../interfaces/invoice-profile.interface';
import { InvoiceProfilePreviewPanelComponent } from '../../components/invoice-profile-preview-panel/invoice-profile-preview-panel.component';
import { InvoiceProfileVersionsPanelComponent } from '../../components/invoice-profile-versions-panel/invoice-profile-versions-panel.component';
import * as ProfileActions from '../../state/actions/invoice-profile.actions';
import {
    selectCurrentProfile,
    selectCurrentProfileConfig,
    selectCurrentProfileLoading,
    selectProfileSaving,
} from '../../state/selectors/invoice-profile.selectors';

/**
 * Sección del editor. El orden es el del requerimiento 7 y NO es cosmético:
 * `aiu` decide qué componentes son gravables, y `taxes` se lee contra esa
 * decisión — presentar impuestos antes del régimen invita a llenar una matriz
 * que después se contradice con su propio régimen.
 */
type EditorSection =
    | 'general'
    | 'aiu'
    | 'accounting'
    | 'taxes'
    | 'model_lines'
    | 'format'
    | 'dian'
    | 'preview'
    | 'history';

interface SectionTab {
    key: EditorSection;
    label: string;
    icon: string;
}

/**
 * Editor de un perfil de facturación — las 7 secciones del requerimiento 7.
 *
 * ## Por qué la validación de cliente es la MISMA función del backend
 *
 * `validateInvoiceProfileConfig` se importa de
 * `core/utils/invoice-profile-config.contract`, que es el espejo del contrato
 * que el backend usa para traducir a `INVOICING_PROFILE_005`. Escribir acá una
 * validación "equivalente" produciría dos reglas que divergen con el primer
 * cambio, y la divergencia se paga de la peor forma posible: el editor deja
 * guardar algo que la puerta de emisión rechaza semanas después, con el
 * consecutivo en juego. Usar la misma función hace imposible ese desfase — si
 * cambia la regla, cambia en las dos puntas a la vez o no compila.
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
        ModalComponent,
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
        <app-modal
            [isOpen]="true"
            [title]="modalTitle()"
            [subtitle]="modalSubtitle()"
            size="xl"
            [closeOnBackdrop]="false"
            [fullScreenOnMobile]="true"
            (closed)="requestClose()"
            (cancel)="requestClose()"
        >
            <form [formGroup]="form" class="flex flex-col gap-3">
                <!-- Identidad del perfil: nombre y tipo de operación son
                     COLUMNAS, no parte del snapshot; por eso van fuera de las
                     secciones y no dentro de "general". -->
                <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <app-input
                        label="Nombre del perfil"
                        formControlName="name"
                        [maxlength]="120"
                        [control]="form.get('name')"
                        [error]="controlError('name')"
                        helperText="Único por tienda y tipo de operación."
                    ></app-input>
                    <app-selector
                        label="Tipo de operación"
                        formControlName="operation_type"
                        [options]="operation_options"
                        [disabled]="isEdit()"
                        [helpText]="
                            isEdit()
                                ? 'No se cambia después de crear: la matriz de impuestos y el régimen se guardaron para este tipo.'
                                : 'Determina qué secciones aplican y cómo se arma el XML.'
                        "
                    ></app-selector>
                </div>

                <!-- Pestañas de sección. Botones reales, no divs: se recorren
                     con Tab y se activan con Enter/Espacio sin código extra. -->
                <div
                    class="flex gap-1 overflow-x-auto border-b border-border pb-1"
                    role="tablist"
                    aria-label="Secciones del perfil"
                >
                    @for (tab of visibleTabs(); track tab.key) {
                        <button
                            type="button"
                            role="tab"
                            [attr.aria-selected]="section() === tab.key"
                            [attr.aria-controls]="'section-' + tab.key"
                            class="flex shrink-0 items-center gap-1 rounded-t-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors md:text-xs"
                            [class.bg-primary]="section() === tab.key"
                            [class.text-white]="section() === tab.key"
                            [class.text-text-secondary]="section() !== tab.key"
                            (click)="section.set(tab.key)"
                        >
                            <app-icon [name]="tab.icon" [size]="14"></app-icon>
                            {{ tab.label }}
                            @if (sectionIssueCount(tab.key) > 0) {
                                <span
                                    class="rounded-full bg-danger px-1.5 text-[10px] font-bold text-white"
                                    [attr.aria-label]="
                                        sectionIssueCount(tab.key) + ' problemas en esta sección'
                                    "
                                >
                                    {{ sectionIssueCount(tab.key) }}
                                </span>
                            }
                        </button>
                    }
                </div>

                <!-- ── 1. General ── -->
                @if (section() === 'general') {
                    <div id="section-general" class="flex flex-col gap-2" formGroupName="general">
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
                }

                <!-- ── 2. AIU ── -->
                @if (section() === 'aiu' && isAiu()) {
                    <div id="section-aiu" class="flex flex-col gap-2" formGroupName="aiu">
                        <app-selector
                            label="Régimen de IVA del contrato"
                            formControlName="regime"
                            [options]="regime_options"
                            helpText="Decide qué componentes entran a la base gravable."
                        ></app-selector>

                        <app-textarea
                            label="Objeto del contrato (valor por omisión)"
                            formControlName="contract_object"
                            [rows]="2"
                            [helperText]="contractObjectHelp()"
                        ></app-textarea>

                        <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
                            @for (component of aiu_components; track component) {
                                <app-input
                                    [label]="componentLabel(component) + ' (%)'"
                                    [formControlName]="component"
                                    type="text"
                                    [control]="aiuGroup.get(component)"
                                    [error]="issueFor('aiu.components.' + component)"
                                ></app-input>
                            }
                        </div>

                        <div
                            class="rounded-lg border px-3 py-2 text-xs md:text-sm"
                            [class.border-danger]="!componentsSumOk()"
                            [class.bg-danger]="false"
                            [class.text-danger]="!componentsSumOk()"
                            [class.border-border]="componentsSumOk()"
                            [class.text-text-secondary]="componentsSumOk()"
                            role="status"
                        >
                            Suma de componentes: {{ componentsSumLabel() }} / 100,00 %
                        </div>

                        <div class="flex items-center gap-2">
                            <app-toggle
                                formControlName="enforce_minimum_base"
                                label="Exigir base gravable mínima"
                            ></app-toggle>
                        </div>
                        <app-input
                            label="Base mínima (% del valor del contrato)"
                            formControlName="minimum_base_percent"
                            type="text"
                            [control]="aiuGroup.get('minimum_base_percent')"
                            [error]="issueFor('aiu.minimum_base_percent')"
                            [helperText]="minimumBaseHelp()"
                        ></app-input>
                    </div>
                }

                <!-- ── 3. Contabilidad ── -->
                @if (section() === 'accounting') {
                    <div
                        id="section-accounting"
                        class="flex flex-col gap-2"
                        formGroupName="accounting"
                    >
                        <p class="text-xs text-text-secondary">
                            Cuentas del PUC por componente. Vacío = se usa el mapeo contable
                            de la tienda.
                        </p>
                        <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                            @for (bucket of aiu_buckets; track bucket) {
                                <app-input
                                    [label]="'Ingreso · ' + bucketLabel(bucket)"
                                    [formControlName]="'revenue_' + bucket"
                                    [maxlength]="account_code_limit"
                                    [error]="
                                        issueFor('accounting.revenue_account_by_bucket.' + bucket)
                                    "
                                ></app-input>
                            }
                        </div>
                        <app-input
                            label="Cuenta de IVA por pagar"
                            formControlName="vat_payable_account"
                            [maxlength]="account_code_limit"
                            [error]="issueFor('accounting.vat_payable_account')"
                        ></app-input>
                    </div>
                }

                <!-- ── 4. Impuestos ── -->
                @if (section() === 'taxes') {
                    <div id="section-taxes" class="flex flex-col gap-2">
                        <div class="flex items-center justify-between">
                            <p class="text-xs text-text-secondary">
                                Una regla por componente. Lo que aquí se marque gravable es lo
                                que emite <code>cac:TaxTotal</code> en el XML.
                            </p>
                            <app-button variant="secondary" (clicked)="addTaxRule()">
                                <app-icon slot="icon" name="plus" [size]="14"></app-icon>
                                Regla
                            </app-button>
                        </div>
                        @if (regimeMismatch(); as mismatch) {
                            <div
                                class="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger md:text-sm"
                                role="alert"
                            >
                                {{ mismatch }}
                            </div>
                        }
                        <div class="flex flex-col gap-2" formArrayName="taxes">
                            @for (rule of taxRules.controls; track $index) {
                                <div
                                    class="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2 md:grid-cols-5"
                                    [formGroupName]="$index"
                                >
                                    <app-selector
                                        label="Componente"
                                        formControlName="bucket"
                                        [options]="bucket_options"
                                    ></app-selector>
                                    <div class="flex items-center pb-2">
                                        <app-toggle
                                            formControlName="taxable"
                                            label="Gravable"
                                        ></app-toggle>
                                    </div>
                                    <app-input
                                        label="Código"
                                        formControlName="tax_code"
                                        [maxlength]="4"
                                        [error]="issueFor('taxes.rules[' + $index + '].tax_code')"
                                    ></app-input>
                                    <app-input
                                        label="Tarifa (%)"
                                        formControlName="rate"
                                        [error]="issueFor('taxes.rules[' + $index + '].rate')"
                                    ></app-input>
                                    <app-button
                                        variant="outline-danger"
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
                }

                <!-- ── 5. Líneas modelo ── -->
                @if (section() === 'model_lines') {
                    <div id="section-model_lines" class="flex flex-col gap-2">
                        <div class="flex items-center justify-between">
                            <p class="text-xs text-text-secondary">
                                Descripciones con que se arman las líneas del documento. Sin
                                líneas modelo, se usan las descripciones por omisión.
                            </p>
                            <app-button variant="secondary" (clicked)="addModelLine()">
                                <app-icon slot="icon" name="plus" [size]="14"></app-icon>
                                Línea
                            </app-button>
                        </div>
                        <div class="flex flex-col gap-2" formArrayName="model_lines">
                            @for (line of modelLines.controls; track $index) {
                                <div
                                    class="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-2 md:grid-cols-5"
                                    [formGroupName]="$index"
                                >
                                    <app-selector
                                        label="Componente"
                                        formControlName="bucket"
                                        [options]="bucket_options"
                                    ></app-selector>
                                    <div class="md:col-span-2">
                                        <app-input
                                            label="Descripción"
                                            formControlName="description"
                                            [maxlength]="line_description_limit"
                                            [error]="
                                                issueFor('model_lines[' + $index + '].description')
                                            "
                                        ></app-input>
                                    </div>
                                    <app-input
                                        label="Unidad"
                                        formControlName="unit_code"
                                        [maxlength]="4"
                                        [error]="issueFor('model_lines[' + $index + '].unit_code')"
                                    ></app-input>
                                    <app-button
                                        variant="outline-danger"
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
                }

                <!-- ── 6. Formato ── -->
                @if (section() === 'format') {
                    <div id="section-format" class="flex flex-col gap-2" formGroupName="format">
                        <app-input
                            label="Plantilla de impresión"
                            formControlName="template_key"
                            [maxlength]="template_key_limit"
                            helperText="Vacío = la plantilla por omisión de la tienda."
                        ></app-input>
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
                            [error]="issueFor('format.display_decimals')"
                        ></app-input>
                    </div>
                }

                <!-- ── 7. DIAN ── -->
                @if (section() === 'dian') {
                    <div id="section-dian" class="flex flex-col gap-2" formGroupName="dian">
                        <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                            <app-input
                                label="Medio de pago (código DIAN)"
                                formControlName="payment_means_code"
                                [maxlength]="4"
                                [error]="issueFor('dian.payment_means_code')"
                            ></app-input>
                            <app-input
                                label="Método de pago (código DIAN)"
                                formControlName="payment_method_code"
                                [maxlength]="4"
                                [error]="issueFor('dian.payment_method_code')"
                            ></app-input>
                        </div>
                        <div class="flex items-center justify-between">
                            <p class="text-xs text-text-secondary">
                                Notas de cabecera. Se concatenan a los
                                <code>cbc:Note</code> del documento.
                            </p>
                            <app-button variant="secondary" (clicked)="addHeaderNote()">
                                <app-icon slot="icon" name="plus" [size]="14"></app-icon>
                                Nota
                            </app-button>
                        </div>
                        <div class="flex flex-col gap-2" formArrayName="header_notes">
                            @for (note of headerNotes.controls; track $index) {
                                <div class="flex items-end gap-2">
                                    <div class="flex-1">
                                        <app-input
                                            [label]="'Nota ' + ($index + 1)"
                                            [formControlName]="$index"
                                            [maxlength]="header_note_limit"
                                            [error]="issueFor('dian.header_notes[' + $index + ']')"
                                        ></app-input>
                                    </div>
                                    <app-button
                                        variant="outline-danger"
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
                }

                <!-- ── Previsualización (E.5) ── -->
                @if (section() === 'preview' && profileId() !== null) {
                    <div id="section-preview">
                        <vendix-invoice-profile-preview-panel
                            [profileId]="profileId()"
                            [isAiu]="isAiu()"
                            [contractObject]="currentContractObject()"
                        ></vendix-invoice-profile-preview-panel>
                    </div>
                }

                <!-- ── Historial de versiones (E.7) ── -->
                @if (section() === 'history' && profileId() !== null) {
                    <div id="section-history">
                        <vendix-invoice-profile-versions-panel
                            [profileId]="profileId()"
                            [currentVersion]="currentVersionNumber()"
                        ></vendix-invoice-profile-versions-panel>
                    </div>
                }

                <!-- Avisos que NO bloquean. Se pintan siempre, en cualquier
                     sección: el usuario tiene que poder verlos desde donde esté
                     antes de pulsar Guardar. -->
                @if (warnings().length > 0) {
                    <div
                        class="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning md:text-sm"
                        role="status"
                    >
                        <ul class="list-inside list-disc">
                            @for (warning of warnings(); track warning.code) {
                                <li>{{ warning.message }}</li>
                            }
                        </ul>
                    </div>
                }

                <!-- Bloqueos: lista completa, no el primero. El validador
                     devuelve todos a propósito. -->
                @if (blockers().length > 0) {
                    <div
                        class="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger md:text-sm"
                        role="alert"
                    >
                        <ul class="list-inside list-disc">
                            @for (blocker of blockers(); track blocker.field + blocker.code) {
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
            </form>

            <div slot="footer" class="flex flex-col gap-2 md:flex-row md:justify-end">
                <app-button variant="outline" (clicked)="requestClose()">Cancelar</app-button>
                <app-button
                    variant="primary"
                    [disabled]="saving() || blockers().length > 0"
                    (clicked)="save()"
                >
                    <app-icon slot="icon" name="save" [size]="16"></app-icon>
                    {{ isEdit() ? 'Guardar cambios' : 'Crear perfil' }}
                </app-button>
            </div>
        </app-modal>
    `,
})
export class InvoiceProfileEditorComponent {
    private readonly store = inject(Store);
    private readonly fb = inject(FormBuilder);

    /** `null` ⇒ crear. Un id ⇒ editar ese perfil. */
    readonly profileId = input<number | null>(null);
    /** Tipo de operación propuesto al crear. */
    readonly initialOperationType = input<string>('09');

    readonly closed = output<void>();

    readonly section = signal<EditorSection>('general');
    readonly server_error = signal<string | null>(null);
    /** Snapshot con que se abrió, para no mandar `config` si no cambió. */
    private readonly loaded_config = signal<string | null>(null);

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
        { value: 'et_462_1', label: 'Art. 462-1 E.T. — grava A + I + U (piso 10 %)' },
        {
            value: 'decreto_1372_1992',
            label: 'Decreto 1372/1992 — grava sólo la Utilidad (sin piso)',
        },
    ];
    readonly bucket_options = [
        { value: 'administracion', label: 'Administración' },
        { value: 'imprevistos', label: 'Imprevistos' },
        { value: 'utilidad', label: 'Utilidad' },
        { value: 'costo', label: 'Costo reembolsable' },
    ];

    private readonly all_tabs: SectionTab[] = [
        { key: 'general', label: 'General', icon: 'file-text' },
        { key: 'aiu', label: 'AIU', icon: 'percent' },
        { key: 'accounting', label: 'Contabilidad', icon: 'book-open' },
        { key: 'taxes', label: 'Impuestos', icon: 'receipt' },
        { key: 'model_lines', label: 'Líneas modelo', icon: 'list' },
        { key: 'format', label: 'Formato', icon: 'layout-template' },
        { key: 'dian', label: 'DIAN', icon: 'shield-check' },
        { key: 'preview', label: 'Previsualización', icon: 'eye' },
        { key: 'history', label: 'Historial', icon: 'history' },
    ];

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
            administracion: ['10.00'],
            imprevistos: ['5.00'],
            utilidad: ['85.00'],
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
            template_key: [''],
            show_aiu_breakdown: [true],
            display_decimals: [2],
        }),
        dian: this.fb.group({
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

    readonly isEdit = computed(() => this.profileId() !== null);
    readonly isAiu = computed(() => this.operationType() === '09');

    readonly visibleTabs = computed(() =>
        this.all_tabs.filter((tab) => {
            if (tab.key === 'aiu') return this.isAiu();
            // La previsualización necesita `:id`: en creación la pestaña no se
            // ofrece en vez de mostrar un botón que siempre falla.
            if (tab.key === 'preview') return this.isEdit();
            // El historial tampoco existe antes de guardar: un perfil sin `:id`
            // no tiene versiones que comparar.
            if (tab.key === 'history') return this.isEdit();
            return true;
        }),
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

    readonly modalTitle = computed(() =>
        this.isEdit() ? 'Editar perfil de facturación' : 'Nuevo perfil de facturación',
    );
    readonly modalSubtitle = computed(() => {
        const profile = this.current();
        if (!this.isEdit()) {
            return 'Define el régimen, los impuestos y el formato con que se timbrará.';
        }
        return profile
            ? 'Versión vigente: v' + profile.current_version
            : 'Cargando…';
    });

    constructor() {
        // Al abrir en modo edición, cargar el detalle. El listado sólo trae la
        // fila; el snapshot de configuración viene con el detalle.
        effect(() => {
            const id = this.profileId();
            if (id !== null) {
                this.store.dispatch(ProfileActions.loadProfile({ id }));
            }
        });

        // Hidratar el formulario cuando llega el detalle. Se compara por id para
        // no re-hidratar (y perder lo que el usuario escribió) cada vez que el
        // store emite por otra razón.
        effect(() => {
            const profile = this.current();
            const config = this.current_config();
            if (!profile || profile.id !== this.profileId() || !config) return;
            if (this.loaded_config() !== null) return;
            this.hydrate(profile, config);
        });

        // En modo creación, sembrar la plantilla por omisión una sola vez.
        effect(() => {
            if (this.isEdit() || this.loaded_config() !== null) return;
            this.hydrateFromConfig(
                buildDefaultAiuProfileConfig(),
                '',
                this.initialOperationType(),
            );
        });
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

    componentsSumOk(): boolean {
        this.form_value();
        return !this.isAiu() || this.componentsSumScaled() === 10000;
    }

    componentsSumLabel(): string {
        this.form_value();
        return formatPercentScaled(this.componentsSumScaled());
    }

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

    // ── Problemas por sección y por campo ───────────────────────────────────
    sectionIssueCount(section: EditorSection): number {
        return this.blockers().filter((issue) => this.sectionOf(issue.field) === section)
            .length;
    }

    private sectionOf(field: string): EditorSection {
        const root = field.split(/[.[]/)[0];
        switch (root) {
            case 'aiu':
                return 'aiu';
            case 'accounting':
                return 'accounting';
            case 'taxes':
                return 'taxes';
            case 'model_lines':
                return 'model_lines';
            case 'format':
                return 'format';
            case 'dian':
                return 'dian';
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
                bucket: ['administracion'],
                description: [''],
                unit_code: ['94'],
                quantity: ['1'],
            }),
        );
    }
    removeModelLine(index: number): void {
        this.modelLines.removeAt(index);
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
                    template_key: config.format.template_key ?? '',
                    show_aiu_breakdown: config.format.show_aiu_breakdown,
                    display_decimals: config.format.display_decimals,
                },
                dian: {
                    payment_means_code: config.dian.payment_means_code ?? '',
                    payment_method_code: config.dian.payment_method_code ?? '',
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
                }),
                { emitEvent: false },
            );
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
        }));

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
                template_key: this.nullIfEmpty(raw['format']?.template_key),
                show_aiu_breakdown: Boolean(raw['format']?.show_aiu_breakdown),
                display_decimals: Number(raw['format']?.display_decimals ?? 2),
            },
            dian: {
                payment_means_code: this.nullIfEmpty(raw['dian']?.payment_means_code),
                payment_method_code: this.nullIfEmpty(raw['dian']?.payment_method_code),
                header_notes: notes.length > 0 ? notes : null,
            },
        };
    }

    // ── Guardar ─────────────────────────────────────────────────────────────
    save(): void {
        this.server_error.set(null);
        this.form.markAllAsTouched();

        if (this.form.get('name')?.invalid) {
            this.section.set('general');
            return;
        }

        const issues = this.blockers();
        if (issues.length > 0) {
            // Saltar a la sección del primer bloqueo: dejar al usuario en una
            // pestaña sin errores mientras el pie dice que hay problemas es
            // cómo se convierte un mensaje correcto en un usuario perdido.
            const first = issues[0];
            if (first) this.section.set(this.sectionOf(first.field));
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
            this.closed.emit();
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
        this.closed.emit();
    }

    requestClose(): void {
        this.store.dispatch(ProfileActions.clearCurrentProfile());
        this.closed.emit();
    }
}
