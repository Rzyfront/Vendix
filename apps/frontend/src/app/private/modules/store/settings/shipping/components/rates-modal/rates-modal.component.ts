import {
  Component,
  input,
  output,
  signal,
  computed,
  OnInit,
  OnChanges,
  SimpleChanges,
  OnDestroy,
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
  BadgeComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { Subject, takeUntil } from 'rxjs';

interface RateTypeOption {
  value: ShippingRateType;
  label: string;
  description: string;
  icon: string;
}

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
    BadgeComponent,
  ],
  template: `
    <app-modal
      [isOpen]="is_open()"
      [title]="modal_title()"
      size="xl"
      (close)="onClose()"
    >
      <div class="flex flex-col lg:flex-row gap-6 min-h-[400px]">
        <!-- Left: Rates list -->
        <div class="lg:w-2/5 flex flex-col border-r-0 lg:border-r pr-0 lg:pr-6">
          <div class="flex items-center justify-between mb-4">
            <h4 class="font-medium">Tarifas configuradas</h4>
            @if (!is_read_only()) {
              <button
                type="button"
                class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
                (click)="onAddRate()"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Agregar
              </button>
            }
          </div>

          @if (is_loading_rates()) {
            <div class="flex items-center justify-center py-8">
              <div class="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"></div>
            </div>
          } @else if (rates().length === 0) {
            <div class="flex flex-col items-center justify-center py-8 text-center">
              <div class="rounded-full bg-muted p-3 mb-3">
                <app-icon name="tag" class="h-5 w-5 text-muted-foreground" />
              </div>
              <p class="text-sm text-muted-foreground">
                {{ is_read_only() ? 'Sin tarifas configuradas' : 'Agrega tu primera tarifa' }}
              </p>
            </div>
          } @else {
            <div class="space-y-2 overflow-y-auto flex-1">
              @for (rate of rates(); track rate.id) {
                <div
                  class="p-3 rounded-lg border cursor-pointer transition-colors"
                  [class.border-primary]="selected_rate()?.id === rate.id"
                  [class.bg-primary/5]="selected_rate()?.id === rate.id"
                  [class.hover:bg-muted/50]="selected_rate()?.id !== rate.id"
                  (click)="selectRate(rate)"
                >
                  <div class="flex items-start justify-between">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-medium truncate">
                          {{ rate.name || rate.shipping_method?.name || 'Tarifa' }}
                        </span>
                        <app-badge
                          [variant]="rate.is_active ? 'success' : 'neutral'"
                          size="sm"
                        >
                          {{ rate.is_active ? 'Activa' : 'Inactiva' }}
                        </app-badge>
                      </div>
                      <div class="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                        <span>{{ getRateTypeLabel(rate.type) }}</span>
                        <span>•</span>
                        <span>{{ formatCost(rate.base_cost) }}</span>
                      </div>
                    </div>
                    @if (!is_read_only()) {
                      <button
                        type="button"
                        class="inline-flex items-center p-1.5 rounded-md text-destructive hover:bg-red-50 transition-colors shrink-0"
                        (click)="onDeleteRate(rate, $event)"
                      >
                        <app-icon name="trash-2" class="h-4 w-4" />
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- Right: Form -->
        <div class="lg:w-3/5">
          @if (is_read_only()) {
            <!-- Read-only view for system zones -->
            @if (selected_rate()) {
              <div class="space-y-4">
                <h4 class="font-medium mb-4">Detalles de tarifa</h4>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="text-sm text-muted-foreground">Método</label>
                    <p class="font-medium">{{ selected_rate()?.shipping_method?.name || '-' }}</p>
                  </div>
                  <div>
                    <label class="text-sm text-muted-foreground">Tipo</label>
                    <p class="font-medium">{{ getRateTypeLabel(selected_rate()?.type || '') }}</p>
                  </div>
                  <div>
                    <label class="text-sm text-muted-foreground">Costo base</label>
                    <p class="font-medium">{{ formatCost(selected_rate()?.base_cost || 0) }}</p>
                  </div>
                  @if (selected_rate()?.per_unit_cost) {
                    <div>
                      <label class="text-sm text-muted-foreground">Costo por unidad</label>
                      <p class="font-medium">{{ formatCost(selected_rate()?.per_unit_cost || 0) }}</p>
                    </div>
                  }
                  @if (selected_rate()?.free_shipping_threshold) {
                    <div>
                      <label class="text-sm text-muted-foreground">Envío gratis desde</label>
                      <p class="font-medium">{{ formatCost(selected_rate()?.free_shipping_threshold || 0) }}</p>
                    </div>
                  }
                </div>
              </div>
            } @else {
              <div class="flex flex-col items-center justify-center h-full text-center">
                <p class="text-muted-foreground">Selecciona una tarifa para ver sus detalles</p>
              </div>
            }
          } @else {
            <!-- Edit form for store zones -->
            @if (form_mode() === 'none') {
              <div class="flex flex-col items-center justify-center h-full text-center">
                <div class="rounded-full bg-muted p-4 mb-4">
                  <app-icon name="edit" class="h-6 w-6 text-muted-foreground" />
                </div>
                <p class="font-medium">Gestiona tus tarifas</p>
                <p class="text-sm text-muted-foreground mt-1">
                  Selecciona una tarifa para editarla o crea una nueva
                </p>
              </div>
            } @else {
              <form [formGroup]="form" (ngSubmit)="onSubmitRate()">
                <h4 class="font-medium mb-4">
                  {{ form_mode() === 'create' ? 'Nueva tarifa' : 'Editar tarifa' }}
                </h4>

                <div class="space-y-4">
                  <!-- Shipping Method -->
                  <div>
                    <label class="text-sm font-medium mb-2 block">Método de envío</label>
                    <app-selector
                      [options]="shipping_method_options()"
                      formControlName="shipping_method_id"
                      placeholder="Selecciona un método"
                    />
                    @if (getFormError('shipping_method_id')) {
                      <p class="text-sm text-destructive mt-1">{{ getFormError('shipping_method_id') }}</p>
                    }
                  </div>

                  <!-- Name -->
                  <app-input
                    label="Nombre de la tarifa (opcional)"
                    placeholder="ej: Envío express zona norte"
                    formControlName="name"
                  />

                  <!-- Rate Type -->
                  <div>
                    <label class="text-sm font-medium mb-2 block">Tipo de tarifa</label>
                    <div class="grid grid-cols-2 gap-2">
                      @for (type of rate_types; track type.value) {
                        <button
                          type="button"
                          class="flex items-start gap-2 p-3 rounded-lg border text-left text-sm transition-colors"
                          [class.border-primary]="form.get('type')?.value === type.value"
                          [class.bg-primary/5]="form.get('type')?.value === type.value"
                          (click)="selectRateType(type.value)"
                        >
                          <app-icon [name]="type.icon" class="h-4 w-4 mt-0.5 shrink-0" />
                          <div>
                            <p class="font-medium">{{ type.label }}</p>
                            <p class="text-xs text-muted-foreground">{{ type.description }}</p>
                          </div>
                        </button>
                      }
                    </div>
                  </div>

                  <!-- Costs based on type -->
                  @if (form.get('type')?.value !== 'free') {
                    <div class="grid grid-cols-2 gap-4">
                      <app-input
                        label="Costo base"
                        type="number"
                        placeholder="0.00"
                        formControlName="base_cost"
                        [error]="getFormError('base_cost')"
                      />

                      @if (form.get('type')?.value === 'weight_based' || form.get('type')?.value === 'price_based') {
                        <app-input
                          [label]="form.get('type')?.value === 'weight_based' ? 'Costo por kg' : 'Costo por unidad'"
                          type="number"
                          placeholder="0.00"
                          formControlName="per_unit_cost"
                        />
                      }
                    </div>

                    <!-- Min/Max values for weight or price based -->
                    @if (form.get('type')?.value === 'weight_based' || form.get('type')?.value === 'price_based') {
                      <div class="grid grid-cols-2 gap-4">
                        <app-input
                          [label]="form.get('type')?.value === 'weight_based' ? 'Peso mínimo (kg)' : 'Monto mínimo'"
                          type="number"
                          placeholder="0"
                          formControlName="min_val"
                        />
                        <app-input
                          [label]="form.get('type')?.value === 'weight_based' ? 'Peso máximo (kg)' : 'Monto máximo'"
                          type="number"
                          placeholder="Sin límite"
                          formControlName="max_val"
                        />
                      </div>
                    }
                  }

                  <!-- Free shipping threshold -->
                  @if (form.get('type')?.value !== 'free') {
                    <app-input
                      label="Envío gratis desde (opcional)"
                      type="number"
                      placeholder="ej: 2000"
                      formControlName="free_shipping_threshold"
                      hint="Si el pedido supera este monto, el envío será gratis"
                    />
                  }

                  <!-- Is Active -->
                  <div class="flex items-center justify-between pt-2">
                    <div>
                      <p class="font-medium">Tarifa activa</p>
                      <p class="text-sm text-muted-foreground">
                        Solo las tarifas activas se usan para calcular envíos
                      </p>
                    </div>
                    <app-toggle formControlName="is_active" />
                  </div>
                </div>

                <!-- Form actions -->
                <div class="flex justify-end gap-3 mt-6 pt-4 border-t">
                  <button
                    type="button"
                    class="px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
                    (click)="cancelForm()"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    [disabled]="is_saving() || form.invalid"
                  >
                    @if (is_saving()) {
                      <div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                      Guardando...
                    } @else {
                      {{ form_mode() === 'create' ? 'Crear' : 'Guardar' }}
                    }
                  </button>
                </div>
              </form>
            }
          }
        </div>
      </div>

      <!-- Footer for modal close -->
      @if (is_read_only()) {
        <div class="flex justify-end mt-6 pt-4 border-t">
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
            (click)="onClose()"
          >
            Cerrar
          </button>
        </div>
      }
    </app-modal>
  `,
})
export class RatesModalComponent implements OnInit, OnChanges, OnDestroy {
  private destroy$ = new Subject<void>();

