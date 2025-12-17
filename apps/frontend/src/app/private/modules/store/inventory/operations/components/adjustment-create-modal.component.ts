import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

// Shared Components
import {
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    SelectorOption,
    IconComponent,
} from '../../../../../../shared/components/index';

// Services
import { InventoryService } from '../../services';
import { ProductsService } from '../../../products/services/products.service';

// Interfaces
import { CreateAdjustmentDto, AdjustmentType, InventoryLocation } from '../../interfaces';

@Component({
    selector: 'app-adjustment-create-modal',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        ModalComponent,
        ButtonComponent,
        InputComponent,
        SelectorComponent,
        IconComponent,
    ],
    template: `
    <app-modal
      [isOpen]="isOpen"
      title="Nuevo Ajuste de Inventario"
      size="md"
      (close)="onCancel()"
    >
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="space-y-6">
          <!-- Product Selection -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Producto *</label>
            <app-input
              formControlName="product_name"
              placeholder="Buscar producto por nombre o SKU..."
              [error]="getError('product_id')"
            ></app-input>
            <!-- In a real implementation, this would be an autocomplete component -->
          </div>

          <!-- Location -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Ubicación *</label>
            <app-selector
              [options]="location_options"
              formControlName="location_id"
              placeholder="Seleccionar ubicación"
            ></app-selector>
          </div>

          <!-- Adjustment Type -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Tipo de Ajuste *</label>
            <div class="grid grid-cols-3 gap-2">
              <button
                *ngFor="let type of adjustment_types"
                type="button"
                (click)="selectType(type.value)"
                [class]="getTypeButtonClasses(type.value)"
              >
                <app-icon [name]="type.icon" [size]="16" class="mb-1"></app-icon>
                <span class="text-xs">{{ type.label }}</span>
              </button>
            </div>
          </div>

          <!-- Quantity -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Cantidad Actual</label>
              <app-input
                formControlName="quantity_before"
                type="number"
                [disabled]="true"
              ></app-input>
            </div>
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Nueva Cantidad *</label>
              <app-input
                formControlName="quantity_after"
                type="number"
                [error]="getError('quantity_after')"
              ></app-input>
            </div>
          </div>

          <!-- Reason -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Código de Razón</label>
            <app-selector
              [options]="reason_options"
              formControlName="reason_code"
              placeholder="Seleccionar razón"
            ></app-selector>
          </div>

          <!-- Description -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Descripción</label>
            <textarea
              formControlName="description"
              rows="3"
              class="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Describir el motivo del ajuste..."
            ></textarea>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-3 mt-8 pt-4 border-t border-border">
          <app-button variant="secondary" type="button" (clicked)="onCancel()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            type="submit"
            [loading]="isSubmitting"
            [disabled]="form.invalid || isSubmitting || !selected_type"
          >
            Crear Ajuste
          </app-button>
        </div>
      </form>
    </app-modal>
  `,
})
export class AdjustmentCreateModalComponent implements OnInit {
    @Input() isOpen = false;
    @Input() isSubmitting = false;

    @Output() cancel = new EventEmitter<void>();
    @Output() save = new EventEmitter<CreateAdjustmentDto>();

    form: FormGroup;
    selected_type: AdjustmentType | null = null;
    location_options: SelectorOption[] = [];
    reason_options: SelectorOption[] = [
        { value: 'INV_COUNT', label: 'Conteo de inventario' },
        { value: 'DAMAGED', label: 'Producto dañado' },
        { value: 'EXPIRED', label: 'Producto vencido' },
        { value: 'LOST', label: 'Producto perdido' },
        { value: 'THEFT', label: 'Robo confirmado' },
        { value: 'OTHER', label: 'Otro' },
    ];

    adjustment_types: { label: string; value: AdjustmentType; icon: string }[] = [
        { label: 'Daño', value: 'damage', icon: 'alert-triangle' },
        { label: 'Pérdida', value: 'loss', icon: 'x-circle' },
        { label: 'Robo', value: 'theft', icon: 'shield-off' },
        { label: 'Vencido', value: 'expiration', icon: 'clock' },
        { label: 'Conteo', value: 'count_variance', icon: 'hash' },
        { label: 'Corrección', value: 'manual_correction', icon: 'edit-3' },
    ];

    constructor(
        private fb: FormBuilder,
        private inventoryService: InventoryService
    ) {
        this.form = this.createForm();
    }

    ngOnInit(): void {
        this.loadLocations();
    }

    private createForm(): FormGroup {
        return this.fb.group({
            product_id: [null, Validators.required],
            product_name: [''],
            location_id: [null, Validators.required],
            quantity_before: [{ value: 0, disabled: true }],
            quantity_after: [0, [Validators.required, Validators.min(0)]],
            reason_code: [''],
            description: [''],
        });
    }

    loadLocations(): void {
        this.inventoryService.getLocations().subscribe({
            next: (response) => {
                if (response.data) {
                    this.location_options = response.data.map((l) => ({
                        value: l.id,
                        label: l.name,
                    }));
                }
            },
        });
    }

    selectType(type: AdjustmentType): void {
        this.selected_type = type;
    }

    getTypeButtonClasses(type: AdjustmentType): string {
        const base = 'flex flex-col items-center p-3 rounded-lg border transition-colors';
        if (type === this.selected_type) {
            return `${base} border-primary bg-primary/10 text-primary`;
        }
        return `${base} border-border bg-surface text-text-secondary hover:border-muted hover:bg-muted/10`;
    }

    getError(field: string): string {
        const control = this.form.get(field);
        if (control?.touched && control?.errors) {
            if (control.errors['required']) return 'Este campo es requerido';
            if (control.errors['min']) return 'El valor mínimo es 0';
        }
        return '';
    }

    onCancel(): void {
        this.form.reset();
        this.selected_type = null;
        this.cancel.emit();
    }

    onSubmit(): void {
        if (this.form.valid && this.selected_type) {
            const form_value = this.form.getRawValue();

            const dto: CreateAdjustmentDto = {
                organization_id: 1, // From context
                product_id: form_value.product_id || 1, // TODO: Proper product selection
                location_id: form_value.location_id,
                type: this.selected_type,
                quantity_after: Number(form_value.quantity_after),
                reason_code: form_value.reason_code || undefined,
                description: form_value.description || undefined,
            };

            this.save.emit(dto);
        }
    }
}
