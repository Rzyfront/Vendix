// Superadmin Shipping Rates Component
import { Component, Input, Output, EventEmitter, OnInit, inject, SimpleChanges, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ShippingService } from '../../services/shipping.service';
import { ShippingZone, ShippingRate, ShippingMethod, ShippingRateType } from '../../interfaces/shipping.interface';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';

@Component({
  selector: 'app-superadmin-shipping-rates',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent, ButtonComponent, ModalComponent, InputComponent, SelectorComponent],
  template: `
    <app-modal
      [isOpen]="true"
      title="Gestionar Tarifas del Sistema"
      [subtitle]="'Configura las reglas de precio para la zona del sistema ' + zone.name"
      (closed)="close.emit()"
      size="xl"
      *ngIf="zone"
    >
      <div slot="header">
        <div class="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center border border-purple-100">
          <app-icon name="dollar-sign" size="20" class="text-purple-600"></app-icon>
        </div>
      </div>

        <div class="flex-1 overflow-hidden flex flex-col md:flex-row">
          <!-- Column 1: Rates List (40%) -->
          <div class="w-full md:w-[35%] lg:w-[40%] border-r border-[var(--color-border)] flex flex-col bg-white">
            <div class="p-4 border-b border-[var(--color-border)] flex justify-between items-center bg-gray-50/30">
               <h4 class="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-widest">Tarifas del Sistema</h4>
               <app-button (clicked)="prepareCreate()" variant="outline" size="sm" customClasses="!text-[10px] !uppercase !tracking-widest !h-7">
                 <app-icon name="plus" size="12" slot="icon" class="mr-1"></app-icon>
                 Añadir Tarifa
               </app-button>
            </div>

            <div class="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
              <div *ngIf="loading" class="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
                 <app-icon name="loader-2" size="32" [spin]="true"></app-icon>
                 <span class="text-sm font-medium italic">Obteniendo tarifas...</span>
              </div>

              <div *ngIf="!loading && rates.length === 0" class="py-20 text-center px-8 border-2 border-dashed border-gray-100 rounded-2xl mx-2">
                 <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-100">
                    <app-icon name="tag" size="24" class="text-gray-300"></app-icon>
                 </div>
                 <h5 class="text-sm font-bold text-gray-700">No hay tarifas del sistema</h5>
                 <p class="text-xs text-gray-400 mt-2">Crea reglas de envío del sistema para esta zona geográfica.</p>
              </div>

              <div *ngFor="let rate of rates"
                   (click)="selectRate(rate)"
                   [class.border-[var(--color-primary)]]="selectedRate?.id === rate.id"
                   [class.bg-[var(--color-primary)]/5]="selectedRate?.id === rate.id"
                   [class.shadow-md]="selectedRate?.id === rate.id"
                   [class.translate-x-1]="selectedRate?.id === rate.id"
                   class="p-4 rounded-2xl border border-[var(--color-border)] hover:bg-gray-50 transition-all duration-300 cursor-pointer group relative overflow-hidden">

                <div *ngIf="selectedRate?.id === rate.id" class="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-primary)]"></div>

                <div class="flex justify-between items-start mb-3">
                   <div>
                     <span class="text-[10px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded uppercase tracking-tighter mb-1 inline-block">Sistema</span>
                     <span class="text-xs font-bold text-gray-400 block uppercase tracking-tighter mb-1">{{ getMethodName(rate.shipping_method_id) }}</span>
                     <h5 class="font-bold text-[var(--color-text-primary)]">{{ rate.name || 'Tarifa del Sistema' }}</h5>
                   </div>
                   <div class="text-right">
                     <span class="text-lg font-black text-emerald-600 block">\${{ rate.base_cost | number }}</span>
                     <span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{{ rate.type.replace('_', ' ') }}</span>
                   </div>
                </div>

                <div class="flex flex-wrap items-center gap-2 text-[10px] border-t border-gray-100 pt-3 mt-3">
                   <div class="flex items-center gap-1.5 px-2 py-1 bg-gray-100 rounded-md text-gray-600 font-bold">
                      <app-icon name="list" size="10"></app-icon>
                      <span>{{ rate.min_val || 0 }} - {{ rate.max_val || '∞' }}</span>
                   </div>
                   <div *ngIf="rate.per_unit_cost" class="flex items-center gap-1.5 px-2 py-1 bg-blue-50 rounded-md text-blue-600 font-bold">
                      <app-icon name="plus-circle" size="10"></app-icon>
                      <span>+\${{ rate.per_unit_cost }}/u</span>
                   </div>
                   <div *ngIf="rate.free_shipping_threshold" class="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 rounded-md text-emerald-600 font-bold">
                      <app-icon name="sparkles" size="10"></app-icon>
                      <span>Gratis desde \${{ rate.free_shipping_threshold }}</span>
                   </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Column 2: Form (40%) -->
          <div class="w-full md:w-[35%] lg:w-[40%] flex flex-col bg-gray-50/50 border-r border-[var(--color-border)]">
            <div class="p-6 overflow-y-auto">
              <div class="flex items-center justify-between mb-8">
                <h4 class="text-lg font-black text-gray-900 flex items-center">
                   {{ selectedRate ? 'Editar Tarifa' : 'Nueva Tarifa del Sistema' }}
                   <span *ngIf="selectedRate" class="ml-3 text-[10px] font-bold bg-purple-50 px-2 py-1 rounded-lg border border-purple-200 text-purple-600 tracking-widest">REF: {{ selectedRate.id }}</span>
                </h4>
                <div *ngIf="selectedRate" class="animate-in fade-in duration-300">
                   <app-button variant="ghost" size="sm" (clicked)="deleteRate(selectedRate.id)" customClasses="!text-red-500 hover:!bg-red-50 !h-8 !px-3 !text-xs">
                     <app-icon name="trash" size="12" slot="icon" class="mr-1"></app-icon>
                     Eliminar
                   </app-button>
                </div>
              </div>

              <form [formGroup]="form" id="shippingRateForm" (ngSubmit)="onSubmit()" class="space-y-4">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <app-selector
                      label="Método de Envío"
                      formControlName="shipping_method_id"
                      [options]="methodOptions"
                      [required]="true"
                      tooltipText="Selecciona el método de envío del sistema para esta tarifa."
                    ></app-selector>
                    <app-input
                      label="Nombre Descriptivo"
                      formControlName="name"
                      placeholder="Ej: Envío Estándar del Sistema"
                      tooltipText="Un nombre interno para identificar esta regla del sistema."
                      customWrapperClass="!mt-0"
                    ></app-input>
                  </div>

                  <!-- Price Strategy Selector -->
                  <div class="space-y-3">
                    <label class="block text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-widest px-1">
                       Estrategia de Precio
                    </label>
                    <div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
                        <div *ngFor="let strategy of [
                           { type: ShippingRateType.FLAT, label: 'Fija', icon: 'tag' },
                           { type: ShippingRateType.WEIGHT_BASED, label: 'Peso', icon: 'package' },
                           { type: ShippingRateType.PRICE_BASED, label: 'Precio', icon: 'dollar-sign' },
                           { type: ShippingRateType.FREE, label: 'Gratis', icon: 'sparkles' }
                         ]"
                             (click)="form.get('type')?.setValue(strategy.type)"
                             [class.ring-2]="form.get('type')?.value === strategy.type"
                             [class.ring-[var(--color-primary)]]="form.get('type')?.value === strategy.type"
                             [class.bg-white]="form.get('type')?.value === strategy.type"
                             [class.shadow-sm]="form.get('type')?.value === strategy.type"
                             class="border rounded-2xl p-3 flex flex-col items-center justify-center cursor-pointer hover:bg-white transition-all duration-300 gap-1 text-center group">
                            <app-icon [name]="strategy.icon"
                                     size="18" [class]="form.get('type')?.value === strategy.type ? 'text-[var(--color-primary)]' : 'text-gray-400 group-hover:text-gray-600'"></app-icon>
                            <span class="text-[10px] font-bold uppercase tracking-tight" [class.text-[var(--color-primary)]]="form.get('type')?.value === strategy.type">
                              {{ strategy.label }}
                            </span>
                        </div>
                    </div>
                  </div>

                  <!-- Costs and Conditions -->
                  <div class="bg-white p-6 rounded-2xl border border-[var(--color-border)] shadow-sm space-y-6">
                     <div class="grid grid-cols-2 gap-4">
                        <app-input
                          label="Precio Base"
                          type="number"
                          formControlName="base_cost"
                          prefixText="$"
                          [required]="true"
                          tooltipText="Costo inicial que se cobrará siempre que se cumpla esta regla del sistema."
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
              </form>
            </div>

            <div class="p-4 bg-white border-t border-[var(--color-border)] mt-auto">
               <app-button variant="primary" [fullWidth]="true" [loading]="isSubmitting" [disabled]="form.invalid" (clicked)="onSubmit()">
                  <app-icon name="save" size="18" slot="icon" class="mr-2"></app-icon>
                  {{ selectedRate ? 'Actualizar Tarifa' : 'Crear Tarifa del Sistema' }}
               </app-button>
            </div>
          </div>

          <!-- Column 3: Help & Summary (20%) -->
          <div class="hidden lg:flex lg:w-[20%] flex-col bg-white overflow-y-auto">
            <div class="p-5 space-y-6">
               <div class="space-y-4">
                 <div class="flex items-center gap-2 text-purple-600">
                    <app-icon name="help-circle" size="20"></app-icon>
                    <h4 class="text-sm font-bold uppercase tracking-widest">Ayuda del Sistema</h4>
                 </div>

                 <div class="space-y-2">
                    <h5 class="text-xs font-bold text-[var(--color-text-primary)]">{{ strategyHelp.title }}</h5>
                    <p class="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                      {{ strategyHelp.description }}
                    </p>
                 </div>

                 <div class="p-3 bg-purple-50/30 rounded-xl space-y-2 border border-purple-100/50">
                    <p *ngFor="let ex of strategyHelp.examples" class="text-[10px] text-purple-700 leading-normal" [innerHTML]="ex"></p>
                 </div>
               </div>

               <div class="pt-6 border-t border-dashed border-gray-200">
                 <div class="flex items-center gap-2 text-blue-600 mb-3">
                    <app-icon name="info" size="16"></app-icon>
                    <h5 class="text-[10px] font-bold uppercase tracking-widest">Resumen Real</h5>
                 </div>
                 <p class="text-[11px] text-gray-600 leading-relaxed italic bg-blue-50/30 p-3 rounded-xl border border-blue-100/50" [innerHTML]="strategySummary"></p>
               </div>

               <div class="pt-6 space-y-3">
                  <h5 class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Nota del Sistema</h5>
                  <div class="p-3 bg-purple-50 rounded-xl border border-purple-100">
                    <p class="text-[10px] text-purple-700 leading-normal">
                      Esta tarifa del sistema estará disponible para todas las tiendas que usen esta zona de envío.
                    </p>
                  </div>
               </div>
            </div>
          </div>
        </div>
    </app-modal>
  `
})
export class ShippingRatesComponent implements OnInit, OnChanges {
  @Input() zone?: ShippingZone;
  @Input() methods: ShippingMethod[] = [];
  @Output() close = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  private shippingService = inject(ShippingService);
  private dialogService = inject(DialogService);

