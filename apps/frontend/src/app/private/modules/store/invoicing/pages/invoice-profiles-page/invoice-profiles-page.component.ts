import { Component, computed, effect, inject, signal } from '@angular/core';
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
import { operationTypeLabel } from '../../interfaces/invoice-profile.interface';
import { InvoiceProfileEditorComponent } from '../invoice-profile-editor/invoice-profile-editor.component';
import * as ProfileActions from '../../state/actions/invoice-profile.actions';
import {
    selectProfiles,
    selectProfilesError,
    selectProfilesFilters,
    selectProfilesLoading,
    selectProfilesMeta,
    selectProfileSaving,
} from '../../state/selectors/invoice-profile.selectors';

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

                    <app-responsive-data-view
                        [data]="rows()"
                        [columns]="columns"
                        [cardConfig]="card_config"
                        [actions]="table_actions"
                        [loading]="loading()"
                        [emptyMessage]="emptyMessage()"
                        emptyIcon="layout-template"
                    ></app-responsive-data-view>
                </div>
            </app-card>

            <!-- Editor de las 7 secciones -->
            @if (editor(); as open) {
                <vendix-invoice-profile-editor
                    [profileId]="open.id"
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
    readonly editor = signal<{ id: number | null } | null>(null);

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
        const { search, state, operation_type } = this.filters();
        const filtered = Boolean(search || state || operation_type);
        return filtered
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
        this.pending_delete.set(row);
    }

    cancelDelete(): void {
        this.pending_delete.set(null);
    }

    confirmDelete(row: InvoiceProfile): void {
        // Se revalida aquí y no sólo en el `[disabled]`: el botón deshabilitado
        // es una cortesía visual, no una garantía.
        if (!this.canConfirmDelete()) return;
        this.store.dispatch(ProfileActions.deleteProfile({ id: row.id }));
        this.pending_delete.set(null);
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
