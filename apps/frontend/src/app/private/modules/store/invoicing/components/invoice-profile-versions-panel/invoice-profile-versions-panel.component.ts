import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';

import { IconComponent } from '../../../../../../shared/components/index';
import type { InvoiceProfileConfig } from '../../../../../../core/utils/invoice-profile-config.contract';
import type { InvoiceProfileVersionSummary } from '../../interfaces/invoice-profile.interface';
import {
    describeConfigPath,
    diffProfileConfig,
    formatConfigValue,
} from '../../utils/profile-config-diff.util';
import type { ConfigDiffEntry } from '../../utils/profile-config-diff.util';
import * as ProfileActions from '../../state/actions/invoice-profile.actions';
import {
    selectCurrentProfileConfig,
    selectCurrentProfileVersions,
    selectProfileVersionSnapshot,
    selectProfileVersionSnapshotLoading,
    selectProfileVersionsLoading,
} from '../../state/selectors/invoice-profile.selectors';

/**
 * Historial de versiones con diff (E.7).
 *
 * ## Qué se compara contra qué
 *
 * El diff enfrenta la versión seleccionada (izquierda, más antigua) con la
 * **vigente** (derecha). No contra la versión inmediatamente anterior: la
 * pregunta que trae a alguien a esta pantalla es «¿en qué se diferencia lo que
 * se usó para esa factura de lo que se usa hoy?», y responderla con saltos de
 * uno en uno obliga a sumar diffs mentalmente.
 *
 * ## Por qué se pide el snapshot al pinchar y no al listar
 *
 * El listado trae sólo el resumen. Cada snapshot es un `jsonb` de varios KB;
 * traer los diez para pintar diez fechas sería descargar el historial completo
 * para mostrar cuatro columnas.
 */
@Component({
    selector: 'vendix-invoice-profile-versions-panel',
    standalone: true,
    imports: [IconComponent],
    template: `
        <div class="flex flex-col gap-3 md:flex-row">
            <!-- Lista de versiones -->
            <div class="flex flex-col gap-1 md:w-64">
                @if (loading()) {
                    <p class="text-xs text-text-secondary">Cargando historial…</p>
                }
                @if (!loading() && versions().length === 0) {
                    <p class="text-xs text-text-secondary">
                        Este perfil tiene una sola versión: la vigente. El historial se
                        llena cuando se guarda un cambio de configuración.
                    </p>
                }
                @for (version of versions(); track version.id) {
                    <button
                        type="button"
                        class="rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors md:text-sm"
                        [class.border-primary]="selected() === version.version"
                        [class.bg-primary]="selected() === version.version"
                        [class.text-white]="selected() === version.version"
                        [class.border-border]="selected() !== version.version"
                        [attr.aria-pressed]="selected() === version.version"
                        (click)="select(version)"
                    >
                        <span class="font-semibold">v{{ version.version }}</span>
                        @if (version.version === currentVersion()) {
                            <span class="ml-1 text-[10px] uppercase">vigente</span>
                        }
                        <span class="block text-[11px] opacity-80">
                            {{ formatDate(version.created_at) }}
                        </span>
                        <span class="block text-[11px] opacity-80">
                            {{ authorOf(version) }}
                        </span>
                    </button>
                }
            </div>

            <!-- Diff -->
            <div class="flex-1">
                @if (selected() === null) {
                    <p class="text-xs text-text-secondary md:text-sm">
                        Elige una versión para ver qué cambió respecto de la vigente.
                    </p>
                } @else if (snapshotLoading()) {
                    <p class="text-xs text-text-secondary">Cargando la versión…</p>
                } @else if (snapshot() === null) {
                    <p class="text-xs text-danger md:text-sm" role="alert">
                        No se pudo cargar esa versión. El historial es lo que explica cómo
                        se calcularon las facturas que la referencian, así que conviene
                        reportarlo en vez de darlo por perdido.
                    </p>
                } @else if (selected() === currentVersion()) {
                    <p class="text-xs text-text-secondary md:text-sm">
                        Es la versión vigente: no hay nada que comparar.
                    </p>
                } @else if (diff().length === 0) {
                    <p class="text-xs text-text-secondary md:text-sm">
                        Esta versión y la vigente tienen la misma configuración. Se guardó
                        una versión nueva sin cambios de contenido.
                    </p>
                } @else {
                    <p class="mb-2 text-xs text-text-secondary md:text-sm">
                        {{ diff().length }} campo(s) distinto(s) entre v{{ selected() }} y la
                        vigente (v{{ currentVersion() }}).
                    </p>
                    <div class="overflow-x-auto">
                        <table class="w-full min-w-[560px] text-left text-xs md:text-sm">
                            <caption class="sr-only">
                                Diferencias campo por campo
                            </caption>
                            <thead class="border-b border-border text-text-secondary">
                                <tr>
                                    <th scope="col" class="py-1 pr-2">Campo</th>
                                    <th scope="col" class="py-1 pr-2">v{{ selected() }}</th>
                                    <th scope="col" class="py-1">Vigente</th>
                                </tr>
                            </thead>
                            <tbody>
                                @for (entry of diff(); track entry.path) {
                                    <tr class="border-b border-border/50">
                                        <td class="py-1 pr-2">
                                            <span class="flex items-center gap-1">
                                                <app-icon
                                                    [name]="iconFor(entry)"
                                                    [size]="12"
                                                ></app-icon>
                                                {{ describePath(entry.path) }}
                                            </span>
                                        </td>
                                        <td class="py-1 pr-2 text-text-secondary">
                                            {{ show(entry.before) }}
                                        </td>
                                        <td class="py-1 font-medium">
                                            {{ show(entry.after) }}
                                        </td>
                                    </tr>
                                }
                            </tbody>
                        </table>
                    </div>
                }
            </div>
        </div>
    `,
})
export class InvoiceProfileVersionsPanelComponent {
    private readonly store = inject(Store);

