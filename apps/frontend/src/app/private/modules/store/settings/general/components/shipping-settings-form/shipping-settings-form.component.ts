import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormGroup,
  FormControl,
  FormArray,
} from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';

// Interfaces para Shipping
export interface CarrierConfig {
  tracking_enabled: boolean;
  estimated_days_min: number;
  estimated_days_max: number;
  requires_signature: boolean;
  requires_insurance: boolean;
  max_weight?: number | null;
  max_dimensions?: {
    length: number;
    width: number;
    height: number;
  } | null;
}

export interface StandardCarrier {
  id: string;
  name: string;
  type: 'fedex' | 'dhl' | 'ups' | 'correos' | 'estafeta' | 'custom';
  enabled: boolean;
  config: CarrierConfig;
}

export interface ExpressCarrierConfig {
  integration_enabled: boolean;
  priority: number;
  tracking_enabled: boolean;
  webhook_url?: string | null;
}

export interface ExpressCarrier {
  id: string;
  name: string;
  type: 'servientrega' | 'rappi' | 'didi' | 'uber_direct' | 'custom';
  enabled: boolean;
  config: ExpressCarrierConfig;
}

export interface LocalDeliveryConfig {
  coverage_radius?: number | null;
  estimated_minutes?: number | null;
  tracking_enabled: boolean;
}

export interface LocalDeliveryProvider {
  id: string;
  name: string;
  type: 'deliveri' | 'mensajeros' | 'motocicletas' | 'custom';
  enabled: boolean;
  config: LocalDeliveryConfig;
}

export interface ShippingTypesConfig {
  standard: {
    enabled: boolean;
    carriers: StandardCarrier[];
  };
  express: {
    enabled: boolean;
    carriers: ExpressCarrier[];
  };
  local: {
    enabled: boolean;
    allow_manual: boolean;
    delivery_providers: LocalDeliveryProvider[];
  };
}

export interface ShippingZone {
  id: string;
  name: string;
  countries: string[];
  states: string[];
  cities: string[];
  zip_codes: string[];
  shipping_rules: Array<{
    carrier_id: string;
    base_price: number;
    price_per_kg: number;
    free_shipping_threshold?: number | null;
    estimated_days: number;
  }>;
}

export interface ShippingSettings {
  enabled: boolean;
  free_shipping_threshold: number;
  allow_pickup: boolean;
  default_shipping_method?: string | null;
  shipping_types: ShippingTypesConfig;
  shipping_zones: ShippingZone[];
}

@Component({
  selector: 'app-shipping-settings-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputComponent, ToggleComponent],
  templateUrl: './shipping-settings-form.component.html',
  styleUrls: ['./shipping-settings-form.component.scss'],
})
export class ShippingSettingsForm implements OnInit, OnChanges {
  @Input() settings!: ShippingSettings;
  @Output() settingsChange = new EventEmitter<ShippingSettings>();

  form: FormGroup = new FormGroup({
    enabled: new FormControl(true),
    free_shipping_threshold: new FormControl(0),
    allow_pickup: new FormControl(true),
    default_shipping_method: new FormControl(null),
    shipping_types: new FormControl({
      standard: { enabled: true, carriers: [] },
      express: { enabled: false, carriers: [] },
      local: { enabled: true, allow_manual: true, delivery_providers: [] },
    }),
    shipping_zones: new FormControl([]),
  });

  // Typed getters for FormControls
  get enabledControl(): FormControl<boolean> {
    return this.form.get('enabled') as FormControl<boolean>;
  }

  get freeShippingThresholdControl(): FormControl<number> {
    return this.form.get('free_shipping_threshold') as FormControl<number>;
  }

  get allowPickupControl(): FormControl<boolean> {
    return this.form.get('allow_pickup') as FormControl<boolean>;
  }

  get defaultShippingMethodControl(): FormControl<string | null> {
    return this.form.get('default_shipping_method') as FormControl<
      string | null
    >;
  }

  ngOnInit() {
    this.patchForm();
  }

  ngOnChanges() {
    this.patchForm();
  }

  patchForm() {
    if (this.settings) {
      this.form.patchValue({
        enabled: this.settings.enabled,
        free_shipping_threshold: this.settings.free_shipping_threshold,
        allow_pickup: this.settings.allow_pickup,
        default_shipping_method: this.settings.default_shipping_method,
        shipping_types:
          this.settings.shipping_types || this.getDefaultShippingTypes(),
        shipping_zones: this.settings.shipping_zones || [],
      });
    }
  }

  getDefaultShippingTypes(): ShippingTypesConfig {
    return {
      standard: {
        enabled: true,
        carriers: [
          {
            id: 'fedex-1',
            name: 'FedEx',
            type: 'fedex',
            enabled: true,
            config: {
              tracking_enabled: true,
              estimated_days_min: 3,
              estimated_days_max: 7,
              requires_signature: false,
              requires_insurance: false,
              max_weight: null,
              max_dimensions: null,
            },
          },
        ],
      },
      express: {
        enabled: false,
        carriers: [],
      },
      local: {
        enabled: true,
        allow_manual: true,
        delivery_providers: [],
      },
    };
  }

  onFieldChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }

  get shippingTypes(): ShippingTypesConfig {
    return (
      this.form.get('shipping_types')?.value || this.getDefaultShippingTypes()
    );
  }

  get standardCarriers(): StandardCarrier[] {
    return this.shippingTypes.standard?.carriers || [];
  }

  get expressCarriers(): ExpressCarrier[] {
    return this.shippingTypes.express?.carriers || [];
  }

  get localProviders(): LocalDeliveryProvider[] {
    return this.shippingTypes.local?.delivery_providers || [];
  }

  get zones(): ShippingZone[] {
    return this.form.get('shipping_zones')?.value || [];
  }

  toggleShippingType(type: 'standard' | 'express' | 'local') {
    const current = this.shippingTypes;
    if (current[type]) {
      current[type].enabled = !current[type].enabled;
      this.form.get('shipping_types')?.setValue(current);
      this.onFieldChange();
    }
  }

  toggleCarrier(type: 'standard' | 'express', carrierId: string) {
    const current = this.shippingTypes;
    const carriers =
      type === 'standard'
        ? current.standard?.carriers
        : current.express?.carriers;
    const carrier = carriers?.find((c: any) => c.id === carrierId);
    if (carrier) {
      carrier.enabled = !carrier.enabled;
      this.form.get('shipping_types')?.setValue(current);
      this.onFieldChange();
    }
  }

  toggleLocalProvider(providerId: string) {
    const current = this.shippingTypes;
    const provider = current.local?.delivery_providers?.find(
      (p: any) => p.id === providerId,
    );
    if (provider) {
      provider.enabled = !provider.enabled;
      this.form.get('shipping_types')?.setValue(current);
      this.onFieldChange();
    }
  }
}
