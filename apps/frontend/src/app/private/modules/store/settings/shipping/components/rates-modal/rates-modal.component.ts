import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  ShippingZone,
  ShippingRate,
  ShippingRateType,
  CreateRateDto,
  UpdateRateDto,
  ShippingRateMethod,
} from '../../interfaces/shipping-zones.interface';
import { ShippingMethodsService } from '../../services/shipping-methods.service';
import {
  ModalComponent,
  InputComponent,
  ToggleComponent,
  SelectorComponent,
  IconComponent,
  ButtonComponent,
  ToastService,
  DialogService,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'app-rates-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ToggleComponent,
    SelectorComponent,
    IconComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="modal_title"
      [subtitle]="'Configura las reglas de precio para la zona ' + zone.name"
      size="xl"
      (closed)="close.emit()"
    >
      <div slot="header">
        <div
          class="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center border border-purple-100"
        >
          <app-icon name="dollar-sign" size="20" class="text-purple-600"></app-icon>
        </div>
      </div>

      <div class="flex-1 overflow-hidden flex flex-col md:flex-row">
        <!-- Column 1: Rates List (35%) -->
        <div class="w-full md:w-[35%] border-r border-[var(--color-border)] flex flex-col bg-white">
          <div class="p-4 border-b border-[var(--color-border)] flex justify-between items-center bg-gray-50/30">
            <h4 class="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">
              {{ is_read_only ? 'Tarifas del Sistema' : 'Tus Tarifas' }}
            </h4>
            <app-button
              *ngIf="!is_read_only"
              (clicked)="prepareCreate()"
              variant="outline"
              size="sm"
              customClasses="!text-[10px] !uppercase !tracking-widest !h-7"
            >
              <app-icon name="plus" size="12" slot="icon" class="mr-1"></app-icon>
              Añadir Tarifa
            </app-button>
          </div>

          <div class="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            <!-- Loading -->
            <div *ngIf="is_loading_rates" class="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
              <app-icon name="loader-2" size="32" [spin]="true"></app-icon>
              <span class="text-sm font-medium italic">Obteniendo tarifas...</span>
            </div>

            <!-- Empty -->
            <div
              *ngIf="!is_loading_rates && rates.length === 0"
              class="py-20 text-center px-8 border-2 border-dashed border-gray-100 rounded-2xl mx-2"
            >
              <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-100">
                <app-icon name="tag" size="24" class="text-gray-300"></app-icon>
              </div>
              <h5 class="text-sm font-bold text-gray-700">
                {{ is_read_only ? 'Sin tarifas configuradas' : 'No hay tarifas aún' }}
              </h5>
              <p class="text-xs text-gray-400 mt-2">
                {{ is_read_only ? 'Esta zona del sistema no tiene tarifas.' : 'Crea reglas de envío para esta zona.' }}
              </p>
            </div>

            <!-- Rich Rate Cards -->
            <div
              *ngFor="let rate of rates"
              (click)="selectRate(rate)"
              [class.border-[var(--color-primary)]]="selectedRate?.id === rate.id"
              [class.bg-[var(--color-primary)]/5]="selectedRate?.id === rate.id"
              [class.shadow-md]="selectedRate?.id === rate.id"
              [class.translate-x-1]="selectedRate?.id === rate.id"
              class="p-4 rounded-2xl border border-[var(--color-border)] hover:bg-gray-50 transition-all duration-300 cursor-pointer group relative overflow-hidden"
            >
              <!-- Left accent bar -->
              <div *ngIf="selectedRate?.id === rate.id" class="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-primary)]"></div>

              <div class="flex justify-between items-start mb-3">
                <div>
                  <span
                    *ngIf="rate.source_type === 'system_copy'"
                    class="text-[10px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded uppercase tracking-tighter mb-1 inline-block"
                  >Sistema</span>
                  <span class="text-xs font-bold text-gray-400 block uppercase tracking-tighter mb-1">
                    {{ rate.shipping_method?.name || 'Método' }}
                  </span>
                  <h5 class="font-bold text-[var(--color-text-primary)]">
                    {{ rate.name || 'Tarifa de Envío' }}
                  </h5>
                </div>
                <div class="text-right">
                  <span class="text-lg font-black text-emerald-600 block">
                    \${{ rate.base_cost | number }}
                  </span>
                  <span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    {{ getRateTypeLabel(rate.type) }}
                  </span>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2 text-[10px] border-t border-gray-100 pt-3 mt-3">
                <div class="flex items-center gap-1.5 px-2 py-1 bg-gray-100 rounded-md text-gray-600 font-bold">
                  <app-icon name="list" size="10"></app-icon>
                  <span>{{ rate.min_val || 0 }} - {{ rate.max_val || '∞' }}</span>
                </div>
                <div
                  *ngIf="rate.per_unit_cost"
                  class="flex items-center gap-1.5 px-2 py-1 bg-blue-50 rounded-md text-blue-600 font-bold"
                >
                  <app-icon name="plus-circle" size="10"></app-icon>
                  <span>+\${{ rate.per_unit_cost }}/u</span>
                </div>
                <div
                  *ngIf="rate.free_shipping_threshold"
                  class="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 rounded-md text-emerald-600 font-bold"
                >
                  <app-icon name="sparkles" size="10"></app-icon>
                  <span>Gratis desde \${{ rate.free_shipping_threshold }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Column 2: Form / Read-only Detail (40%) -->
        <div class="w-full md:w-[40%] flex flex-col bg-gray-50/50 border-r border-[var(--color-border)]">
          <!-- Read-only view -->
          <ng-container *ngIf="is_read_only">
            <div *ngIf="selectedRate" class="p-6 overflow-y-auto">
              <h4 class="text-lg font-black text-gray-900 mb-6 flex items-center">
                Detalles de Tarifa
                <span class="ml-3 text-[10px] font-bold bg-purple-50 px-2 py-1 rounded-lg border border-purple-200 text-purple-600 tracking-widest">
                  REF: {{ selectedRate.id }}
                </span>
              </h4>

              <div class="bg-white p-6 rounded-2xl border border-[var(--color-border)] shadow-sm space-y-5">
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Método</label>
                    <p class="font-bold text-[var(--color-text-primary)]">{{ selectedRate.shipping_method?.name || '-' }}</p>
                  </div>
                  <div>
                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Estrategia</label>
                    <p class="font-bold text-[var(--color-text-primary)]">{{ getRateTypeLabel(selectedRate.type || '') }}</p>
                  </div>
                  <div>
                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Costo Base</label>
                    <p class="font-black text-emerald-600 text-lg">\${{ selectedRate.base_cost | number }}</p>
                  </div>
                  <div *ngIf="selectedRate.per_unit_cost">
                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Costo Variable</label>
                    <p class="font-bold text-[var(--color-text-primary)]">\${{ selectedRate.per_unit_cost | number }}</p>
                  </div>
                  <div *ngIf="selectedRate.min_val !== null && selectedRate.min_val !== undefined">
                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Mínimo</label>
                    <p class="font-bold text-[var(--color-text-primary)]">{{ selectedRate.min_val }}</p>
                  </div>
                  <div *ngIf="selectedRate.max_val !== null && selectedRate.max_val !== undefined">
                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Máximo</label>
                    <p class="font-bold text-[var(--color-text-primary)]">{{ selectedRate.max_val }}</p>
                  </div>
                  <div *ngIf="selectedRate.free_shipping_threshold">
                    <label class="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Envío Gratis Desde</label>
                    <p class="font-bold text-emerald-600">\${{ selectedRate.free_shipping_threshold | number }}</p>
                  </div>
                </div>
              </div>
            </div>

            <div *ngIf="!selectedRate" class="flex flex-col items-center justify-center h-full text-center p-6">
              <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-100">
                <app-icon name="eye" size="24" class="text-gray-300"></app-icon>
              </div>
              <p class="font-bold text-gray-700">Selecciona una tarifa</p>
              <p class="text-xs text-gray-400 mt-1">Haz clic en una tarifa para ver sus detalles</p>
            </div>
          </ng-container>

          <!-- Editable form -->
          <ng-container *ngIf="!is_read_only">
            <div class="p-6 overflow-y-auto flex-1">
              <div class="flex items-center justify-between mb-8">
                <h4 class="text-lg font-black text-gray-900 flex items-center">
                  {{ selectedRate ? 'Editar Tarifa' : 'Nueva Tarifa' }}
                  <span
                    *ngIf="selectedRate"
                    class="ml-3 text-[10px] font-bold bg-purple-50 px-2 py-1 rounded-lg border border-purple-200 text-purple-600 tracking-widest"
                  >REF: {{ selectedRate.id }}</span>
                </h4>
                <div *ngIf="selectedRate" class="animate-in fade-in duration-300">
                  <app-button
                    variant="ghost"
                    size="sm"
                    (clicked)="onDeleteRate(selectedRate)"
                    customClasses="!text-red-500 hover:!bg-red-50 !h-8 !px-3 !text-xs"
                  >
                    <app-icon name="trash" size="12" slot="icon" class="mr-1"></app-icon>
                    Eliminar
                  </app-button>
                </div>
              </div>

              <form [formGroup]="form" id="rateForm" (ngSubmit)="onSubmitRate()" class="space-y-4">
                <!-- Method + Name row -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <app-selector
                    label="Método de Envío"
                    formControlName="shipping_method_id"
                    [options]="shipping_method_options"
                    [required]="true"
                    tooltipText="Selecciona el método de envío para esta tarifa."
                  ></app-selector>
                  <app-input
                    label="Nombre Descriptivo"
                    formControlName="name"
                    placeholder="Ej: Envío express zona norte"
                    tooltipText="Un nombre para identificar esta tarifa fácilmente."
                    customWrapperClass="!mt-0"
                  ></app-input>
                </div>

                <!-- Strategy selector -->
                <div class="space-y-3">
                  <label class="block text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-widest px-1">
                    Estrategia de Precio
                  </label>
                  <div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <div
                      *ngFor="let strategy of rate_strategies"
                      (click)="selectRateType(strategy.value)"
                      [class.ring-2]="form.get('type')?.value === strategy.value"
                      [class.ring-[var(--color-primary)]]="form.get('type')?.value === strategy.value"
                      [class.bg-white]="form.get('type')?.value === strategy.value"
                      [class.shadow-sm]="form.get('type')?.value === strategy.value"
                      class="border rounded-2xl p-3 flex flex-col items-center justify-center cursor-pointer hover:bg-white transition-all duration-300 gap-1 text-center group"
                    >
                      <app-icon
                        [name]="strategy.icon"
                        size="18"
                        [class]="form.get('type')?.value === strategy.value ? 'text-[var(--color-primary)]' : 'text-gray-400 group-hover:text-gray-600'"
                      ></app-icon>
                      <span
                        class="text-[10px] font-bold uppercase tracking-tight"
                        [class.text-[var(--color-primary)]]="form.get('type')?.value === strategy.value"
                      >
                        {{ strategy.label }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Costs card -->
                <div class="bg-white p-6 rounded-2xl border border-[var(--color-border)] shadow-sm space-y-6">
                  <div class="grid grid-cols-2 gap-4">
                    <app-input
                      label="Precio Base"
                      type="number"
                      formControlName="base_cost"
                      prefixText="$"
                      [required]="true"
                      tooltipText="Costo inicial que se cobrará siempre que se cumpla esta regla."
                    ></app-input>
                    <app-input
                      [label]="variableLabel"
                      type="number"
                      formControlName="per_unit_cost"
                      prefixText="$"
                      [tooltipText]="variableTooltip"
                    ></app-input>
                  </div>

                  <div class="grid grid-cols-2 gap-4">
                    <app-input
                      [label]="minLabel"
                      type="number"
                      formControlName="min_val"
                      placeholder="0"
                      [tooltipText]="minTooltip"
                    ></app-input>
                    <app-input
                      [label]="maxLabel"
                      type="number"
                      formControlName="max_val"
                      placeholder="Sin límite"
                      [tooltipText]="maxTooltip"
                    ></app-input>
                  </div>

                  <app-input
                    label="Envío Gratis Desde"
                    type="number"
                    formControlName="free_shipping_threshold"
                    placeholder="Dejar vacío si no aplica"
                    prefixText="$"
                    [tooltipText]="freeShippingTooltip"
                  ></app-input>
                </div>

                <!-- Active toggle -->
                <div class="flex items-center justify-between pt-2">
                  <div>
                    <p class="font-medium">Tarifa activa</p>
                    <p class="text-sm text-muted-foreground">
                      Solo las tarifas activas se usan para calcular envíos
                    </p>
                  </div>
                  <app-toggle formControlName="is_active"></app-toggle>
                </div>
              </form>
            </div>

            <!-- Submit button at bottom of column 2 -->
            <div class="p-4 bg-white border-t border-[var(--color-border)] mt-auto">
              <app-button
                variant="primary"
                [fullWidth]="true"
                [loading]="is_saving"
                [disabled]="form.invalid"
                (clicked)="onSubmitRate()"
              >
                <app-icon name="save" size="18" slot="icon" class="mr-2"></app-icon>
                {{ selectedRate ? 'Actualizar Tarifa' : 'Crear Tarifa' }}
              </app-button>
            </div>
          </ng-container>
        </div>

        <!-- Column 3: Help & Summary (25%, desktop only) -->
        <div class="hidden lg:flex lg:w-[25%] flex-col bg-white overflow-y-auto">
          <div class="p-5 space-y-6">
            <!-- Strategy Help -->
            <div class="space-y-4">
              <div class="flex items-center gap-2 text-purple-600">
                <app-icon name="help-circle" size="20"></app-icon>
                <h4 class="text-sm font-bold uppercase tracking-widest">Ayuda</h4>
              </div>

              <div class="space-y-2">
                <h5 class="text-xs font-bold text-[var(--color-text-primary)]">{{ strategyHelp.title }}</h5>
                <p class="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                  {{ strategyHelp.description }}
                </p>
              </div>

              <div class="p-3 bg-purple-50/30 rounded-xl space-y-2 border border-purple-100/50">
                <p
                  *ngFor="let ex of strategyHelp.examples"
                  class="text-[10px] text-purple-700 leading-normal"
                  [innerHTML]="ex"
                ></p>
              </div>
            </div>

            <!-- Real-time Summary (only when editing) -->
            <ng-container *ngIf="!is_read_only">
              <div class="pt-6 border-t border-dashed border-gray-200">
                <div class="flex items-center gap-2 text-blue-600 mb-3">
                  <app-icon name="info" size="16"></app-icon>
                  <h5 class="text-[10px] font-bold uppercase tracking-widest">Resumen en Tiempo Real</h5>
                </div>
                <p
                  class="text-[11px] text-gray-600 leading-relaxed italic bg-blue-50/30 p-3 rounded-xl border border-blue-100/50"
                  [innerHTML]="strategySummary"
                ></p>
              </div>
            </ng-container>

            <!-- Store Note -->
            <div class="pt-6 space-y-3">
              <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                {{ is_read_only ? 'Nota del Sistema' : 'Nota' }}
              </h5>
              <div class="p-3 bg-purple-50 rounded-xl border border-purple-100">
                <p class="text-[10px] text-purple-700 leading-normal">
                  {{ is_read_only
                    ? 'Esta tarifa del sistema está configurada globalmente y aplica a todas las tiendas de esta zona.'
                    : 'Esta tarifa se aplicará a los pedidos de tu tienda que correspondan a esta zona de envío.'
                  }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </app-modal>
  `,
})
export class RatesModalComponent implements OnInit, OnChanges {
  @Input() zone!: ShippingZone;
  @Input() is_read_only = false;
  @Output() close = new EventEmitter<void>();
  @Output() rates_changed = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  private shippingService = inject(ShippingMethodsService);
  private toast = inject(ToastService);
  private dialogService = inject(DialogService);

  rates: ShippingRate[] = [];
  selectedRate?: ShippingRate;
  is_loading_rates = false;
  is_saving = false;
  shipping_methods: ShippingRateMethod[] = [];

  form: FormGroup;

  rate_strategies: { value: ShippingRateType; label: string; icon: string }[] = [
    { value: 'flat', label: 'Fija', icon: 'tag' },
    { value: 'weight_based', label: 'Peso', icon: 'package' },
    { value: 'price_based', label: 'Precio', icon: 'dollar-sign' },
    { value: 'free', label: 'Gratis', icon: 'sparkles' },
  ];

  // ─── Computed getters ───

  get modal_title(): string {
    if (!this.zone) return 'Tarifas de Envío';
    return `Tarifas: ${this.zone.name}`;
  }

  get shipping_method_options(): { value: any; label: string }[] {
    return this.shipping_methods.map((m) => ({
      value: m.id,
      label: m.name,
    }));
  }

  get minLabel(): string {
    const type = this.form.get('type')?.value;
    if (type === 'weight_based') return 'Peso Mínimo';
    if (type === 'price_based') return 'Compra Mínima';
    return 'Valor Mínimo';
  }

  get maxLabel(): string {
    const type = this.form.get('type')?.value;
    if (type === 'weight_based') return 'Peso Máximo';
    if (type === 'price_based') return 'Compra Máxima';
    return 'Valor Máximo';
  }

  get minTooltip(): string {
    const type = this.form.get('type')?.value;
    if (type === 'weight_based') return 'Peso inicial (en kg) desde el cual se aplica esta tarifa.';
    if (type === 'price_based') return 'Monto mínimo de compra necesario para aplicar esta tarifa.';
    return 'Punto de inicio para aplicar esta tarifa.';
  }

  get maxTooltip(): string {
    const type = this.form.get('type')?.value;
    if (type === 'weight_based') return 'Peso límite (en kg) para esta tarifa. Deja vacío si no hay límite.';
    if (type === 'price_based') return 'Monto máximo de compra para esta tarifa. Deja vacío si no hay límite.';
    return 'Punto final para aplicar esta tarifa.';
  }

  get variableLabel(): string {
    const type = this.form.get('type')?.value;
    if (type === 'weight_based') return 'Costo por Kg Extra';
    return 'Costo Variable';
  }

  get variableTooltip(): string {
    const type = this.form.get('type')?.value;
    if (type === 'weight_based') return 'Monto que se sumará al precio base por cada kilogramo de peso del pedido.';
    if (type === 'price_based') return 'Monto adicional que se suma al precio base (opcional).';
    return 'Costo adicional por cada unidad que exceda el mínimo.';
  }

  get freeShippingTooltip(): string {
    return 'Si el total de la compra supera este monto, se ignorarán los costos anteriores y el envío será gratis.';
  }

  get strategySummary(): string {
    const values = this.form.value;
    const type = values.type as ShippingRateType;
    const base = values.base_cost || 0;
    const variable = values.per_unit_cost || 0;
    const min = values.min_val;
    const max = values.max_val;
    const free = values.free_shipping_threshold;

    let text = '';

    if (type === 'free') {
      text = 'El envío será totalmente **gratuito**';
    } else {
      text = `Se cobrará un costo base de **$${base}**`;
      if (variable > 0) {
        const unit = type === 'weight_based' ? 'kg' : 'unidad';
        text += ` más **$${variable}** por cada ${unit} adicional`;
      }
    }

    if (min !== null || max !== null) {
      const unit = type === 'weight_based' ? 'kg' : (type === 'price_based' ? '$' : '');
      const minText = min !== null ? `${unit}${min}` : 'el inicio';
      const maxText = max !== null ? `${unit}${max}` : 'el infinito';
      text += `, siempre que el pedido esté entre **${minText}** y **${maxText}**`;
    }

    if (free !== null && free > 0) {
      text += `. Además, será **gratis** si la compra supera los **$${free}**`;
    }

    return text + '.';
  }

  get strategyHelp(): { title: string; description: string; examples: string[] } {
    const type = this.form.get('type')?.value as ShippingRateType;

    const helpData: Record<string, { title: string; description: string; examples: string[] }> = {
      flat: {
        title: 'Tarifa Fija',
        description: 'Se aplica un costo único sin importar el peso o el valor del carrito. Es la opción más sencilla para entregas locales.',
        examples: [
          '**Ejemplo:** Cobrar $150 fijos por envío a domicilio.',
          '**Uso:** Ideal si tienes un mensajero propio con precio pactado.',
        ],
      },
      weight_based: {
        title: 'Basada en Peso',
        description: 'El costo depende de la masa total de los productos. Permite cobrar más por paquetes voluminosos o pesados.',
        examples: [
          '**Ejemplo:** $100 base + $20 por cada kg extra.',
          '**Uso:** Recomendado si usas transportadoras que cobran por peso.',
        ],
      },
      price_based: {
        title: 'Basada en Precio',
        description: 'El envío varía según cuánto gaste el cliente. Útil para incentivar compras más grandes.',
        examples: [
          '**Ejemplo:** $100 si compran menos de $500, y $50 si compran más.',
          '**Uso:** Estrategia clásica para aumentar el ticket promedio.',
        ],
      },
      free: {
        title: 'Envío Gratuito',
        description: 'Elimina el costo de envío para el cliente. Puedes restringirlo a condiciones específicas.',
        examples: [
          '**Ejemplo:** Gratis si el pedido pesa menos de 0.5kg.',
          '**Uso:** Excelente para promociones de "Envío Gratis por Hoy".',
        ],
      },
    };

    return helpData[type] || helpData['flat'];
  }

  // ─── Constructor ───

  constructor() {
    this.form = this.fb.group({
      shipping_method_id: [null, Validators.required],
      name: [''],
      type: ['flat' as ShippingRateType, Validators.required],
      base_cost: [0, [Validators.required, Validators.min(0)]],
      per_unit_cost: [0],
      min_val: [null],
      max_val: [null],
      free_shipping_threshold: [null],
      is_active: [true],
    });
  }

  // ─── Lifecycle ───

  ngOnInit(): void {
    this.loadShippingMethods();
    this.loadRates();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['zone'] && this.zone && !changes['zone'].firstChange) {
      this.loadRates();
      if (!this.is_read_only) {
        this.prepareCreate();
      }
    }
  }

  // ─── Data loading ───

  private loadShippingMethods(): void {
    this.shippingService.getAvailableMethodsForRates().subscribe({
      next: (methods) => {
        this.shipping_methods = methods;
        // Auto-prepare create form after methods load (only for editable mode)
        if (!this.is_read_only && !this.selectedRate) {
          this.prepareCreate();
        }
      },
      error: () => this.toast.error('Error al cargar métodos de envío'),
    });
  }

  loadRates(): void {
    if (!this.zone) return;

    this.is_loading_rates = true;
    this.selectedRate = undefined;

    const fetch$ = this.is_read_only
      ? this.shippingService.getSystemZoneRates(this.zone.id)
      : this.shippingService.getStoreZoneRates(this.zone.id);

    fetch$.subscribe({
      next: (rates) => {
        this.rates = rates;
        this.is_loading_rates = false;
      },
      error: () => {
        this.toast.error('Error al cargar tarifas');
        this.is_loading_rates = false;
      },
    });
  }

  // ─── Rate selection & form ───

  selectRate(rate: ShippingRate): void {
    this.selectedRate = rate;
    if (!this.is_read_only) {
      this.populateForm(rate);
    }
  }

  private populateForm(rate: ShippingRate): void {
    this.form.patchValue({
      shipping_method_id: rate.shipping_method_id,
      name: rate.name || '',
      type: rate.type,
      base_cost: rate.base_cost,
      per_unit_cost: rate.per_unit_cost ?? 0,
      min_val: rate.min_val,
      max_val: rate.max_val,
      free_shipping_threshold: rate.free_shipping_threshold,
      is_active: rate.is_active,
    });
  }

  prepareCreate(): void {
    this.selectedRate = undefined;
    this.form.reset({
      shipping_method_id: this.shipping_methods.length > 0 ? this.shipping_methods[0].id : null,
      name: '',
      type: 'flat',
      base_cost: 0,
      per_unit_cost: 0,
      min_val: null,
      max_val: null,
      free_shipping_threshold: null,
      is_active: true,
    });
  }

  selectRateType(type: ShippingRateType): void {
    this.form.patchValue({ type });
    if (type === 'free') {
      this.form.patchValue({
        base_cost: 0,
        per_unit_cost: null,
        min_val: null,
        max_val: null,
        free_shipping_threshold: null,
      });
    }
  }

  // ─── Submit ───

  onSubmitRate(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (!this.zone) return;

    this.is_saving = true;
    const values = this.form.value;

    if (!this.selectedRate) {
      // Create
      const dto: CreateRateDto = {
        shipping_zone_id: this.zone.id,
        shipping_method_id: values.shipping_method_id,
        name: values.name || undefined,
        type: values.type,
        base_cost: values.base_cost,
        per_unit_cost: values.per_unit_cost,
        min_val: values.min_val,
        max_val: values.max_val,
        free_shipping_threshold: values.free_shipping_threshold,
        is_active: values.is_active,
      };

      this.shippingService.createRate(dto).subscribe({
        next: () => {
          this.toast.success('Tarifa creada correctamente');
          this.loadRates();
          this.prepareCreate();
          this.rates_changed.emit();
          this.is_saving = false;
        },
        error: (err) => {
          this.toast.error('Error al crear tarifa: ' + err.message);
          this.is_saving = false;
        },
      });
    } else {
      // Update
      const dto: UpdateRateDto = {
        shipping_method_id: values.shipping_method_id,
        name: values.name || undefined,
        type: values.type,
        base_cost: values.base_cost,
        per_unit_cost: values.per_unit_cost,
        min_val: values.min_val,
        max_val: values.max_val,
        free_shipping_threshold: values.free_shipping_threshold,
        is_active: values.is_active,
      };

      this.shippingService.updateRate(this.selectedRate.id, dto).subscribe({
        next: () => {
          this.toast.success('Tarifa actualizada correctamente');
          this.loadRates();
          this.prepareCreate();
          this.rates_changed.emit();
          this.is_saving = false;
        },
        error: (err) => {
          this.toast.error('Error al actualizar tarifa: ' + err.message);
          this.is_saving = false;
        },
      });
    }
  }

  // ─── Delete with DialogService ───

  onDeleteRate(rate: ShippingRate, event?: Event): void {
    event?.stopPropagation();

    this.dialogService
      .confirm({
        title: 'Eliminar Tarifa',
        message: '¿Estás seguro de que deseas eliminar esta tarifa? Esta acción no se puede deshacer.',
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.shippingService.deleteRate(rate.id).subscribe({
            next: () => {
              this.toast.success('Tarifa eliminada');
              this.loadRates();
              if (this.selectedRate?.id === rate.id) {
                this.prepareCreate();
              }
              this.rates_changed.emit();
            },
            error: (err) => {
              this.toast.error('Error al eliminar: ' + err.message);
            },
          });
        }
      });
  }

  // ─── Helpers ───

  getFormError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Requerido';
      if (control.errors['min']) return 'Debe ser mayor o igual a 0';
    }
    return '';
  }

  getRateTypeLabel(type: string): string {
    return this.shippingService.getZoneRateTypeLabel(type);
  }
}
