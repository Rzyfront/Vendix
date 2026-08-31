import { Component, computed, effect, input, output, signal } from '@angular/core';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/selector/selector.component';
import {
  AlertBannerComponent,
  BadgeComponent,
  ExpandableCardComponent,
  IconComponent,
} from '../../../../../../../shared/components/index';

export type InventoryScope = 'main_location' | 'all_locations';

export type OutOfStockAction = 'hide' | 'show' | 'disable' | 'allow_backorder';

export interface InventorySettings {
  low_stock_threshold: number;
  out_of_stock_action: OutOfStockAction;
  track_inventory: boolean;
  allow_negative_stock: boolean;
  costing_method: 'cpp' | 'fifo';
  pos_stock_scope: InventoryScope;
  low_stock_alerts_scope: InventoryScope;
}

const DEFAULTS: InventorySettings = {
  low_stock_threshold: 10,
  out_of_stock_action: 'hide',
  track_inventory: true,
  allow_negative_stock: false,
  costing_method: 'cpp',
  pos_stock_scope: 'main_location',
  low_stock_alerts_scope: 'main_location',
};

/** Effect of each `out_of_stock_action` value, in operator language. */
const OUT_OF_STOCK_EFFECTS: Record<OutOfStockAction, string> = {
  hide: 'Intención: sacar el producto de la vitrina en cuanto llega a cero. El cliente no lo encuentra ni buscándolo.',
  show: 'Intención: dejarlo visible marcado como agotado, para que el cliente sepa que existe y vuelva.',
  disable:
    'Intención: mostrarlo con el botón de compra apagado, sin ofrecer alternativa de pedido.',
  allow_backorder:
    'Intención: dejar que el cliente lo compre igual y que el pedido quede esperando reposición.',
};

const COSTING_EFFECTS: Record<'cpp' | 'fifo', string> = {
  cpp: 'Cada compra recalcula un costo promedio único por producto. Es el método más simple de sostener y el que el sistema aplica por defecto.',
  fifo: 'Las salidas consumen primero las capas de costo más antiguas, así el costo de venta refleja lo que pagaste por esas unidades concretas. Necesita capas de costo cargadas: un producto sin capas sale marcado como dato parcial en el informe de valoración.',
};

const POS_SCOPE_EFFECTS: Record<InventoryScope, string> = {
  main_location:
    'El POS muestra las existencias de la bodega principal. Es lo recomendado cuando atiendes desde un solo punto: el vendedor ve el número que puede tocar.',
  all_locations:
    'El POS muestra las existencias sumadas de todas las bodegas vendibles. El vendedor ve más stock del que tiene a mano, y puede prometer unidades que están en otra sede.',
};

const ALERT_SCOPE_EFFECTS: Record<InventoryScope, string> = {
  main_location:
    'La alerta mira sólo la bodega principal: avisa aunque queden unidades en otra bodega. Más avisos, menos sorpresas en el mostrador.',
  all_locations:
    'La alerta suma todas las bodegas vendibles: no avisa mientras el total esté sobre el umbral, aunque una bodega puntual ya esté en cero.',
};

@Component({
  selector: 'app-inventory-settings-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    SelectorComponent,
    AlertBannerComponent,
    BadgeComponent,
    ExpandableCardComponent,
    IconComponent,
  ],
  templateUrl: './inventory-settings-form.component.html',
  styleUrls: ['./inventory-settings-form.component.scss'],
})
export class InventorySettingsForm {
  readonly settings = input.required<InventorySettings>();
  readonly settingsChange = output<InventorySettings>();

  form: FormGroup = new FormGroup({
    low_stock_threshold: new FormControl(10),
    out_of_stock_action: new FormControl('hide'),
    // Estos dos NO se dibujan en la plantilla a propósito: el backend los
    // persiste pero ningún servicio los lee, así que un interruptor visible
    // prometería un control que no existe. El texto explicativo del bloque
    // de existencias ya declara el comportamiento como política fija.
    // No atarlos a un input sin implementarlos primero en el backend.
    track_inventory: new FormControl(true),
    allow_negative_stock: new FormControl(false),
    costing_method: new FormControl('cpp'),
    pos_stock_scope: new FormControl<InventoryScope>('main_location'),
    low_stock_alerts_scope: new FormControl<InventoryScope>('main_location'),
  });