  ShippingRateType = ShippingRateType;
  rates: ShippingRate[] = [];
  selectedRate?: ShippingRate;
  methodOptions: SelectorOption[] = [];
  loading = false;
  isSubmitting = false;

  form: FormGroup;

  constructor() {
    this.form = this.fb.group({
      shipping_method_id: ['', Validators.required],
      name: [''],
      type: [ShippingRateType.FLAT, Validators.required],
      base_cost: [0, [Validators.required, Validators.min(0)]],
      per_unit_cost: [0],
      min_val: [null],
      max_val: [null],
      free_shipping_threshold: [null],
      is_active: [true]
    });
  }

  get minLabel(): string {
    const type = this.form.get('type')?.value;
    if (type === ShippingRateType.WEIGHT_BASED) return 'Peso Mínimo';
    if (type === ShippingRateType.PRICE_BASED) return 'Compra Mínima';
    return 'Valor Mínimo';
  }

  get maxLabel(): string {
    const type = this.form.get('type')?.value;
    if (type === ShippingRateType.WEIGHT_BASED) return 'Peso Máximo';
    if (type === ShippingRateType.PRICE_BASED) return 'Compra Máxima';
    return 'Valor Máximo';
  }

  get minTooltip(): string {
    const type = this.form.get('type')?.value;
    if (type === ShippingRateType.WEIGHT_BASED) return 'Peso inicial (en kg) desde el cual se aplica esta tarifa del sistema.';
    if (type === ShippingRateType.PRICE_BASED) return 'Monto mínimo de compra necesario para aplicar esta tarifa del sistema.';
    return 'Punto de inicio para aplicar esta tarifa del sistema.';
  }

