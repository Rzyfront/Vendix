import {Component, ChangeDetectionStrategy, OnInit, inject, input, output, signal, computed, DestroyRef} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs';

import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  ShippingZone,
  ShippingRate,
  ShippingRateType,
  CreateRateDto,
  UpdateRateDto,
  ShippingRateTaxOptions,
} from '../../interfaces/shipping-zones.interface';
import { ShippingMethodsService } from '../../services/shipping-methods.service';
import { ZoneModalComponent } from '../zone-modal/zone-modal.component';
import {
  ModalComponent,
  InputComponent,
  IconComponent,
  ButtonComponent,
  ToastService,
  StepsLineComponent,
  SettingToggleComponent,
  SelectorComponent,
} from '../../../../../../../shared/components/index';
import { SelectorOption } from '../../../../../../../shared/components/selector/selector.component';
import { StepsLineItem } from '../../../../../../../shared/components/steps-line/steps-line.component';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency/currency.pipe';

/**
 * Vista previa informativa del impuesto incluido en el precio de la tarifa.
 * El precio configurado es lo que paga el cliente; la base se despeja como
 * `cost / (1 + r)` redondeada a 2 decimales. Solo orienta: el cálculo que se
 * factura lo hace el backend al vender.
 */
export interface ShippingTaxPreview {
  cost: number;
  tax: number;
  label: string;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeShippingTaxPreview(
  cost: number,
  rate_percent: number | null | undefined,
  label: string | null,
): ShippingTaxPreview | null {
  if (!label || rate_percent == null || !(Number(rate_percent) > 0)) return null;
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const base = round2(cost / (1 + Number(rate_percent) / 100));
  return { cost, tax: round2(cost - base), label };
}

/** El selector trabaja con `number`; `null` es «Sin impuesto». */
export function toTaxCategoryId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

@Component({
  selector: 'app-add-rate-wizard-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    StepsLineComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SettingToggleComponent,
    SelectorComponent,
    CurrencyPipe,
    ZoneModalComponent
],
  templateUrl: './add-rate-wizard-modal.component.html',
  styleUrls: ['./add-rate-wizard-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddRateWizardModalComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private shippingService = inject(ShippingMethodsService);
  private fb = inject(FormBuilder);
  private toastService = inject(ToastService);

  // ─── Inputs ───

  method_id = input.required<number>();
  existing_zones = input<ShippingZone[]>([]);
  edit_rate = input<ShippingRate | null>(null);

  // ─── Outputs ───

  close = output<void>();
  saved = output<void>();
  /** Se emite al editar una zona desde el wizard para que el padre recargue. */
  zones_changed = output<void>();

  // ─── State ───

  current_step = signal<number>(0);
  selected_zone_id = signal<number | null>(null);
  show_zone_creation = signal<boolean>(false);
  is_saving = signal<boolean>(false);
  is_loading_zones = signal<boolean>(false);
  zones_list = signal<ShippingZone[]>([]);
  /** Zona abierta en `<app-zone-modal mode="edit">` (fuera del modal principal). */
  editing_zone = signal<ShippingZone | null>(null);

  // ─── Impuesto del envío ───

  tax_options = signal<ShippingRateTaxOptions | null>(null);
  is_loading_tax_options = signal<boolean>(false);
  tax_options_error = signal<string | null>(null);

  // ─── Steps config ───

  steps: StepsLineItem[] = [
    { label: 'Zona de envío' },
    { label: 'Configurar tarifa' },
  ];

  // ─── Rate type options ───

  rate_types: { value: string; label: string; icon: string; description: string }[] = [
    { value: 'flat', label: 'Tarifa plana', icon: 'tag', description: 'Costo fijo por envío' },
    { value: 'weight_based', label: 'Por peso', icon: 'package', description: 'Varía según el peso' },
    { value: 'price_based', label: 'Por precio', icon: 'dollar-sign', description: 'Varía según el monto' },
    { value: 'free', label: 'Gratis', icon: 'sparkles', description: 'Sin costo de envío' },
  ];

  // ─── Form ───

  rate_form = this.fb.group({
    type: ['flat' as string, Validators.required],
    base_cost: [0, [Validators.required, Validators.min(0)]],
    per_unit_cost: [null as number | null],
    min_val: [null as number | null],
    max_val: [null as number | null],
    free_shipping_threshold: [null as number | null],
    is_active: [true],
    name: [''],
    tax_category_id: [null as number | null],
  });

  /** Puente zoneless del valor del formulario (los `computed` lo leen). */
  private readonly form_value = toSignal(
    this.rate_form.valueChanges.pipe(startWith(this.rate_form.getRawValue())),
    { initialValue: this.rate_form.getRawValue() },
  );

  // ─── Computed ───

  can_proceed_step1 = computed(() => this.selected_zone_id() !== null);
  is_edit_mode = computed(() => this.edit_rate() !== null);

  /** En edición la zona de la tarifa no se cambia; solo se puede editar. */
  fixed_zone = computed<ShippingZone | null>(() => {
    if (!this.is_edit_mode()) return null;
    const id = this.selected_zone_id();
    return this.zones_list().find((z) => z.id === id) ?? null;
  });

  visible_zones = computed<ShippingZone[]>(() => {
    const fixed = this.fixed_zone();
    if (this.is_edit_mode()) return fixed ? [fixed] : [];
    return this.zones_list();
  });

  is_free_type = computed(() => this.form_value().type === 'free');

  tax_selector_options = computed<SelectorOption[]>(() => {
    const options: SelectorOption[] = [
      // `SelectorOption.value` no admite null en su tipo, pero el <select>
      // nativo usa [ngValue] y compara por identidad: null es «Sin impuesto».
      { value: null as unknown as number, label: 'Sin impuesto' },
    ];
    const categories = this.tax_options()?.categories ?? [];
    for (const c of categories) {
      const tax_label = this.shippingService.getRateTaxLabel(c);
      const base = tax_label ? `${c.name} (${tax_label})` : c.name;
      options.push({
        value: c.id,
        label: c.eligible ? base : `${base} — ${c.reason || 'No disponible'}`,
        disabled: !c.eligible,
        description: c.eligible ? undefined : c.reason,
      });
    }
    // La tarifa en edición puede traer una categoría que ya no aparece en el
    // catálogo: se conserva visible para no perder la selección en silencio.
    const current = this.edit_rate()?.tax_category;
    if (current && !categories.some((c) => c.id === current.id)) {
      const tax_label = this.shippingService.getRateTaxLabel(current);
      options.push({
        value: current.id,
        label: tax_label ? `${current.name} (${tax_label})` : current.name,
      });
    }
    return options;
  });

  selected_tax = computed<{ rate_percent: number | null; label: string | null } | null>(() => {
    const id = toTaxCategoryId(this.form_value().tax_category_id);
    if (id === null) return null;
    const option = this.tax_options()?.categories.find((c) => c.id === id);
    if (option) {
      return {
        rate_percent: option.rate_percent,
        label: this.shippingService.getRateTaxLabel(option),
      };
    }
    const current = this.edit_rate()?.tax_category;
    if (current && current.id === id) {
      return {
        rate_percent: current.rate_percent,
        label: this.shippingService.getRateTaxLabel(current),
      };
    }
    return null;
  });

  tax_preview = computed<ShippingTaxPreview | null>(() => {
    const tax = this.selected_tax();
    if (!tax || this.is_free_type()) return null;
    return computeShippingTaxPreview(
      Number(this.form_value().base_cost),
      tax.rate_percent,
      tax.label,
    );
  });

  tax_suggestion = computed(() => this.tax_options()?.suggestion?.message ?? null);
  tax_warnings = computed(() => this.tax_options()?.warnings ?? []);

  // ─── Dynamic labels (extracted from rates-modal) ───

  get variableLabel(): string {
    const type = this.rate_form.get('type')?.value;
    if (type === 'weight_based') return 'Costo por Kg Extra';
    return 'Costo Variable';
  }

  get minLabel(): string {
    const type = this.rate_form.get('type')?.value;
    if (type === 'weight_based') return 'Peso Mínimo';
    if (type === 'price_based') return 'Compra Mínima';
    return 'Valor Mínimo';
  }

  get maxLabel(): string {
    const type = this.rate_form.get('type')?.value;
    if (type === 'weight_based') return 'Peso Máximo';
    if (type === 'price_based') return 'Compra Máxima';
    return 'Valor Máximo';
  }

  get strategySummary(): string {
    const values = this.rate_form.value;
    const type = values.type as ShippingRateType;
    const base = values.base_cost || 0;
    const variable = values.per_unit_cost || 0;
    const min = values.min_val;
    const max = values.max_val;
    const free = values.free_shipping_threshold;

    let text = '';

    if (type === 'free') {
      text = 'El envío será totalmente <strong>gratuito</strong>';
    } else {
      text = `Se cobrará un costo base de <strong>$${base}</strong>`;
      if (variable > 0) {
        const unit = type === 'weight_based' ? 'kg' : 'unidad';
        text += ` más <strong>$${variable}</strong> por cada ${unit} adicional`;
      }
    }

    if (min !== null || max !== null) {
      const unit = type === 'weight_based' ? 'kg' : (type === 'price_based' ? '$' : '');
      const minText = min !== null ? `${unit}${min}` : 'el inicio';
      const maxText = max !== null ? `${unit}${max}` : 'el infinito';
      text += `, siempre que el pedido esté entre <strong>${minText}</strong> y <strong>${maxText}</strong>`;
    }

    if (
      free !== null &&
      free !== undefined &&
      (free as unknown) !== '' &&
      !isNaN(Number(free)) &&
      Number(free) >= 0
    ) {
      text +=
        Number(free) === 0
          ? `. Además, el envío será <strong>gratis</strong>`
          : `. Además, será <strong>gratis</strong> si la compra supera los <strong>$${free}</strong>`;
    }

    return text + '.';
  }

  // ─── Lifecycle ───

  ngOnInit(): void {
    this.zones_list.set(this.existing_zones());
    this.loadTaxOptions();

    const rate = this.edit_rate();
    if (rate) {
      this.selected_zone_id.set(rate.shipping_zone_id);
      this.rate_form.patchValue({
        type: rate.type,
        base_cost: rate.base_cost,
        per_unit_cost: rate.per_unit_cost != null ? Number(rate.per_unit_cost) : null,
        min_val: rate.min_val != null ? Number(rate.min_val) : null,
        max_val: rate.max_val != null ? Number(rate.max_val) : null,
        free_shipping_threshold:
          rate.free_shipping_threshold != null
            ? Number(rate.free_shipping_threshold)
            : null,
        is_active: rate.is_active,
        name: rate.name || '',
        tax_category_id: rate.tax_category?.id ?? rate.tax_category_id ?? null,
      });
      this.current_step.set(1);
      // La lista del padre puede no traer la zona de la tarifa en edición.
      if (!this.zones_list().some((z) => z.id === rate.shipping_zone_id)) {
        this.reloadZones();
      }
    }
  }

  loadTaxOptions(): void {
    this.is_loading_tax_options.set(true);
    this.tax_options_error.set(null);
    this.shippingService
      .getRateTaxOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => {
          this.tax_options.set(options);
          this.is_loading_tax_options.set(false);
        },
        error: () => {
          this.tax_options_error.set(
            'No se pudieron cargar los impuestos. Puedes guardar la tarifa sin impuesto.',
          );
          this.is_loading_tax_options.set(false);
        },
      });
  }