  // Inputs
  readonly is_open = input<boolean>(false);
  readonly zone = input<ShippingZone | null>(null);
  readonly is_read_only = input<boolean>(false);

  // Outputs
  readonly close = output<void>();
  readonly rates_changed = output<void>();

  // State
  readonly rates = signal<ShippingRate[]>([]);
  readonly selected_rate = signal<ShippingRate | null>(null);
  readonly form_mode = signal<'none' | 'create' | 'edit'>('none');
  readonly is_loading_rates = signal(false);
  readonly is_saving = signal(false);
  readonly shipping_methods = signal<ShippingRateMethod[]>([]);

  // Form
  form: FormGroup;

  // Rate type options
  rate_types: RateTypeOption[] = [
    {
      value: 'flat',
      label: 'Tarifa fija',
      description: 'Mismo precio para todos',
      icon: 'tag',
    },
    {
      value: 'weight_based',
      label: 'Por peso',
      description: 'Según el peso del pedido',
      icon: 'scale',
    },
    {
      value: 'price_based',
      label: 'Por precio',
      description: 'Según el monto del pedido',
      icon: 'dollar-sign',
    },
    {
      value: 'free',
      label: 'Gratis',
      description: 'Sin costo de envío',
      icon: 'gift',
    },
  ];

  // Computed
  readonly modal_title = computed(() => {
    const z = this.zone();
    if (!z) return 'Tarifas de Envío';
    return `Tarifas: ${z.name}`;
  });