  get maxTooltip(): string {
    const type = this.form.get('type')?.value;
    if (type === ShippingRateType.WEIGHT_BASED) return 'Peso límite (en kg) para esta tarifa. Deja vacío si no hay límite.';
    if (type === ShippingRateType.PRICE_BASED) return 'Monto máximo de compra para esta tarifa. Deja vacío si no hay límite.';
    return 'Punto final para aplicar esta tarifa del sistema.';
  }

  get variableLabel(): string {
    const type = this.form.get('type')?.value;
    if (type === ShippingRateType.WEIGHT_BASED) return 'Costo por Kg Extra';
    return 'Costo Variable';
  }

  get variableTooltip(): string {
    const type = this.form.get('type')?.value;
    if (type === ShippingRateType.WEIGHT_BASED) return 'Monto que se sumará al precio base por cada kilogramo de peso del pedido.';
    if (type === ShippingRateType.PRICE_BASED) return 'Monto adicional que se suma al precio base (opcional).';
    return 'Costo adicional por cada unidad que exceda el mínimo.';
  }

  get freeShippingTooltip(): string {
    return 'Si el total de la compra (carrito) supera este monto, el sistema ignorará los costos anteriores y aplicará Envío Gratis.';
  }

  get strategySummary(): string {
    const values = this.form.value;
    const type = values.type;
    const base = values.base_cost || 0;
    const variable = values.per_unit_cost || 0;
    const min = values.min_val;
    const max = values.max_val;
    const free = values.free_shipping_threshold;

    let text = '';

    if (type === ShippingRateType.FREE) {
      text = 'El envío será totalmente **gratuito**';
    } else {
      text = `Se cobrará un costo base de **$${base}**`;
      if (variable > 0) {
        const unit = type === ShippingRateType.WEIGHT_BASED ? 'kg' : 'unidad';
        text += ` más **$${variable}** por cada ${unit} adicional`;
      }
    }

    if (min !== null || max !== null) {
      const unit = type === ShippingRateType.WEIGHT_BASED ? 'kg' : (type === ShippingRateType.PRICE_BASED ? '$' : '');
      const minText = min !== null ? `${unit}${min}` : 'el inicio';
      const maxText = max !== null ? `${unit}${max}` : 'el infinito';
      text += `, siempre que el pedido esté entre **${minText}** y **${maxText}**`;
    }

    if (free !== null && free > 0) {
      text += `. Además, será **gratis** si la compra supera los **$${free}**`;
    }

    return text + '.';
  }

