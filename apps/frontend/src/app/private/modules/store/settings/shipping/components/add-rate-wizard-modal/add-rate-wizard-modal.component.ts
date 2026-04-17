import {Component, ChangeDetectionStrategy, OnInit, inject, input, output, signal, computed, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
} from '../../../../../../../shared/components/index';
import { StepsLineItem } from '../../../../../../../shared/components/steps-line/steps-line.component';

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

  // ─── State ───

  current_step = signal<number>(0);
  selected_zone_id = signal<number | null>(null);
  show_zone_creation = signal<boolean>(false);
  is_saving = signal<boolean>(false);
  is_loading_zones = signal<boolean>(false);
  zones_list = signal<ShippingZone[]>([]);

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
  });

  // ─── Computed ───

  can_proceed_step1 = computed(() => this.selected_zone_id() !== null);
  is_edit_mode = computed(() => this.edit_rate() !== null);

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

    if (free !== null && free !== undefined && free > 0) {
      text += `. Además, será <strong>gratis</strong> si la compra supera los <strong>$${free}</strong>`;
    }

    return text + '.';
  }

  // ─── Lifecycle ───

  ngOnInit(): void {
    this.zones_list.set(this.existing_zones());

    const rate = this.edit_rate();
    if (rate) {
      this.selected_zone_id.set(rate.shipping_zone_id);
      this.rate_form.patchValue({
        type: rate.type,
        base_cost: rate.base_cost,
        per_unit_cost: rate.per_unit_cost ?? null,
        min_val: rate.min_val ?? null,
        max_val: rate.max_val ?? null,
        free_shipping_threshold: rate.free_shipping_threshold ?? null,
        is_active: rate.is_active,
        name: rate.name || '',
      });
      this.current_step.set(1);
    }
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

    const dto: CreateRateDto = {
      shipping_zone_id: this.selected_zone_id()!,
      shipping_method_id: this.method_id(),
      name: values.name || undefined,
      type: (values.type as ShippingRateType) || 'flat',
      base_cost: values.base_cost ?? 0,
      per_unit_cost: values.per_unit_cost ?? undefined,
      min_val: values.min_val ?? undefined,
      max_val: values.max_val ?? undefined,
      free_shipping_threshold: values.free_shipping_threshold ?? undefined,
      is_active: values.is_active ?? true,
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
      error: () => {
        this.toastService.show({ variant: 'error', description: 'Error al guardar la tarifa' });
        this.is_saving.set(false);
      },
    });
  }
}