    readonly profileId = input<number | null>(null);
    readonly currentVersion = input<number>(0);

    readonly selected = signal<number | null>(null);

    readonly versions = toSignal(this.store.select(selectCurrentProfileVersions), {
        initialValue: [] as InvoiceProfileVersionSummary[],
    });
    readonly loading = toSignal(this.store.select(selectProfileVersionsLoading), {
        initialValue: false,
    });
    readonly snapshot = toSignal(this.store.select(selectProfileVersionSnapshot), {
        initialValue: null,
    });
    readonly snapshotLoading = toSignal(
        this.store.select(selectProfileVersionSnapshotLoading),
        { initialValue: false },
    );
    private readonly currentConfig = toSignal(
        this.store.select(selectCurrentProfileConfig),
        { initialValue: null },
    );

    readonly diff = computed<ConfigDiffEntry[]>(() => {
        const older = this.snapshot()?.config as InvoiceProfileConfig | undefined;
        const current = this.currentConfig();
        if (!older || !current) return [];
        return diffProfileConfig(older, current);
    });

    constructor() {
        effect(() => {
            const id = this.profileId();
            if (id !== null) {
                this.store.dispatch(ProfileActions.loadProfileVersions({ id }));
            }
        });
    }

    select(version: InvoiceProfileVersionSummary): void {
        const id = this.profileId();
        if (id === null) return;
        this.selected.set(version.version);
        // La vigente ya está en `currentConfig`: pedirla otra vez sería una
        // llamada para traer lo que ya se tiene.
        if (version.version === this.currentVersion()) {
            this.store.dispatch(ProfileActions.clearProfileVersionSnapshot());
            return;
        }
        this.store.dispatch(
            ProfileActions.loadProfileVersion({ id, version: version.version }),
        );
    }

    authorOf(version: InvoiceProfileVersionSummary): string {
        const creator = version.creator;
        if (!creator) return 'Autor no registrado';
        const name = [creator.first_name, creator.last_name]
            .filter((part) => Boolean(part))
            .join(' ')
            .trim();
        // Sin correo en el contrato: el backend expone id, nombre y apellido.
        // Caer al id es mejor que a un texto vacío — en una auditoría el número
        // sigue siendo identificable.
        return name.length > 0 ? name : 'Usuario ' + creator.id;
    }

    /**
     * Fecha y hora locales.
     *
     * `created_at` llega como ISO con zona, así que `Date` la interpreta bien.
     * El riesgo de off-by-one es de las columnas fecha-sola, que acá no hay.
     */
    formatDate(value: string): string {
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? value
            : date.toLocaleString('es-CO', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
              });
    }

    describePath(path: string): string {
        return describeConfigPath(path);
    }

    show(value: unknown): string {
        return formatConfigValue(value);
    }

    iconFor(entry: ConfigDiffEntry): string {
        if (entry.kind === 'added') return 'plus';
        if (entry.kind === 'removed') return 'minus';
        return 'arrow-right';
    }
}