  /**
   * Signal mirror of the live form value. `FormControl.value` is a plain getter,
   * so a `computed()` reading it would evaluate once and never recompute; both
   * write paths (the `settings` effect and `onFieldChange`) refresh this signal
   * and every contextual explanation below derives from it.
   */
  private readonly currentValue = signal<InventorySettings>({ ...DEFAULTS });

  readonly outOfStockEffect = computed(
    () =>
      OUT_OF_STOCK_EFFECTS[this.currentValue().out_of_stock_action] ??
      OUT_OF_STOCK_EFFECTS.hide,
  );

  readonly costingEffect = computed(
    () => COSTING_EFFECTS[this.currentValue().costing_method] ?? COSTING_EFFECTS.cpp,
  );

  readonly posScopeEffect = computed(
    () => POS_SCOPE_EFFECTS[this.currentValue().pos_stock_scope] ?? POS_SCOPE_EFFECTS.main_location,
  );

  readonly alertScopeEffect = computed(
    () =>
      ALERT_SCOPE_EFFECTS[this.currentValue().low_stock_alerts_scope] ??
      ALERT_SCOPE_EFFECTS.main_location,
  );

  readonly isFifo = computed(() => this.currentValue().costing_method === 'fifo');

  readonly threshold = computed(() => {
    const raw = Number(this.currentValue().low_stock_threshold);
    return Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : DEFAULTS.low_stock_threshold;
  });

  readonly thresholdExample = computed(() => {
    const value = this.threshold();
    if (value === 0) {
      return 'Con 0, la alerta llega cuando el producto ya está agotado: te avisa cuando no queda nada que vender.';
    }
    return `Con ${value}, un producto que baja de ${value + 1} a ${value} unidades disponibles dispara la alerta de stock bajo.`;
  });

  outOfStockActions: SelectorOption[] = [
    { value: 'hide', label: 'Ocultar producto' },
    { value: 'show', label: 'Mostrar como agotado' },
    { value: 'disable', label: 'Deshabilitar compras' },
    { value: 'allow_backorder', label: 'Permitir pedidos pendientes' },
  ];

  costingMethods: SelectorOption[] = [
    { value: 'cpp', label: 'CPP (Costo Promedio Ponderado)' },
    { value: 'fifo', label: 'FIFO (Primero en Entrar, Primero en Salir)' },
  ];

  posStockScopes: SelectorOption[] = [
    {
      value: 'main_location',
      label: 'Solo bodega principal (recomendado)',
      description: 'El POS muestra el stock de la bodega principal.',
    },
    {
      value: 'all_locations',
      label: 'Todas las bodegas',
      description: 'El POS muestra el stock sumado de las bodegas vendibles.',
    },
  ];

  lowStockAlertsScopes: SelectorOption[] = [
    {
      value: 'main_location',
      label: 'Solo bodega principal (recomendado)',
      description: 'Las alertas evalúan únicamente el stock de la bodega principal.',
    },
    {
      value: 'all_locations',
      label: 'Todas las bodegas',
      description: 'Las alertas suman el stock de todas las bodegas vendibles.',
    },
  ];

  // Typed getters for FormControls
  get lowStockThresholdControl(): FormControl<number> {
    return this.form.get('low_stock_threshold') as FormControl<number>;
  }

  get outOfStockActionControl(): FormControl<string> {
    return this.form.get('out_of_stock_action') as FormControl<string>;
  }

  get trackInventoryControl(): FormControl<boolean> {
    return this.form.get('track_inventory') as FormControl<boolean>;
  }

  get allowNegativeStockControl(): FormControl<boolean> {
    return this.form.get('allow_negative_stock') as FormControl<boolean>;
  }

  get costingMethodControl(): FormControl<string> {
    return this.form.get('costing_method') as FormControl<string>;
  }

  get posStockScopeControl(): FormControl<InventoryScope> {
    return this.form.get('pos_stock_scope') as FormControl<InventoryScope>;
  }

  get lowStockAlertsScopeControl(): FormControl<InventoryScope> {
    return this.form.get('low_stock_alerts_scope') as FormControl<InventoryScope>;
  }

  constructor() {
    effect(() => {
      const current = this.settings();
      if (current) {
        this.form.patchValue(current, { emitEvent: false });
        this.currentValue.set({ ...DEFAULTS, ...current });
      }
    });
  }

  onSubmit() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }

  onFieldChange() {
    // Auto-save on any field change
    if (this.form.valid) {
      this.currentValue.set({ ...DEFAULTS, ...(this.form.value as InventorySettings) });
      this.settingsChange.emit(this.form.value);
    }
  }
}