  readonly shipping_method_options = computed(() => {
    return this.shipping_methods().map((m) => ({
      value: m.id,
      label: m.name,
    }));
  });

  constructor(
    private fb: FormBuilder,
    private shipping_service: ShippingMethodsService,
    private toast: ToastService
  ) {
    this.form = this.createForm();
  }

  ngOnInit(): void {
    this.loadShippingMethods();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['is_open'] && this.is_open()) {
      this.loadRates();
    }
  }

  private createForm(): FormGroup {
    return this.fb.group({
      shipping_method_id: [null, Validators.required],
      name: [''],
      type: ['flat' as ShippingRateType, Validators.required],
      base_cost: [0, [Validators.required, Validators.min(0)]],
      per_unit_cost: [null],
      min_val: [null],
      max_val: [null],
      free_shipping_threshold: [null],
      is_active: [true],
    });
  }

  private loadShippingMethods(): void {
    this.shipping_service
      .getAvailableMethodsForRates()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (methods) => this.shipping_methods.set(methods),
        error: () => this.toast.error('Error al cargar métodos de envío'),
      });
  }

  loadRates(): void {
    const z = this.zone();
    if (!z) return;

    this.is_loading_rates.set(true);
    this.selected_rate.set(null);
    this.form_mode.set('none');

    const fetch$ = this.is_read_only()
      ? this.shipping_service.getSystemZoneRates(z.id)
      : this.shipping_service.getStoreZoneRates(z.id);

    fetch$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (rates) => {
        this.rates.set(rates);
        this.is_loading_rates.set(false);
      },
      error: () => {
        this.toast.error('Error al cargar tarifas');
        this.is_loading_rates.set(false);
      },
    });
  }

  selectRate(rate: ShippingRate): void {
    this.selected_rate.set(rate);
    if (!this.is_read_only()) {
      this.form_mode.set('edit');
      this.populateForm(rate);
    }
  }

  private populateForm(rate: ShippingRate): void {
    this.form.patchValue({
      shipping_method_id: rate.shipping_method_id,
      name: rate.name || '',
      type: rate.type,
      base_cost: rate.base_cost,
      per_unit_cost: rate.per_unit_cost,
      min_val: rate.min_val,
      max_val: rate.max_val,
      free_shipping_threshold: rate.free_shipping_threshold,
      is_active: rate.is_active,
    });
  }

  onAddRate(): void {
    this.selected_rate.set(null);
    this.form_mode.set('create');
    this.form.reset({
      shipping_method_id: null,
      name: '',
      type: 'flat',
      base_cost: 0,
      per_unit_cost: null,
      min_val: null,
      max_val: null,
      free_shipping_threshold: null,
      is_active: true,
    });
  }

  selectRateType(type: ShippingRateType): void {
    this.form.patchValue({ type });
    // Reset values when changing type
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

  cancelForm(): void {
    this.form_mode.set('none');
    this.selected_rate.set(null);
    this.form.reset();
  }

  onSubmitRate(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const z = this.zone();
    if (!z) return;

    this.is_saving.set(true);
    const values = this.form.value;

    if (this.form_mode() === 'create') {
      const dto: CreateRateDto = {
        shipping_zone_id: z.id,
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

      this.shipping_service
        .createRate(dto)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast.success('Tarifa creada correctamente');
            this.loadRates();
            this.cancelForm();
            this.rates_changed.emit();
            this.is_saving.set(false);
          },
          error: (err) => {
            this.toast.error('Error al crear tarifa: ' + err.message);
            this.is_saving.set(false);
          },
        });
    } else {
      const rate = this.selected_rate();
      if (!rate) return;

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

      this.shipping_service
        .updateRate(rate.id, dto)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toast.success('Tarifa actualizada correctamente');
            this.loadRates();
            this.cancelForm();
            this.rates_changed.emit();
            this.is_saving.set(false);
          },
          error: (err) => {
            this.toast.error('Error al actualizar tarifa: ' + err.message);
            this.is_saving.set(false);
          },
        });
    }
  }

  onDeleteRate(rate: ShippingRate, event: Event): void {
    event.stopPropagation();

    if (!confirm('¿Estás seguro de eliminar esta tarifa?')) {
      return;
    }

    this.shipping_service
      .deleteRate(rate.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toast.success('Tarifa eliminada');
          this.loadRates();
          if (this.selected_rate()?.id === rate.id) {
            this.cancelForm();
          }
          this.rates_changed.emit();
        },
        error: (err) => {
          this.toast.error('Error al eliminar: ' + err.message);
        },
      });
  }

  onClose(): void {
    this.cancelForm();
    this.rates.set([]);
    this.close.emit();
  }

  getFormError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Requerido';
      if (control.errors['min']) return 'Debe ser mayor o igual a 0';
    }
    return '';
  }

  getRateTypeLabel(type: string): string {
    return this.shipping_service.getZoneRateTypeLabel(type);
  }

  formatCost(cost: number): string {
    return `RD$ ${cost.toFixed(2)}`;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
