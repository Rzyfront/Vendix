import { NgTemplateOutlet } from '@angular/common';
import {
    Component,
    ElementRef,
    computed,
    effect,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';

import {
    CardComponent,
    ConfirmationModalComponent,
    StatsComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    ButtonComponent,
    IconComponent,
    TableColumn,
    TableAction,
    ItemListCardConfig,
} from '../../../../../../shared/components/index';

import type { InvoiceProfile } from '../../interfaces/invoice-profile.interface';
import type { InvoiceProfileConfig } from '../../../../../../core/utils/invoice-profile-config.contract';
import { operationTypeLabel } from '../../interfaces/invoice-profile.interface';
import type { InvoiceProfileTemplate } from '../../services/invoice-profile.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { InvoiceProfileEditorComponent } from '../invoice-profile-editor/invoice-profile-editor.component';
import * as ProfileActions from '../../state/actions/invoice-profile.actions';
import {
    selectProfiles,
    selectProfilesError,
    selectProfilesFilters,
    selectProfilesLoading,
    selectProfilesMeta,
    selectProfileSaving,
    selectProfileDeleteBlock,
    selectProfileTemplates,
    selectProfileTemplatesError,
    selectProfileTemplatesLoading,
} from '../../state/selectors/invoice-profile.selectors';

/**
 * Qué plantilla DIAN se recomienda según la industria de la tienda.
 *
 * Las dos entradas mapean el régimen a la actividad que la norma nombra, no a
 * un parecido:
 *
 * · `construction` → 1372/1992, que es literalmente construcción de bien
 *   inmueble. La industria se añadió para esto (migración
 *   `20260823060000_industry_enum_construction`): sin ella una constructora
 *   arrancaba con el régimen equivocado, y en una factura electrónica eso no es
 *   un detalle de UI sino una base gravable mal declarada ante la DIAN.
 * · `service` → 462-1 del Estatuto Tributario, que nombra aseo, vigilancia y
 *   servicios temporales.
 *
 * Los dos AIU calculan la base gravable distinto, así que NO son
 * intercambiables: recomendar el 462-1 a una constructora sería peor que no
 * recomendar nada, porque parece correcto.
 *
 * La recomendación es una SUGERENCIA visual, no un filtro: el selector muestra
 * siempre las tres plantillas. Ocultarlas por industria dejaría a una tienda mal
 * clasificada sin acceso a la que le corresponde, y la industria se edita en
 * otro módulo.
 */
const TEMPLATE_BY_INDUSTRY: Readonly<Record<string, string>> = {
    construction: 'dian-aiu-1372',
    service: 'dian-aiu-462-1',
};

/** Plantilla recomendada cuando ninguna industria de la tienda tiene una propia. */
const FALLBACK_TEMPLATE_KEY = 'dian-standard';

/**
 * Perfiles de facturación — listado.
 *
 * Un perfil es la configuración fiscal con la que se timbra: régimen AIU,
 * matriz de impuestos por componente, cuentas contables y formato. Cada
 * edición crea una VERSIÓN, y cada factura timbrada queda apuntando a la
 * versión con la que se emitió — por eso desde aquí se puede desactivar pero
 * casi nunca borrar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL BORRADO PIDE ESCRIBIR EL NOMBRE
 * ─────────────────────────────────────────────────────────────────────────────
 * Borrar un perfil sin facturas es legítimo y el backend lo permite. Pero un
 * perfil es la única fuente de la configuración con que se emite: borrar el
 * equivocado no rompe nada visible hoy y aparece semanas después como
 * «¿por qué esta factura salió sin AIU?». Un `confirm()` de un clic no protege
 * de eso — se contesta sin leerlo. Escribir el nombre obliga a mirar CUÁL se
 * está borrando, que es justo el error que se quiere evitar.
 */
@Component({
    selector: 'vendix-invoice-profiles-page',
    standalone: true,
    imports: [
        NgTemplateOutlet,
        CardComponent,
        ConfirmationModalComponent,
        StatsComponent,
        ResponsiveDataViewComponent,
        InputsearchComponent,
        ButtonComponent,
        IconComponent,
        InvoiceProfileEditorComponent,
    ],
    template: `
        <div class="w-full">
            <!-- Stats: sticky en móvil, estáticas en escritorio -->
            <div
                class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
            >
                <app-stats
                    title="Perfiles"
                    [value]="stats().total"
                    smallText="Configuraciones de facturación"
                    iconName="layout-template"
                    iconBgColor="bg-blue-100"
                    iconColor="text-blue-600"
                    [clickable]="false"
                ></app-stats>
                <app-stats
                    title="Activos"
                    [value]="stats().active"
                    smallText="Disponibles al facturar"
                    iconName="check-circle"
                    iconBgColor="bg-emerald-100"
                    iconColor="text-emerald-600"
                    [clickable]="false"
                ></app-stats>
                <app-stats
                    title="AIU"
                    [value]="stats().aiu"
                    smallText="Administración, imprevistos y utilidad"
                    iconName="percent"
                    iconBgColor="bg-amber-100"
                    iconColor="text-amber-600"
                    [clickable]="false"
                ></app-stats>
                <app-stats
                    title="Predeterminados"
                    [value]="stats().defaults"
                    smallText="Uno por tipo de operación"
                    iconName="star"
                    iconBgColor="bg-violet-100"
                    iconColor="text-violet-600"
                    [clickable]="false"
                ></app-stats>
            </div>

            <app-card [responsive]="true" [padding]="false">
                <div
                    class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                           md:mt-0 md:static md:bg-transparent md:px-4 md:py-4 md:border-b md:border-border"
                >
                    <div
                        class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
                    >
                        <h2
                            class="text-[13px] font-bold text-gray-600 tracking-wide
                                   md:text-lg md:font-semibold md:text-text-primary"
                        >
                            Perfiles de facturación ({{ total() }})
                        </h2>
                        <div class="flex items-center gap-2 w-full md:w-auto">
                            <app-inputsearch
                                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                                placeholder="Buscar por nombre..."
                                [debounceTime]="300"
                                (searchChange)="onSearch($event)"
                            ></app-inputsearch>
                            @if (!show_onboarding()) {
                                <!--
                                  Segunda puerta a las plantillas DIAN. El estado
                                  vacío ya ofrece la suya, y con perfiles ese bloque
                                  no se pinta: sin este botón el catálogo quedaba
                                  inalcanzable en cuanto la tienda creaba su primer
                                  perfil. Se esconde durante el onboarding para no
                                  ofrecer la misma acción dos veces en pantalla.
                                -->
                                <app-button
                                    variant="outline"
                                    [disabled]="saving()"
                                    (clicked)="toggleTemplatePicker()"
                                    data-testid="header-templates"
                                >
                                    <app-icon
                                        slot="icon"
                                        name="layout-template"
                                        [size]="16"
                                    ></app-icon>
                                    Usar plantilla DIAN
                                </app-button>
                            }
                            <app-button
                                variant="primary"
                                [disabled]="saving()"
                                (clicked)="createProfile()"
                            >
                                <app-icon slot="icon" name="plus" [size]="16"></app-icon>
                                Nuevo perfil
                            </app-button>
                        </div>
                    </div>

                    @if (template_picker() && !show_onboarding()) {
                        <div class="mt-3">
                            <ng-container
                                [ngTemplateOutlet]="templatePickerTpl"
                            ></ng-container>
                        </div>
                    }

                    <!-- Filtros. Chips y no un <select>: en móvil un select
                         nativo tapa la tabla entera, y aquí sólo hay 2×N
                         valores. -->
                    <div class="mt-2 flex flex-wrap items-center gap-1.5 md:mt-3">
                        @for (chip of state_chips; track chip.value) {
                            <button
                                type="button"
                                class="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors md:text-xs"
                                [class.bg-primary]="filters().state === chip.value"
                                [class.text-white]="filters().state === chip.value"
                                [class.border-primary]="filters().state === chip.value"
                                [class.border-border]="filters().state !== chip.value"
                                [class.text-text-secondary]="filters().state !== chip.value"
                                (click)="onStateFilter(chip.value)"
                            >
                                {{ chip.label }}
                            </button>
                        }
                        <span class="mx-1 h-4 w-px bg-border"></span>
                        @for (chip of operation_chips; track chip.value) {
                            <button
                                type="button"
                                class="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors md:text-xs"
                                [class.bg-primary]="filters().operation_type === chip.value"
                                [class.text-white]="filters().operation_type === chip.value"
                                [class.border-primary]="filters().operation_type === chip.value"
                                [class.border-border]="filters().operation_type !== chip.value"
                                [class.text-text-secondary]="
                                    filters().operation_type !== chip.value
                                "
                                (click)="onOperationFilter(chip.value)"
                            >
                                {{ chip.label }}
                            </button>
                        }
                    </div>
                </div>

                <div class="relative p-2 md:p-4">
                    <!-- El error se pinta ARRIBA de la tabla y no sustituye a
                         los datos: dejar la lista anterior visible con el aviso
                         es más honesto que un «no hay perfiles», que sería una
                         afirmación falsa sobre la tienda. -->
                    @if (error(); as message) {
                        <div
                            class="mb-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger md:text-sm"
                            role="alert"
                        >
                            {{ message }}
                        </div>
                    }

                    @if (delete_block(); as block) {
                        <div
                            class="mb-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning md:text-sm"
                            role="alert"
                        >
                            <p class="font-semibold">
                                Este perfil no se puede eliminar.
                            </p>
                            @if (block.invoiceCount > 0) {
                                <p>
                                    Lo referencian {{ block.invoiceCount }} factura(s) ya
                                    timbradas. Es la única fuente que explica cómo se
                                    calcularon: si ya no debe usarse, desactívalo — seguirá
                                    fuera del selector del wizard y las facturas emitidas
                                    conservarán su configuración.
                                </p>
                            }
                            @if (block.foreignCloneCount > 0) {
                                <p>
                                    Es el origen de {{ block.foreignCloneCount }} perfil(es)
                                    de otra tienda, que no se alcanza desde acá. Escribe a
                                    soporte para resolverlo.
                                </p>
                            }
                        </div>
                    }

                    <!--
                      Onboarding en vez de la tabla SÓLO cuando no hay ningún
                      perfil y no hay filtros: con filtros activos, el vacío que
                      corresponde es el del RDV, que ofrece quitarlos.
                    -->
                    @if (show_onboarding()) {
                        <div
                            class="flex flex-col items-center gap-4 px-4 py-10 text-center"
                            data-testid="profiles-onboarding"
                        >
                            <div
                                class="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                                aria-hidden="true"
                            >
                                <app-icon name="layout-template" [size]="32"></app-icon>
                            </div>

                            <div class="max-w-xl space-y-1">
                                <h3 class="text-lg font-semibold text-[var(--text-primary)]">
                                    Aún no hay perfiles de facturación
                                </h3>
                                <p class="text-sm text-[var(--text-secondary)]">
                                    Un perfil define el régimen, los impuestos y el
                                    formato con que se timbra una factura. Puedes
                                    partir de una plantilla de la DIAN y ajustarla, o
                                    configurarlo desde cero.
                                </p>
                            </div>

                            <div class="flex flex-wrap items-center justify-center gap-2">
                                <app-button
                                    variant="primary"
                                    icon="plus"
                                    (clicked)="createProfile()"
                                    data-testid="onboarding-create"
                                >
                                    Crear primer perfil
                                </app-button>
                                <app-button
                                    variant="outline"
                                    icon="layout-template"
                                    (clicked)="toggleTemplatePicker()"
                                    data-testid="onboarding-templates"
                                >
                                    Usar plantilla DIAN
                                </app-button>
                            </div>

                            @if (template_picker()) {
                                <ng-container
                                    [ngTemplateOutlet]="templatePickerTpl"
                                ></ng-container>
                            }
                        </div>
                    } @else {
                        <app-responsive-data-view
                            [data]="rows()"
                            [columns]="columns"
                            [cardConfig]="card_config"
                            [actions]="table_actions"
                            rowLabelKey="name"
                            [loading]="loading()"
                            [emptyMessage]="emptyMessage()"
                            emptyIcon="layout-template"
                        ></app-responsive-data-view>
                    }
                </div>
            </app-card>

            <!-- Editor de las 7 secciones -->
            @if (editor(); as open) {
                <vendix-invoice-profile-editor
                    [profileId]="open.id"
                    [initialConfig]="open.config ?? null"
                    [initialOperationType]="open.operationType ?? '09'"
                    (closed)="closeEditor()"
                ></vendix-invoice-profile-editor>
            }

            <!-- Confirmación de activar / desactivar -->
            @if (pending_toggle(); as row) {
                <app-confirmation-modal
                    [isOpen]="true"
                    [title]="
                        row.state === 'active' ? 'Desactivar perfil' : 'Activar perfil'
                    "
                    [message]="toggleMessage(row)"
                    [confirmText]="row.state === 'active' ? 'Desactivar' : 'Activar'"
                    cancelText="Cancelar"
                    [confirmVariant]="row.state === 'active' ? 'danger' : 'primary'"
                    (confirm)="confirmToggle(row)"
                    (cancel)="pending_toggle.set(null)"
                ></app-confirmation-modal>
            }

            <!-- Confirmación de predeterminado -->
            @if (pending_default(); as row) {
                <app-confirmation-modal
                    [isOpen]="true"
                    title="Marcar como predeterminado"
                    [message]="defaultMessage(row)"
                    confirmText="Marcar"
                    cancelText="Cancelar"
                    confirmVariant="primary"
                    (confirm)="confirmDefault(row)"
                    (cancel)="pending_default.set(null)"
                ></app-confirmation-modal>
            }

            <!-- Borrado con confirmación DURA: hay que escribir el nombre -->
            @if (pending_delete(); as row) {
                <div
                    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="delete-profile-title"
                    (document:keydown.escape)="cancelDelete()"
                >
                    <div
                        class="w-full max-w-md rounded-xl bg-surface p-4 shadow-xl md:p-6"
                    >
                        <h3
                            id="delete-profile-title"
                            class="text-base font-semibold text-text-primary md:text-lg"
                        >
                            Eliminar perfil de facturación
                        </h3>
                        <p class="mt-2 text-xs text-text-secondary md:text-sm">
                            Vas a eliminar
                            <strong class="text-text-primary">{{ row.name }}</strong>
                            y su historial de
                            {{ row.current_version }}
                            {{ row.current_version === 1 ? 'versión' : 'versiones' }}.
                            Esta acción no se puede deshacer.
                        </p>
                        <p class="mt-2 text-xs text-text-secondary md:text-sm">
                            Si alguna factura timbrada usa este perfil, el sistema no
                            permitirá borrarlo — desactívalo en su lugar.
                        </p>
                        <label
                            class="mt-3 block text-xs font-medium text-text-primary md:text-sm"
                            [attr.for]="'confirm-delete-name'"
                        >
                            Escribe <strong>{{ row.name }}</strong> para confirmar
                        </label>
                        <input
                            #deleteConfirmInput
                            id="confirm-delete-name"
                            type="text"
                            class="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary
                                   focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            autocomplete="off"
                            [value]="delete_confirmation()"
                            (input)="onDeleteConfirmationInput($event)"
                        />
                        <div class="mt-4 flex justify-end gap-2">
                            <app-button variant="secondary" (clicked)="cancelDelete()">
                                Cancelar
                            </app-button>
                            <app-button
                                variant="danger"
                                [disabled]="!canConfirmDelete() || saving()"
                                (clicked)="confirmDelete(row)"
                            >
                                Eliminar
                            </app-button>
                        </div>
                    </div>
                </div>
            }
        </div>

            <!--
              OJO: ni un solo acento grave dentro de esta plantilla. La plantilla
              ES un literal delimitado por acentos graves y uno solo la cierra.

              Selector de plantillas DIAN, extraído a ng-template porque lo
              consumen DOS sitios: el estado vacío (el original) y el encabezado
              del listado. Antes vivía sólo en el estado vacío, y como ese bloque
              se apaga en cuanto existe un perfil, las tres plantillas quedaban
              inalcanzables para siempre: quien quisiera un segundo perfil AIU
              tenía que rearmar el régimen AIU a mano, que es justo el campo
              donde equivocarse cambia la base gravable. Un solo ng-template en
              vez de duplicar el markup, para que la lista, la recomendada y el
              manejo del fallo no puedan divergir entre las dos superficies.
            -->
            <ng-template #templatePickerTpl>
                <div class="w-full max-w-3xl pt-2">
                    @if (templates_loading()) {
                        <p class="text-sm text-[var(--text-secondary)]">
                            Cargando plantillas…
                        </p>
                    } @else if (templates_error(); as message) {
                        <!--
                          El fallo del catálogo se pinta acá y NO
                          bloquea: «Crear primer perfil» sigue
                          arriba y no depende de las plantillas.
                        -->
                        <p
                            class="text-sm text-[var(--color-danger)]"
                            role="alert"
                        >
                            {{ message }}
                        </p>
                    } @else {
                        <div
                            class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                        >
                            @for (
                                template of templates();
                                track template.key
                            ) {
                                <button
                                    type="button"
                                    class="flex h-full flex-col gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 text-left transition-colors hover:border-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                                    (click)="useTemplate(template)"
                                    [attr.data-testid]="
                                        'template-' + template.key
                                    "
                                >
                                    <div
                                        class="flex items-center justify-between gap-2"
                                    >
                                        <span
                                            class="text-sm font-semibold text-[var(--text-primary)]"
                                        >
                                            {{ template.label }}
                                        </span>
                                        @if (
                                            template.key ===
                                            suggested_template_key()
                                        ) {
                                            <span
                                                class="shrink-0 rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary)]"
                                            >
                                                Recomendada
                                            </span>
                                        }
                                    </div>
                                    <span
                                        class="text-xs text-[var(--text-secondary)]"
                                    >
                                        {{ template.description }}
                                    </span>
                                    <span
                                        class="mt-auto pt-2 text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]"
                                    >
                                        {{
                                            operationLabel(
                                                template.operation_type
                                            )
                                        }}
                                    </span>
                                </button>
                            }
                        </div>
                    }
                </div>
            </ng-template>
    `,
})
export class InvoiceProfilesPageComponent {
    private readonly store = inject(Store);

    // ── Estado del store. `initialValue` obligatorio: sin él `toSignal`
    //    devuelve `undefined` en el primer render y la plantilla revienta.
    readonly profiles = toSignal(this.store.select(selectProfiles), {
        initialValue: [] as InvoiceProfile[],
    });
    readonly loading = toSignal(this.store.select(selectProfilesLoading), {
        initialValue: false,
    });
    readonly saving = toSignal(this.store.select(selectProfileSaving), {
        initialValue: false,
    });
    readonly error = toSignal(this.store.select(selectProfilesError), {
        initialValue: null as string | null,
    });
    readonly meta = toSignal(this.store.select(selectProfilesMeta), {
        initialValue: null,
    });
    /**
     * Borrado bloqueado por referencias, con el conteo.
     *
     * Se pinta como refuerzo del requerimiento 12: no hay «forzar». Un perfil
     * referenciado por facturas timbradas es la única fuente que reproduce cómo
     * se calcularon esas facturas; borrarlo deja documentos emitidos sin forma
     * de explicar su propio desglose ante una revisión fiscal.
     */
    readonly delete_block = toSignal(this.store.select(selectProfileDeleteBlock), {
        initialValue: null,
    });

    readonly filters = toSignal(this.store.select(selectProfilesFilters), {
        initialValue: {
            search: '',
            state: '' as '' | 'active' | 'inactive',
            operation_type: '',
            page: 1,
            limit: 20,
        },
    });

    // ── Estado local de UI
    readonly pending_delete = signal<InvoiceProfile | null>(null);
    readonly pending_toggle = signal<InvoiceProfile | null>(null);
    readonly pending_default = signal<InvoiceProfile | null>(null);
    readonly delete_confirmation = signal('');

    readonly state_chips = [
        { value: '' as const, label: 'Todos' },
        { value: 'active' as const, label: 'Activos' },
        { value: 'inactive' as const, label: 'Inactivos' },
    ];

    /**
     * Chips de tipo de operación.
     *
     * Sólo los dos que Vendix emite hoy (estándar y AIU) más «Todos». Los otros
     * tres del catálogo DIAN —mandatos, transporte, cambiario— no se ofrecen
     * como filtro porque no se pueden crear todavía; un chip que siempre
     * devuelve cero enseña que los filtros no sirven.
     */
    readonly operation_chips = [
        { value: '', label: 'Toda operación' },
        { value: '10', label: 'Estándar' },
        { value: '09', label: 'AIU' },
    ];

    /** `true` cuando el texto escrito coincide EXACTAMENTE con el nombre. */
    readonly canConfirmDelete = computed(() => {
        const row = this.pending_delete();
        if (!row) return false;
        return this.delete_confirmation().trim() === row.name.trim();
    });

    /**
     * Filas de la tabla: el perfil más `default_label`.
     *
     * El requerimiento 3 pide una columna «Predeterminado» propia, y `app-table`
     * sólo invoca `transform` cuando `row[key]` trae algo — `is_default: false`
     * cuenta como vacío, así que una columna clavada a ese booleano quedaría en
     * blanco precisamente en las filas NO predeterminadas, que son la mayoría.
     * Derivar acá un texto que SIEMPRE tiene valor (`'—'` incluido) es lo que
     * hace que la celda se pinte en las dos ramas. El campo es de presentación:
     * no viaja al backend ni se guarda.
     */
    /**
     * Editor abierto. `{ id: null }` es crear y `{ id: n }` es editar — no se usa
     * `number | null` a secas porque `null` ya significa «cerrado», y las dos
     * cosas colisionarían en el mismo valor.
     */
    readonly editor = signal<{
        id: number | null;
        /** Configuración con la que abrir en modo creación (una plantilla DIAN). */
        config?: InvoiceProfileConfig | null;
        operationType?: string;
    } | null>(null);

    private readonly auth = inject(AuthFacade);

    readonly templates = toSignal(this.store.select(selectProfileTemplates), {
        initialValue: [] as InvoiceProfileTemplate[],
    });
    readonly templates_loading = toSignal(
        this.store.select(selectProfileTemplatesLoading),
        { initialValue: false },
    );
    readonly templates_error = toSignal(
        this.store.select(selectProfileTemplatesError),
        { initialValue: null as string | null },
    );

    /** El selector de plantillas está desplegado. */
    readonly template_picker = signal(false);

    /**
     * Hay filtros o búsqueda activos.
     *
     * Un solo sitio para el predicado. `emptyMessage` y `show_onboarding` lo
     * leen los dos, y si cada uno lo recalculara bastaría añadir un filtro nuevo
     * a uno para que la pantalla ofreciera «Crea tu primer perfil» a alguien que
     * tiene doce y escribió mal la búsqueda.
     */
    readonly is_filtered = computed(() => {
        const { search, state, operation_type } = this.filters();
        return Boolean(search || state || operation_type);
    });

    /**
     * Mostrar el onboarding en vez de la tabla.
     *
     * Las tres condiciones son necesarias. Sin `!loading()` el onboarding
     * parpadea en cada carga antes de que lleguen las filas; sin `!is_filtered()`
     * sale cuando un filtro no arroja nada, que es el caso en el que el usuario
     * necesita quitar el filtro y no crear un perfil.
     */
    readonly show_onboarding = computed(
        () => !this.loading() && this.rows().length === 0 && !this.is_filtered(),
    );

    /**
     * Plantilla recomendada para esta tienda, o `null` si el catálogo aún no
     * llegó o si la recomendada no está en él.
     *
     * Se comprueba contra el catálogo VIVO y no se asume: una plantilla retirada
     * por un deploy dejaría la insignia «Recomendado» sobre una tarjeta que no
     * existe, o peor, sobre ninguna, con el usuario buscándola.
     */
    readonly suggested_template_key = computed<string | null>(() => {
        const catalog = this.templates();
        if (catalog.length === 0) return null;
        // Se recorre el MAPA, no el arreglo de industrias: una tienda puede ser
        // `construction` y `service` a la vez, y recorrer sus industrias haría
        // que ganara la que el backend devolvió primero — orden que nadie
        // declaró y que puede cambiar sin aviso. Recorriendo el mapa, la
        // precedencia es la del orden de declaración y es explícita: construcción
        // antes que servicios, porque el 1372 es el régimen más específico de los
        // dos y quien hace obra además de servicios factura la obra.
        const industries = new Set(this.auth.storeIndustries());
        const match = Object.keys(TEMPLATE_BY_INDUSTRY).find((industry) =>
            industries.has(industry),
        );
        const key = match
            ? TEMPLATE_BY_INDUSTRY[match]
            : FALLBACK_TEMPLATE_KEY;
        return catalog.some((template) => template.key === key) ? key : null;
    });

    readonly rows = computed(() =>
        this.profiles().map((profile) => ({
            ...profile,
            default_label: profile.is_default ? 'Predeterminado' : '—',
            // La tarjeta móvil pinta `subtitleKey` en crudo, sin `transform`:
            // sin esto el subtítulo diría «09» en vez de «AIU».
            operation_label: operationTypeLabel(profile.operation_type),
        })),
    );

    readonly total = computed(() => this.meta()?.total ?? this.profiles().length);

    readonly stats = computed(() => {
        const list = this.profiles();
        return {
            // `total` sale de `meta` cuando existe: con paginación, contar la
            // página actual mentiría en cuanto haya más de una.
            total: this.meta()?.total ?? list.length,
            active: list.filter((row) => row.state === 'active').length,
            aiu: list.filter((row) => row.operation_type === '09').length,
            defaults: list.filter((row) => row.is_default).length,
        };
    });

    /**
     * El vacío distingue «no hay nada» de «el filtro no encontró nada».
     *
     * Son situaciones distintas con salidas distintas: la primera pide crear un
     * perfil, la segunda pide quitar el filtro. Un solo texto para las dos deja
     * al usuario creyendo que la tienda no tiene perfiles.
     */
    readonly emptyMessage = computed(() => {
        return this.is_filtered()
            ? 'Ningún perfil coincide con la búsqueda o los filtros aplicados'
            : 'Aún no hay perfiles de facturación. Crea uno para definir el régimen, los impuestos y el formato con que se timbra.';
    });

    columns: TableColumn[] = [
        {
            key: 'name',
            label: 'Perfil',
            sortable: true,
            priority: 1,
            transform: (_value: unknown, item?: InvoiceProfile) =>
                item ? item.name : '',
        },
        {
            // `operation_type` viene siempre poblado (es `NOT NULL` y de dos
            // dígitos), así que la celda nunca se silencia por el gating de
            // `transform`.
            key: 'operation_type',
            label: 'Operación',
            priority: 1,
            transform: (_value: unknown, item?: InvoiceProfile) =>
                item ? operationTypeLabel(item.operation_type) : '',
        },
        {
            // Misma razón: `current_version` es ≥ 1 siempre, así que la celda
            // nunca se silencia.
            key: 'current_version',
            label: 'Versión',
            align: 'center',
            priority: 2,
            transform: (_value: unknown, item?: InvoiceProfile) =>
                item ? `v${item.current_version}` : '',
        },
        {
            key: 'default_label',
            label: 'Predeterminado',
            align: 'center',
            priority: 2,
            transform: (_value: unknown, item?: InvoiceProfile) =>
                item?.is_default ? 'Sí' : '—',
        },
        {
            key: 'updated_at',
            label: 'Última edición',
            priority: 3,
            transform: (_value: unknown, item?: InvoiceProfile) =>
                item ? this.formatDateTime(item.updated_at) : '',
        },
        {
            key: 'state',
            label: 'Estado',
            align: 'center',
            priority: 1,
            badgeConfig: {
                type: 'status',
                colorMap: {
                    active: 'success',
                    inactive: 'neutral',
                },
            },
            transform: (_value: unknown, item?: InvoiceProfile) =>
                item?.state === 'active' ? 'Activo' : 'Inactivo',
            cellClass: (_value: unknown, item?: InvoiceProfile) => item?.state ?? '',
        },
    ];

    table_actions: TableAction[] = [
        {
            label: 'Editar',
            icon: 'edit',
            variant: 'primary',
            action: (row: InvoiceProfile) => this.editProfile(row),
        },
        {
            label: 'Duplicar',
            icon: 'copy',
            variant: 'secondary',
            action: (row: InvoiceProfile) => this.cloneProfile(row),
        },
        {
            label: (row: InvoiceProfile) =>
                row.state === 'active' ? 'Desactivar' : 'Activar',
            icon: (row: InvoiceProfile) =>
                row.state === 'active' ? 'toggle-left' : 'toggle-right',
            variant: (row: InvoiceProfile) =>
                row.state === 'active' ? 'warning' : 'success',
            action: (row: InvoiceProfile) => this.pending_toggle.set(row),
        },
        {
            label: 'Predeterminado',
            icon: 'star',
            variant: 'secondary',
            // Oculta donde no aplica en vez de mostrarse y fallar: un perfil ya
            // predeterminado no tiene nada que marcar, y uno inactivo sería un
            // 409 `INVOICING_PROFILE_007` garantizado.
            show: (row: InvoiceProfile) =>
                !row.is_default && row.state === 'active',
            action: (row: InvoiceProfile) => this.pending_default.set(row),
        },
        {
            label: 'Eliminar',
            icon: 'trash-2',
            variant: 'danger',
            action: (row: InvoiceProfile) => this.askDelete(row),
        },
    ];

    card_config: ItemListCardConfig = {
        titleKey: 'name',
        subtitleKey: 'operation_label',
        badgeKey: 'state',
    };

    // El input de confirmación del borrado duro. Se referencia para poder
    // MOVER EL FOCO dentro del diálogo al abrirlo: el contenedor declara
    // `aria-modal="true"`, y un lector de pantalla cuyo foco sigue en el botón
    // de la tabla — fuera del contenedor — queda leyendo una tabla que el
    // usuario ya no puede operar.
    private readonly delete_confirm_input =
        viewChild<ElementRef<HTMLInputElement>>('deleteConfirmInput');

    // El elemento que abrió el diálogo, para devolverle el foco al cerrarlo.
    // Sin esto, cerrar con Escape deja el foco en `<body>` y la siguiente
    // tabulación reinicia el recorrido desde el principio de la página.
    private delete_trigger: HTMLElement | null = null;

    constructor() {
        // Carga inicial. En el constructor y no en `ngOnInit`: el componente es
        // standalone y lazy, así que se instancia cuando la ruta se activa.
        this.store.dispatch(ProfileActions.loadProfiles({}));

        // El texto de confirmación se limpia al cerrar el modal, no al abrirlo:
        // si se limpiara al abrir, un `pending_delete` que cambia de fila
        // dejaría escrito el nombre del anterior y el botón quedaría habilitado
        // para borrar el equivocado.
        effect(() => {
            if (!this.pending_delete()) {
                this.delete_confirmation.set('');
            }
        });

        // Foco dentro del diálogo en cuanto el input existe. Se lee la señal de
        // `viewChild` (no `pending_delete`) porque el input aparece un ciclo de
        // detección DESPUÉS de que la señal cambia: enfocar al ver el cambio de
        // `pending_delete` apuntaría a un elemento que aún no está en el DOM.
        effect(() => {
            const input = this.delete_confirm_input();
            if (input) input.nativeElement.focus();
        });
    }

    onSearch(term: string): void {
        this.store.dispatch(ProfileActions.setProfilesSearch({ search: term }));
    }

    onStateFilter(value: '' | 'active' | 'inactive'): void {
        this.store.dispatch(ProfileActions.setProfilesStateFilter({ state: value }));
    }

    onOperationFilter(value: string): void {
        this.store.dispatch(
            ProfileActions.setProfilesOperationFilter({ operation_type: value }),
        );
    }

    onDeleteConfirmationInput(event: Event): void {
        this.delete_confirmation.set((event.target as HTMLInputElement).value);
    }

    createProfile(): void {
        // Se limpia el perfil actual ANTES de abrir: si quedara el del último
        // editado, el editor lo hidrataría y el «nuevo» perfil nacería con la
        // configuración de otro.
        this.store.dispatch(ProfileActions.clearCurrentProfile());
        this.editor.set({ id: null });
    }

    editProfile(row: InvoiceProfile): void {
        this.editor.set({ id: row.id });
    }

    /**
     * Despliega el selector de plantillas y pide el catálogo si nunca se pidió.
     *
     * La carga es perezosa a propósito: el catálogo sólo lo necesita este
     * bloque, y una tienda con perfiles nunca lo ve. Pedirlo al montar la página
     * sería una petición en cada visita al listado para nada.
     *
     * Se dispara siempre que se abre y el efecto es `exhaustMap`, así que un
     * doble clic no produce dos peticiones. No se comprueba `loaded` acá porque
     * eso duplicaría en la vista una decisión que ya vive en el efecto.
     */
    toggleTemplatePicker(): void {
        const open = !this.template_picker();
        this.template_picker.set(open);
        if (open) {
            this.store.dispatch(ProfileActions.loadProfileTemplates());
        }
    }

    /**
     * Abre el editor sembrado con la plantilla, en modo creación.
     *
     * No crea el perfil: lo siembra. Así el usuario le pone el nombre —lo único
     * que la plantilla no puede aportar— y el guardado recorre la misma
     * validación que cualquier otro perfil. Un create de un clic usaría la
     * etiqueta de la plantilla como nombre y la segunda vez que alguien usara la
     * misma chocaría con `INVOICING_PROFILE_004`.
     *
     * `clearCurrentProfile` por la misma razón que en `createProfile`: si
     * quedara el último perfil editado en el store, el editor lo hidrataría y la
     * plantilla no se vería.
     */
    useTemplate(template: InvoiceProfileTemplate): void {
        this.store.dispatch(ProfileActions.clearCurrentProfile());
        // Cerrar el selector: ya cumplió. Sin esto, al salir del editor el
        // usuario vuelve a una rejilla de plantillas abierta encima del
        // listado, invitándolo a sembrar un segundo perfil que no pidió.
        this.template_picker.set(false);
        this.editor.set({
            id: null,
            config: template.config,
            operationType: template.operation_type,
        });
    }

    /** Etiqueta legible del tipo de operación de una plantilla. */
    operationLabel(operationType: string): string {
        return operationTypeLabel(operationType);
    }

    closeEditor(): void {
        this.editor.set(null);
    }

    cloneProfile(row: InvoiceProfile): void {
        // Nombre propuesto con sufijo: el backend rechaza el duplicado exacto
        // con `INVOICING_PROFILE_004`, así que proponer el mismo nombre sería
        // ofrecer una acción que falla siempre.
        this.store.dispatch(
            ProfileActions.cloneProfile({
                id: row.id,
                payload: { name: this.proposeCloneName(row.name) },
            }),
        );
    }

    askDelete(row: InvoiceProfile): void {
        this.delete_confirmation.set('');
        const active = document.activeElement;
        this.delete_trigger = active instanceof HTMLElement ? active : null;
        this.pending_delete.set(row);
    }

    cancelDelete(): void {
        this.pending_delete.set(null);
        this.restoreDeleteFocus();
    }

    /**
     * Devuelve el foco al botón que abrió el diálogo. Se comprueba que el
     * elemento siga en el documento: la fila puede haber desaparecido de la
     * tabla (es justo lo que pasa cuando el borrado tuvo éxito), y enfocar un
     * nodo desconectado es un no-op silencioso que deja el foco en `<body>`.
     */
    private restoreDeleteFocus(): void {
        const trigger = this.delete_trigger;
        this.delete_trigger = null;
        if (trigger && trigger.isConnected) trigger.focus();
    }

    confirmDelete(row: InvoiceProfile): void {
        // Se revalida aquí y no sólo en el `[disabled]`: el botón deshabilitado
        // es una cortesía visual, no una garantía.
        if (!this.canConfirmDelete()) return;
        this.store.dispatch(ProfileActions.deleteProfile({ id: row.id }));
        this.pending_delete.set(null);
        this.restoreDeleteFocus();
    }

    confirmToggle(row: InvoiceProfile): void {
        this.store.dispatch(
            row.state === 'active'
                ? ProfileActions.deactivateProfile({ id: row.id })
                : ProfileActions.activateProfile({ id: row.id }),
        );
        this.pending_toggle.set(null);
    }

    confirmDefault(row: InvoiceProfile): void {
        this.store.dispatch(ProfileActions.setProfileDefault({ id: row.id }));
        this.pending_default.set(null);
    }

    toggleMessage(row: InvoiceProfile): string {
        if (row.state === 'active') {
            const extra = row.is_default
                ? ' Además es el predeterminado de su tipo de operación, así que las facturas que no elijan perfil se quedarán sin uno.'
                : '';
            return `«${row.name}» dejará de ofrecerse al facturar. Las facturas ya timbradas con él no cambian: siguen apuntando a la versión con la que se emitieron.${extra}`;
        }
        return `«${row.name}» volverá a estar disponible al facturar, con su configuración actual (v${row.current_version}).`;
    }

    defaultMessage(row: InvoiceProfile): string {
        return `«${row.name}» pasará a ser el perfil con el que se timbran las facturas de tipo ${operationTypeLabel(row.operation_type)} cuando no se elija otro. El que lo era hasta ahora deja de serlo.`;
    }

    /** `Perfil` → `Perfil (copia)`, `Perfil (copia)` → `Perfil (copia 2)`. */
    private proposeCloneName(name: string): string {
        const match = /^(.*) \(copia(?: (\d+))?\)$/.exec(name);
        if (!match) return `${name} (copia)`;
        const next = match[2] ? Number(match[2]) + 1 : 2;
        return `${match[1]} (copia ${next})`;
    }

    /**
     * Fecha y hora locales a partir del ISO del backend.
     *
     * `updated_at` llega como string ISO con `Z`. Se construye el `Date` desde
     * ese string completo —nunca partiéndolo por la `T`—, porque una
     * fecha-sola interpretada en local retrocede un día en zonas al oeste de
     * UTC, que es exactamente el defecto de off-by-one que este repo ya
     * documenta.
     */
    private formatDateTime(iso: string): string {
        if (!iso) return '-';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString('es-CO', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }
}