  // ─── Actions ───

  selectZone(zoneId: number): void {
    this.selected_zone_id.set(zoneId);
  }

  goToStep(step: number): void {
    this.current_step.set(step);
  }

  selectRateType(type: string): void {
    this.rate_form.patchValue({ type });
    if (type === 'free') {
      this.rate_form.patchValue({
        base_cost: 0,
        per_unit_cost: null,
        min_val: null,
        max_val: null,
        free_shipping_threshold: null,
      });
    }
  }

  formatCountries(countries: string[] | undefined): string {
    if (!countries || countries.length === 0) return 'Sin países asignados';
    const countryNames: Record<string, string> = {
      CO: 'Colombia',
      DO: 'Rep. Dominicana',
      MX: 'México',
      US: 'Estados Unidos',
      PR: 'Puerto Rico',
      PA: 'Panamá',
      VE: 'Venezuela',
      AR: 'Argentina',
      CL: 'Chile',
      PE: 'Perú',
      ES: 'España',
    };
    const mapped = countries.map((c) => countryNames[c] || c);
    if (mapped.length <= 3) return mapped.join(', ');
    return `${mapped.slice(0, 3).join(', ')} +${mapped.length - 3}`;
  }

  // ─── Editar zona desde el wizard ───

  openZoneEdit(zone: ShippingZone, event: Event): void {
    event.stopPropagation();
    for (const notice of this.zoneEditNotices(zone)) {
      this.toastService.show({ variant: 'warning', description: notice, duration: 6000 });
    }
    this.editing_zone.set(zone);
  }