  get strategyHelp(): { title: string, description: string, examples: string[] } {
    const type = this.form.get('type')?.value;

    const helpData: Record<string, { title: string, description: string, examples: string[] }> = {
      [ShippingRateType.FLAT]: {
        title: 'Tarifa Fija del Sistema',
        description: 'Se aplica un costo único sin importar el peso o el valor del carrito. Es la opción más sencilla para entregas locales a nivel sistema.',
        examples: [
          '**Ejemplo:** Cobrar $150 fijos por envío a domicilio.',
          '**Uso:** Ideal si tienes un mensajero propio con precio pactado.'
        ]
      },
      [ShippingRateType.WEIGHT_BASED]: {
        title: 'Basada en Peso',
        description: 'El costo depende de la masa total de los productos. Permite cobrar más por paquetes voluminosos o pesados.',
        examples: [
          '**Ejemplo:** $100 base + $20 por cada kg extra.',
          '**Uso:** Recomendado si usas transportadoras que cobran por peso.'
        ]
      },
      [ShippingRateType.PRICE_BASED]: {
        title: 'Basada en Precio',
        description: 'El envío varía según cuánto gaste el cliente. Útil para incentivar compras más grandes.',
        examples: [
          '**Ejemplo:** $100 si compran menos de $500, y $50 si compran más.',
          '**Uso:** Estrategia clásica para aumentar el ticket promedio.'
        ]
      },
      [ShippingRateType.FREE]: {
        title: 'Envío Gratuito',
        description: 'Elimina el costo de envío para el cliente. Puedes restringirlo a condiciones específicas.',
        examples: [
          '**Ejemplo:** Gratis si el pedido pesa menos de 0.5kg.',
          '**Uso:** Excelente para promociones de "Envío Gratis por Hoy".'
        ]
      }
    };

    return helpData[type] || helpData[ShippingRateType.FLAT];
  }

