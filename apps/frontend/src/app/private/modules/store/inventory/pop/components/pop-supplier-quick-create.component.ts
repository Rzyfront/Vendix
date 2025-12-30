import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ModalComponent, ButtonComponent, InputComponent } from '../../../../../../shared/components';

import { SuppliersService } from '../../services/suppliers.service';

/**
 * Quick-create modal for suppliers in POP
 * Allows creating a supplier without leaving the purchase order interface
 */
@Component({
  selector: 'app-pop-supplier-quick-create',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      size="md"
      title="Crear Proveedor Rápido"
      subtitle="Agrega un nuevo proveedor sin salir del punto de compra"
      (close)="onClose()"
    >
      <form (ngSubmit)="onSubmit()" #supplierForm="ngForm">
        <div class="space-y-4">
          <!-- Name -->
          <app-input
            label="Nombre del Proveedor"
            [(ngModel)]="form.name"
            name="name"
            [required]="true"
            placeholder="Ej: Distribuidora Central S.A."
          ></app-input>

          <!-- Code -->
          <app-input
            label="Código"
            [(ngModel)]="form.code"
            name="code"
            [required]="true"
            placeholder="Ej: PROV-001"
          ></app-input>

          <!-- Email -->
          <app-input
            label="Email"
            type="email"
            [(ngModel)]="form.email"
            name="email"
            placeholder="contacto@proveedor.com"
          ></app-input>

          <!-- Phone -->
          <app-input
            label="Teléfono"
            type="tel"
            [(ngModel)]="form.phone"
            name="phone"
            placeholder="+57 300 123 4567"
          ></app-input>

          <!-- Tax ID -->
          <app-input
            label="RUT/NIT"
            [(ngModel)]="form.tax_id"
            name="tax_id"
            placeholder="900123456-7"
          ></app-input>

          <!-- Payment Terms -->
          <app-input
            label="Términos de Pago"
            [(ngModel)]="form.payment_terms"
            name="payment_terms"
            placeholder="Ej: 30 días"
          ></app-input>
        </div>

        <!-- Footer Actions -->
        <div slot="footer" class="flex justify-end gap-3">
          <app-button
            variant="outline"
            (clicked)="onClose()"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            type="submit"
            [disabled]="!isFormValid() || isLoading"
          >
            <span *ngIf="!isLoading">Crear Proveedor</span>
            <span *ngIf="isLoading">Creando...</span>
          </app-button>
        </div>
      </form>
    </app-modal>
  `,
  styleUrls: ['./pop-supplier-quick-create.component.scss'],
})
export class PopSupplierQuickCreateComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() close = new EventEmitter<void>();
  @Output() supplierCreated = new EventEmitter<number>();

  isLoading = false;
  form = {
    name: '',
    code: '',
    email: '',
    phone: '',
    tax_id: '',
    payment_terms: '',
  };

  constructor(private suppliersService: SuppliersService) { }

  // ============================================================
  // Form Actions
  // ============================================================

  onSubmit(): void {
    if (!this.isFormValid()) {
      return;
    }

    this.isLoading = true;

    const createDto = {
      ...this.form,
      is_active: true,
    };

    this.suppliersService.createSupplier(createDto).subscribe({
      next: (response: any) => {
        if (response.success && response.data) {
          this.supplierCreated.emit(response.data.id);
          this.resetForm();
          this.isOpenChange.emit(false);
          this.close.emit();
        }
        this.isLoading = false;
      },
      error: (error: any) => {
        console.error('Error creating supplier:', error);
        this.isLoading = false;
      },
    });
  }

  onClose(): void {
    this.resetForm();
    this.isOpenChange.emit(false);
    this.close.emit();
  }

  // ============================================================
  // Helpers
  // ============================================================

  public isFormValid(): boolean {
    return !!(
      this.form.name &&
      this.form.code
    );
  }

  private resetForm(): void {
    this.form = {
      name: '',
      code: '',
      email: '',
      phone: '',
      tax_id: '',
      payment_terms: '',
    };
  }
}