  /** Avisos antes de editar una zona compartida o copiada del sistema. */
  zoneEditNotices(zone: ShippingZone): string[] {
    const notices: string[] = [];
    const usage = zone._count?.shipping_rates ?? 0;
    if (usage > 1) {
      notices.push(`Esta zona la usan ${usage} tarifas: los cambios aplican a todas.`);
    }
    if (zone.source_type === 'system_copy') {
      notices.push(
        'Esta zona es copia de una zona del sistema: si la sincronizas con el sistema, se sobrescribirán tus cambios.',
      );
    }
    return notices;
  }

  onZoneEdited(): void {
    this.reloadZones();
    this.zones_changed.emit();
  }

  /** Recarga las zonas conservando la zona elegida. */
  reloadZones(): void {
    this.is_loading_zones.set(true);
    this.shippingService.getStoreZones().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (zones) => {
        this.zones_list.set(zones);
        this.is_loading_zones.set(false);
      },
      error: () => {
        this.is_loading_zones.set(false);
      },
    });
  }

  onZoneCreated(): void {
    this.show_zone_creation.set(false);
    this.is_loading_zones.set(true);

    this.shippingService.getStoreZones().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (zones) => {
        this.zones_list.set(zones);
        // Auto-select the newest zone (highest ID)
        const newest = zones.reduce((max, z) => (z.id > max.id ? z : max), zones[0]);
        if (newest) {
          this.selected_zone_id.set(newest.id);
        }
        this.is_loading_zones.set(false);
      },
      error: () => {
        this.is_loading_zones.set(false);
      },
    });
  }

  onSubmit(): void {
    if (this.rate_form.invalid || !this.selected_zone_id()) return;

    this.is_saving.set(true);

    const values = this.rate_form.value;

    const parseNullableNumber = (val: any): number | null => {
      if (val === null || val === undefined || val === '' || isNaN(Number(val))) {
        return null;
      }
      return Number(val);
    };

    // F-008/ADR-04 — 0 = envío gratis explícito (backend `>= 0`); null = sin
    // umbral; negativo = inválido con error visible (antes 0 y negativos se
    // coaccionaban a null en silencio).
    const parseThresholdOrNull = (val: any): number | null => parseNullableNumber(val);

    const freeThreshold = parseThresholdOrNull(values.free_shipping_threshold);
    if (freeThreshold !== null && freeThreshold < 0) {
      this.toastService.show({
        variant: 'error',
        description: 'El umbral de envío gratis debe ser un número mayor o igual a 0',
      });
      this.is_saving.set(false);
      return;
    }
    const perUnitCost = parseNullableNumber(values.per_unit_cost);
    const minVal = parseNullableNumber(values.min_val);
    const maxVal = parseNullableNumber(values.max_val);
    const nameVal =
      values.name && typeof values.name === 'string' && values.name.trim().length > 0
        ? values.name.trim()
        : null;

    // F-014 — misma línea que el resto del método: parse explícito y error
    // visible si no es número. `Number(...) || 0` convertía `NaN`/`''` en 0
    // silencioso y un tipeo inválido se volvía "gratis".
    const baseCost = parseNullableNumber(values.base_cost);
    if (baseCost === null || baseCost < 0) {
      this.toastService.show({
        variant: 'error',
        description: 'El costo base debe ser un número válido mayor o igual a 0',
      });
      this.is_saving.set(false);
      return;
    }

    const dto: CreateRateDto = {
      shipping_zone_id: this.selected_zone_id()!,
      shipping_method_id: this.method_id(),
      name: nameVal,
      type: (values.type as ShippingRateType) || 'flat',
      base_cost: baseCost,
      per_unit_cost: perUnitCost,
      min_val: minVal,
      max_val: maxVal,
      free_shipping_threshold: freeThreshold,
      is_active: values.is_active ?? true,
      // Gratis no cobra envío: no hay impuesto que llevar.
      tax_category_id:
        values.type === 'free' ? null : toTaxCategoryId(values.tax_category_id),
    };

    const obs = this.is_edit_mode()
      ? this.shippingService.updateRate(this.edit_rate()!.id, dto as UpdateRateDto)
      : this.shippingService.createRate(dto);

    obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toastService.show({
          variant: 'success',
          description: this.is_edit_mode() ? 'Tarifa actualizada' : 'Tarifa creada exitosamente',
        });
        this.is_saving.set(false);
        this.saved.emit();
        this.close.emit();
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : '';
        this.toastService.show({
          variant: 'error',
          description:
            message && message !== 'An unknown error occurred'
              ? `Error al guardar la tarifa: ${message}`
              : 'Error al guardar la tarifa',
        });
        this.is_saving.set(false);
      },
    });
  }
}