  ngOnInit() {
    // Initial load handled by ngOnChanges
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['methods']) {
      this.methodOptions = this.methods.map(m => ({ value: m.id, label: m.name }));
    }
    if (changes['zone'] && this.zone) {
      this.loadRates();
      this.prepareCreate();
    }
  }

  loadRates() {
    if (!this.zone) return;
    this.loading = true;
    this.shippingService.getRates(this.zone.id).subscribe({
      next: (data) => {
        this.rates = data;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  getMethodName(id: number): string {
    return this.methods.find(m => m.id === id)?.name || 'Desconocido';
  }

  selectRate(rate: ShippingRate) {
    this.selectedRate = rate;
    this.form.patchValue(rate);
  }

  prepareCreate() {
    this.selectedRate = undefined;
    this.form.reset({
      type: ShippingRateType.FLAT,
      base_cost: 0,
      per_unit_cost: 0,
      is_active: true
    });
    // Set first method as default if available
    if (this.methods.length > 0) {
      this.form.patchValue({ shipping_method_id: this.methods[0].id });
    }
  }

  onSubmit() {
    if (this.form.invalid || !this.zone) return;

    this.isSubmitting = true;
    const formValue = this.form.value;

    // Convert strings to numbers for API
    const payload = {
      ...formValue,
      shipping_zone_id: this.zone.id,
      shipping_method_id: Number(formValue.shipping_method_id)
    };

    const request$ = this.selectedRate
      ? this.shippingService.updateRate(this.selectedRate.id, payload)
      : this.shippingService.createRate(payload);

    request$.subscribe({
      next: () => {
        this.isSubmitting = false;
        this.loadRates();
        this.prepareCreate();
      },
      error: () => {
        this.isSubmitting = false;
        alert('Error al guardar la tarifa del sistema');
      }
    });
  }

  deleteRate(id: number) {
    this.dialogService.confirm({
      title: 'Eliminar Tarifa del Sistema',
      message: '¿Estás seguro de que deseas eliminar esta tarifa del sistema? Esta acción no se puede deshacer.',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger'
    }).then(confirmed => {
      if (confirmed) {
        this.shippingService.deleteRate(id).subscribe(() => {
          this.loadRates();
          if (this.selectedRate?.id === id) {
            this.selectedRate = undefined;
            this.form.reset({ type: ShippingRateType.FLAT, is_active: true });
          }
        });
      }
    });
  }
}
