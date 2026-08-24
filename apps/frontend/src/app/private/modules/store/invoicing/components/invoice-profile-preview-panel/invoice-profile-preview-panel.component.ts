import { Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';

import {
    ButtonComponent,
    IconComponent,
    InputComponent,
    TextareaComponent,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/index';
import type {
    ProfilePreviewLine,
    ProfilePreviewValidation,
} from '../../interfaces/invoice-profile.interface';
import * as ProfileActions from '../../state/actions/invoice-profile.actions';
import {
    selectCurrentProfilePreview,
    selectPreviewValidationGroups,
    selectProfilePreviewError,
    selectProfilePreviewLoading,
} from '../../state/selectors/invoice-profile.selectors';

/**
 * Panel de previsualización del perfil (E.5).
 *
 * ## Qué es y qué NO es
 *
 * Enseña el documento que ESTE perfil produciría, armado por el mismo emisor
 * que emite de verdad, pero **sin** reservar numeración, sin firmar y sin
 * transmitir. Eso último se pinta explícitamente: un XML que se parece a una
 * factura y no lo es resulta peligroso justo por parecerlo, y el operador tiene
 * que leer en pantalla que no se quemó ningún consecutivo.
 *
 * ## Por qué los números NO se recalculan acá
 *
 * Los totales salen leídos del XML de la respuesta. Recalcularlos en el cliente
 * daría una segunda aritmética que puede coincidir hoy y divergir mañana, y una
 * previsualización que no refleja el cálculo real da confianza falsa sobre la
 * base gravable — que es exactamente lo que este plan existe para evitar. Si el
 * cliente y el XML discrepan, el que manda es el XML.
 *
 * ## Por qué exige un perfil guardado
 *
 * La ruta es `POST /profiles/:id/preview`: sin `:id` no hay nada que
 * previsualizar. En creación se pide guardar primero, en vez de ofrecer un
 * botón que siempre falla.
 */
@Component({
    selector: 'vendix-invoice-profile-preview-panel',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        ButtonComponent,
        IconComponent,
        InputComponent,
        TextareaComponent,
    ],
    template: `
        <div class="flex flex-col gap-3">
            <!-- Escenario. Valores de muestra editables: el desglose depende
                 del valor del contrato, así que fijarlo escondería justo el
                 caso que el operador quiere comprobar (el piso legal). -->
            <form [formGroup]="form" class="grid grid-cols-1 gap-2 md:grid-cols-3">
                <app-input
                    label="Valor del contrato"
                    formControlName="contract_value"
                    type="number"
                    helperText="Base del cálculo. Mueve el piso legal."
                ></app-input>
                @if (showAiuValue()) {
                    <app-input
                        label="Valor A+I+U"
                        formControlName="aiu_value"
                        type="number"
                        helperText="Suma de administración, imprevistos y utilidad."
                    ></app-input>
                }
                <div class="flex items-end">
                    <app-button
                        variant="primary"
                        [disabled]="loading() || profileId() === null"
                        (clicked)="runPreview()"
                    >
                        <app-icon slot="icon" name="eye" [size]="16"></app-icon>
                        {{ loading() ? 'Calculando…' : 'Previsualizar' }}
                    </app-button>
                </div>
                <div class="md:col-span-3">
                    <app-textarea
                        label="Objeto del contrato (sólo para esta prueba)"
                        formControlName="contract_object"
                        [rows]="2"
                        helperText="No modifica el perfil. Se usa únicamente para armar el documento de muestra."
                    ></app-textarea>
                </div>
            </form>

            @if (profileId() === null) {
                <div
                    class="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary md:text-sm"
                    role="status"
                >
                    Guarda el perfil para poder previsualizar: el documento de muestra se
                    arma con la versión ya guardada, no con lo que está sin guardar.
                </div>
            }

            @if (error(); as failure) {
                <div
                    class="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger md:text-sm"
                    role="alert"
                >
                    <strong>{{ failure.code }}</strong> — {{ failure.message }}
                </div>
            }

            @if (preview(); as result) {
                <!-- Lo que NO se hizo. Va arriba, antes de los números. -->
                <div
                    class="rounded-lg border border-info/40 bg-info/5 px-3 py-2 text-xs md:text-sm"
                    role="status"
                >
                    <p class="font-semibold">Esto es una muestra, no una factura.</p>
                    <ul class="mt-1 list-inside list-disc">
                        <li>No se reservó numeración ni se consumió consecutivo.</li>
                        <li>No se firmó digitalmente.</li>
                        <li>No se transmitió a la DIAN.</li>
                        <li>No se guardó ningún registro.</li>
                    </ul>
                    <p class="mt-1 text-text-secondary">
                        Perfil {{ result.profile.name }} · versión v{{ result.profile.version }}
                    </p>
                </div>

                <!-- Resumen AIU -->
                @if (result.aiu_summary; as aiu) {
                    <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
                        <div class="rounded-lg border border-border p-2">
                            <p class="text-[11px] text-text-secondary">Valor del contrato</p>
                            <p class="text-sm font-semibold">{{ money(aiu.contract_value) }}</p>
                        </div>
                        <div class="rounded-lg border border-border p-2">
                            <p class="text-[11px] text-text-secondary">A+I+U</p>
                            <p class="text-sm font-semibold">{{ money(aiu.aiu_value) }}</p>
                        </div>
                        <div class="rounded-lg border border-primary p-2">
                            <p class="text-[11px] text-text-secondary">Base gravable</p>
                            <p class="text-sm font-semibold">{{ money(aiu.taxable_base) }}</p>
                        </div>
                        <div class="rounded-lg border border-border p-2">
                            <p class="text-[11px] text-text-secondary">Mínimo legal</p>
                            <p class="text-sm font-semibold">{{ money(aiu.minimum_base) }}</p>
                        </div>
                        @if (aiu.note) {
                            <p class="col-span-2 text-[11px] text-text-secondary md:col-span-4">
                                {{ aiu.note }}
                            </p>
                        }
                    </div>
                }

                <!-- Líneas -->
                <div class="overflow-x-auto">
                    <table class="w-full min-w-[640px] text-left text-xs md:text-sm">
                        <caption class="sr-only">
                            Desglose línea por línea del documento de muestra
                        </caption>
                        <thead class="border-b border-border text-text-secondary">
                            <tr>
                                <th scope="col" class="py-1 pr-2">#</th>
                                <th scope="col" class="py-1 pr-2">Concepto</th>
                                <th scope="col" class="py-1 pr-2 text-right">Valor</th>
                                <th scope="col" class="py-1 pr-2 text-right">Impuesto</th>
                                <th scope="col" class="py-1">Gravabilidad</th>
                            </tr>
                        </thead>
                        <tbody>
                            @for (line of result.breakdown.lines; track line.index) {
                                <tr class="border-b border-border/50">
                                    <td class="py-1 pr-2">{{ line.index }}</td>
                                    <td class="py-1 pr-2">
                                        {{ line.description }}
                                        <span class="text-text-secondary"
                                            >· {{ bucketLabel(line.bucket) }}</span
                                        >
                                        @if (line.note) {
                                            <span class="block text-[11px] text-text-secondary">
                                                {{ line.note }}
                                            </span>
                                        }
                                    </td>
                                    <td class="py-1 pr-2 text-right">
                                        {{ money(line.line_extension_amount) }}
                                    </td>
                                    <td class="py-1 pr-2 text-right">
                                        {{ money(line.tax_amount) }}
                                    </td>
                                    <td class="py-1">{{ taxabilityLabel(line) }}</td>
                                </tr>
                            }
                        </tbody>
                    </table>
                </div>

                <!-- Totales. Etiquetas que distinguen contrato de base: son
                     cifras DISTINTAS en AIU y confundirlas es el defecto que
                     este panel existe para hacer visible. -->
                <div class="grid grid-cols-2 gap-2 md:grid-cols-3">
                    <div class="rounded-lg border border-border p-2">
                        <p class="text-[11px] text-text-secondary">
                            Suma de líneas (valor del contrato)
                        </p>
                        <p class="text-sm font-semibold">
                            {{ money(result.breakdown.totals.line_extension_amount) }}
                        </p>
                    </div>
                    <div class="rounded-lg border border-border p-2">
                        <p class="text-[11px] text-text-secondary">Descuentos</p>
                        <p class="text-sm font-semibold">
                            {{ money(result.breakdown.totals.discount_amount) }}
                        </p>
                    </div>
                    <div class="rounded-lg border border-primary p-2">
                        <p class="text-[11px] text-text-secondary">
                            Base gravable (TaxExclusiveAmount)
                        </p>
                        <p class="text-sm font-semibold">
                            {{ money(result.breakdown.totals.tax_exclusive_amount) }}
                        </p>
                    </div>
                    <div class="rounded-lg border border-border p-2">
                        <p class="text-[11px] text-text-secondary">Impuesto</p>
                        <p class="text-sm font-semibold">
                            {{ money(result.breakdown.totals.tax_amount) }}
                        </p>
                    </div>
                    <div class="rounded-lg border border-border p-2">
                        <p class="text-[11px] text-text-secondary">
                            Contrato + impuesto (TaxInclusiveAmount)
                        </p>
                        <p class="text-sm font-semibold">
                            {{ money(result.breakdown.totals.tax_inclusive_amount) }}
                        </p>
                    </div>
                    <div class="rounded-lg border border-border p-2">
                        <p class="text-[11px] text-text-secondary">Total a pagar</p>
                        <p class="text-sm font-semibold">
                            {{ money(result.breakdown.totals.payable_amount) }}
                        </p>
                    </div>
                </div>

                <!-- Validaciones del anexo, con su código de emisión -->
                @if (groups(); as validation) {
                    <div class="flex flex-col gap-2">
                        <div
                            class="rounded-lg border px-3 py-2 text-xs md:text-sm"
                            [class.border-success]="validation.emitable"
                            [class.text-success]="validation.emitable"
                            [class.border-danger]="!validation.emitable"
                            [class.text-danger]="!validation.emitable"
                            role="status"
                        >
                            {{
                                validation.emitable
                                    ? 'Con esta configuración el documento pasa las reglas comprobadas del anexo.'
                                    : 'Con esta configuración la DIAN rechazaría el documento.'
                            }}
                            ({{ validation.passed.length }}/{{ validation.all.length }} reglas)
                        </div>

                        @for (item of failing(); track item.rule) {
                            <div
                                class="rounded-lg border px-3 py-2 text-xs md:text-sm"
                                [class.border-danger]="item.severity === 'blocker'"
                                [class.text-danger]="item.severity === 'blocker'"
                                [class.border-warning]="item.severity === 'warning'"
                                [class.text-warning]="item.severity === 'warning'"
                                [class.border-border]="item.severity === 'info'"
                                [attr.role]="item.severity === 'blocker' ? 'alert' : 'status'"
                            >
                                <strong>{{ item.rule }}</strong>
                                @if (item.code) {
                                    <span> · {{ item.code }}</span>
                                }
                                <p>{{ item.message }}</p>
                            </div>
                        }
                    </div>
                }
            }
        </div>
    `,
})
export class InvoiceProfilePreviewPanelComponent {
    private readonly store = inject(Store);
    private readonly fb = inject(FormBuilder);
    private readonly currency = inject(CurrencyFormatService);

    /** `null` mientras el perfil no está guardado. */
    readonly profileId = input<number | null>(null);
    /** `true` si el perfil es de operación AIU (09). */
    readonly isAiu = input<boolean>(false);
    /** Objeto de contrato del perfil, como valor inicial del escenario. */
    readonly contractObject = input<string>('');

    readonly form: FormGroup = this.fb.group({
        contract_value: [100000000],
        aiu_value: [10000000],
        contract_object: [''],
    });

    private readonly seeded = signal(false);

    readonly preview = toSignal(this.store.select(selectCurrentProfilePreview), {
        initialValue: null,
    });
    readonly loading = toSignal(this.store.select(selectProfilePreviewLoading), {
        initialValue: false,
    });
    readonly error = toSignal(this.store.select(selectProfilePreviewError), {
        initialValue: null,
    });
    /**
     * `initialValue` con la forma vacía y no `null`: el selector devuelve
     * siempre un objeto, así que sembrar `null` haría que el tipo del signal
     * incluyera `null` sin que el flujo pueda producirlo — y la plantilla
     * tendría una rama que nunca se ejecuta escondiendo un error de tipo real.
     */
    readonly groups = toSignal(this.store.select(selectPreviewValidationGroups), {
        initialValue: {
            all: [] as ProfilePreviewValidation[],
            passed: [] as ProfilePreviewValidation[],
            blockers: [] as ProfilePreviewValidation[],
            warnings: [] as ProfilePreviewValidation[],
            infos: [] as ProfilePreviewValidation[],
            emitable: true,
        },
    });

    readonly showAiuValue = computed(() => this.isAiu());

    /**
     * Reglas que NO pasaron, en orden de gravedad.
     *
     * Sólo se listan las fallidas: enumerar las 11 que pasaron empuja las que
     * importan fuera de la pantalla, y el contador del encabezado ya dice
     * cuántas se comprobaron.
     */
    readonly failing = computed<ProfilePreviewValidation[]>(() => {
        const group = this.groups();
        if (!group) return [];
        const order: Record<string, number> = { blocker: 0, warning: 1, info: 2 };
        return [...group.blockers, ...group.warnings, ...group.infos].sort(
            (a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3),
        );
    });

    runPreview(): void {
        const id = this.profileId();
        if (id === null) return;

        // Se siembra el objeto de contrato del perfil la primera vez: escribirlo
        // de nuevo a mano en cada previsualización es fricción sin propósito.
        if (!this.seeded()) {
            this.form.patchValue(
                { contract_object: this.contractObject() },
                { emitEvent: false },
            );
            this.seeded.set(true);
        }

        const raw = this.form.getRawValue() as Record<string, unknown>;
        const contract_object = String(raw['contract_object'] ?? '').trim();

        this.store.dispatch(
            ProfileActions.previewProfile({
                id,
                payload: {
                    contract_value: Number(raw['contract_value'] ?? 0),
                    // `aiu_value` sólo si aplica: mandarlo en un perfil estándar
                    // sería un campo de más que el DTO rechaza con 400 por
                    // `forbidNonWhitelisted`… y, peor, sugeriría que un perfil
                    // no AIU tiene componentes.
                    ...(this.isAiu()
                        ? { aiu_value: Number(raw['aiu_value'] ?? 0) }
                        : {}),
                    ...(contract_object.length > 0 ? { contract_object } : {}),
                },
            }),
        );
    }

    money(value: string): string {
        const amount = Number(value);
        return Number.isFinite(amount) ? this.currency.format(amount) : value;
    }

    bucketLabel(bucket: string): string {
        return (
            {
                administracion: 'Administración',
                imprevistos: 'Imprevistos',
                utilidad: 'Utilidad',
                costo: 'Costo reembolsable',
            }[bucket] ?? bucket
        );
    }

    /**
     * Por qué una línea no lleva impuesto.
     *
     * `omit_tax_total` y «impuesto en cero» son cosas distintas: la primera dice
     * que la línea no emite el grupo `cac:TaxTotal` —no entra a la base— y la
     * segunda que lo emite con tarifa cero. Mostrar las dos como «sin impuesto»
     * borraría precisamente la distinción que decide si el documento cuadra.
     */
    taxabilityLabel(line: ProfilePreviewLine): string {
        if (line.omit_tax_total) return 'Fuera de la base gravable';
        return Number(line.tax_amount) === 0 ? 'Gravada al 0 %' : 'Gravada';
    }
}
