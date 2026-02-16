import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
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
  BadgeComponent,
  ButtonComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

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
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="modal_title"
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

      <div class="flex flex-col lg:flex-row gap-6 min-h-[400px]">
        <!-- Left: Rates list -->
        <div class="lg:w-2/5 flex flex-col border-r-0 lg:border-r pr-0 lg:pr-6">
          <div class="flex items-center justify-between mb-4">
            <h4 class="font-medium">Tarifas configuradas</h4>
            <app-button
              *ngIf="!is_read_only"
              variant="outline"
              size="sm"
              (clicked)="onAddRate()"
            >
              <app-icon name="plus" size="14" slot="icon" class="mr-1"></app-icon>
              Agregar
            </app-button>
          </div>

          <!-- Loading -->
          <div *ngIf="is_loading_rates" class="flex items-center justify-center py-8">
            <app-icon name="loader-2" size="24" [spin]="true" class="text-gray-400"></app-icon>
          </div>

          <!-- Empty -->
          <div
            *ngIf="!is_loading_rates && rates.length === 0"
            class="flex flex-col items-center justify-center py-8 text-center"
          >
            <div class="rounded-full bg-muted p-3 mb-3">
              <app-icon name="tag" class="h-5 w-5 text-muted-foreground"></app-icon>
            </div>
            <p class="text-sm text-muted-foreground">
              {{ is_read_only ? 'Sin tarifas configuradas' : 'Agrega tu primera tarifa' }}
            </p>
          </div>

          <!-- Rate list -->
          <div
            *ngIf="!is_loading_rates && rates.length > 0"
            class="space-y-2 overflow-y-auto flex-1"
          >
            <div
              *ngFor="let rate of rates"
              class="p-3 rounded-lg border cursor-pointer transition-colors"
              [class.border-primary]="selectedRate?.id === rate.id"
              [class.bg-primary/5]="selectedRate?.id === rate.id"
              [class.hover:bg-muted/50]="selectedRate?.id !== rate.id"
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
                    <span>&bull;</span>
                    <span>{{ formatCost(rate.base_cost) }}</span>
                  </div>
                </div>
                <button
                  *ngIf="!is_read_only"
                  type="button"
                  class="inline-flex items-center p-1.5 rounded-md text-destructive hover:bg-red-50 transition-colors shrink-0"
                  (click)="onDeleteRate(rate, $event)"
                >
                  <app-icon name="trash-2" class="h-4 w-4"></app-icon>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Form or Detail -->
        <div class="lg:w-3/5">
          <!-- Read-only view for system zones -->
          <ng-container *ngIf="is_read_only">
            <div *ngIf="selectedRate" class="space-y-4">
              <h4 class="font-medium mb-4">Detalles de tarifa</h4>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="text-sm text-muted-foreground">Método</label>
                  <p class="font-medium">{{ selectedRate?.shipping_method?.name || '-' }}</p>
                </div>
                <div>
                  <label class="text-sm text-muted-foreground">Tipo</label>
                  <p class="font-medium">{{ getRateTypeLabel(selectedRate?.type || '') }}</p>
                </div>
                <div>
                  <label class="text-sm text-muted-foreground">Costo base</label>
                  <p class="font-medium">{{ formatCost(selectedRate?.base_cost || 0) }}</p>
                </div>
                <div *ngIf="selectedRate?.per_unit_cost">
                  <label class="text-sm text-muted-foreground">Costo por unidad</label>
                  <p class="font-medium">{{ formatCost(selectedRate?.per_unit_cost || 0) }}</p>
                </div>
                <div *ngIf="selectedRate?.free_shipping_threshold">
                  <label class="text-sm text-muted-foreground">Envío gratis desde</label>
                  <p class="font-medium">{{ formatCost(selectedRate?.free_shipping_threshold || 0) }}</p>
                </div>
              </div>
            </div>
            <div
              *ngIf="!selectedRate"
              class="flex flex-col items-center justify-center h-full text-center"
            >
              <p class="text-muted-foreground">Selecciona una tarifa para ver sus detalles</p>
            </div>
          </ng-container>

          <!-- Edit form for store zones -->
          <ng-container *ngIf="!is_read_only">
            <!-- No form selected -->
            <div
              *ngIf="form_mode === 'none'"
              class="flex flex-col items-center justify-center h-full text-center"
            >
              <div class="rounded-full bg-muted p-4 mb-4">
                <app-icon name="edit" class="h-6 w-6 text-muted-foreground"></app-icon>
              </div>
              <p class="font-medium">Gestiona tus tarifas</p>
              <p class="text-sm text-muted-foreground mt-1">
                Selecciona una tarifa para editarla o crea una nueva
              </p>
            </div>

            <!-- Create/Edit form -->
            <div *ngIf="form_mode !== 'none'">
              <form [formGroup]="form" (ngSubmit)="onSubmitRate()" id="rateForm">
                <h4 class="font-medium mb-4">
                  {{ form_mode === 'create' ? 'Nueva tarifa' : 'Editar tarifa' }}
                </h4>

                <div class="space-y-4">
                  <!-- Shipping Method -->
                  <div>
                    <label class="text-sm font-medium mb-2 block">Método de envío</label>
                    <app-selector
                      [options]="shipping_method_options"
                      formControlName="shipping_method_id"
                      placeholder="Selecciona un método"
                    ></app-selector>
                    <p
                      *ngIf="getFormError('shipping_method_id')"
                      class="text-sm text-destructive mt-1"
                    >
                      {{ getFormError('shipping_method_id') }}
                    </p>
                  </div>

                  <!-- Name -->
                  <app-input
                    label="Nombre de la tarifa (opcional)"
                    placeholder="ej: Envío express zona norte"
                    formControlName="name"
                  ></app-input>

                  <!-- Rate Type -->
                  <div>
                    <label class="text-sm font-medium mb-2 block">Tipo de tarifa</label>
                    <div class="grid grid-cols-2 gap-2">
                      <button
                        *ngFor="let type of rate_types"
                        type="button"
                        class="flex items-start gap-2 p-3 rounded-lg border text-left text-sm transition-colors"
                        [class.border-primary]="form.get('type')?.value === type.value"
                        [class.bg-primary/5]="form.get('type')?.value === type.value"
                        (click)="selectRateType(type.value)"
                      >
                        <app-icon [name]="type.icon" class="h-4 w-4 mt-0.5 shrink-0"></app-icon>
                        <div>
                          <p class="font-medium">{{ type.label }}</p>
                          <p class="text-xs text-muted-foreground">{{ type.description }}</p>
                        </div>
                      </button>
                    </div>
                  </div>

                  <!-- Costs based on type -->
                  <div *ngIf="form.get('type')?.value !== 'free'" class="grid grid-cols-2 gap-4">
                    <app-input
                      label="Costo base"
                      type="number"
                      placeholder="0.00"
                      formControlName="base_cost"
                      [error]="getFormError('base_cost')"
                    ></app-input>

                    <app-input
                      *ngIf="form.get('type')?.value === 'weight_based' || form.get('type')?.value === 'price_based'"
                      [label]="form.get('type')?.value === 'weight_based' ? 'Costo por kg' : 'Costo por unidad'"
                      type="number"
                      placeholder="0.00"
                      formControlName="per_unit_cost"
                    ></app-input>
                  </div>

                  <!-- Min/Max values -->
                  <div
                    *ngIf="form.get('type')?.value === 'weight_based' || form.get('type')?.value === 'price_based'"
                    class="grid grid-cols-2 gap-4"
                  >
                    <app-input
                      [label]="form.get('type')?.value === 'weight_based' ? 'Peso mínimo (kg)' : 'Monto mínimo'"
                      type="number"
                      placeholder="0"
                      formControlName="min_val"
                    ></app-input>
                    <app-input
                      [label]="form.get('type')?.value === 'weight_based' ? 'Peso máximo (kg)' : 'Monto máximo'"
                      type="number"
                      placeholder="Sin límite"
                      formControlName="max_val"
                    ></app-input>
                  </div>

                  <!-- Free shipping threshold -->
                  <app-input
                    *ngIf="form.get('type')?.value !== 'free'"
                    label="Envío gratis desde (opcional)"
                    type="number"
                    placeholder="ej: 2000"
                    formControlName="free_shipping_threshold"
                    hint="Si el pedido supera este monto, el envío será gratis"
                  ></app-input>

                  <!-- Is Active -->
                  <div class="flex items-center justify-between pt-2">
                    <div>
                      <p class="font-medium">Tarifa activa</p>
                      <p class="text-sm text-muted-foreground">
                        Solo las tarifas activas se usan para calcular envíos
                      </p>
                    </div>
                    <app-toggle formControlName="is_active"></app-toggle>
                  </div>
                </div>
              </form>
            </div>
          </ng-container>
        </div>
      </div>

      <!-- Footer -->
      <div slot="footer" class="flex items-center justify-end gap-3 w-full">
        <ng-container *ngIf="is_read_only">
          <app-button variant="ghost" (clicked)="close.emit()">
            Cerrar
          </app-button>
        </ng-container>
        <ng-container *ngIf="!is_read_only && form_mode !== 'none'">
          <app-button variant="ghost" (clicked)="cancelForm()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            [loading]="is_saving"
            [disabled]="form.invalid"
            (clicked)="onSubmitRate()"
          >
            {{ form_mode === 'create' ? 'Crear' : 'Guardar' }}
          </app-button>
        </ng-container>
      </div>
    </app-modal>
  `,
})
export class RatesModalComponent implements OnInit {
  @Input() zone!: ShippingZone;
  @Input() is_read_only = false;
  @Output() close = new EventEmitter<void>();
  @Output() rates_changed = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  private shippingService = inject(ShippingMethodsService);
  private toast = inject(ToastService);

  // State as plain properties
  rates: ShippingRate[] = [];
  selectedRate?: ShippingRate;
  form_mode: 'none' | 'create' | 'edit' = 'none';
  is_loading_rates = false;
  is_saving = false;
  shipping_methods: ShippingRateMethod[] = [];

  form: FormGroup;

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

  // Getter replaces computed()
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

  constructor() {
    this.form = this.fb.group({
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

  ngOnInit(): void {
    this.loadShippingMethods();
    this.loadRates();
  }

  private loadShippingMethods(): void {
    this.shippingService.getAvailableMethodsForRates().subscribe({
      next: (methods) => (this.shipping_methods = methods),
      error: () => this.toast.error('Error al cargar métodos de envío'),
    });
  }

  loadRates(): void {
    if (!this.zone) return;

    this.is_loading_rates = true;
    this.selectedRate = undefined;
    this.form_mode = 'none';

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

  selectRate(rate: ShippingRate): void {
    this.selectedRate = rate;
    if (!this.is_read_only) {
      this.form_mode = 'edit';
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
    this.selectedRate = undefined;
    this.form_mode = 'create';
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
    this.form_mode = 'none';
    this.selectedRate = undefined;
    this.form.reset();
  }

  onSubmitRate(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (!this.zone) return;

    this.is_saving = true;
    const values = this.form.value;

    if (this.form_mode === 'create') {
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
          this.cancelForm();
          this.rates_changed.emit();
          this.is_saving = false;
        },
        error: (err) => {
          this.toast.error('Error al crear tarifa: ' + err.message);
          this.is_saving = false;
        },
      });
    } else {
      if (!this.selectedRate) return;

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
          this.cancelForm();
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

  onDeleteRate(rate: ShippingRate, event: Event): void {
    event.stopPropagation();

    if (!confirm('¿Estás seguro de eliminar esta tarifa?')) {
      return;
    }

    this.shippingService.deleteRate(rate.id).subscribe({
      next: () => {
        this.toast.success('Tarifa eliminada');
        this.loadRates();
        if (this.selectedRate?.id === rate.id) {
          this.cancelForm();
        }
        this.rates_changed.emit();
      },
      error: (err) => {
        this.toast.error('Error al eliminar: ' + err.message);
      },
    });
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
    return this.shippingService.getZoneRateTypeLabel(type);
  }

  formatCost(cost: number): string {
    return `RD$ ${cost.toFixed(2)}`;
  }
}
