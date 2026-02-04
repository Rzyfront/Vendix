import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  ToastService,
} from '../../../../../../shared/components';

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
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      size="md"
      title="Crear Proveedor Rápido"
      subtitle="Agrega un nuevo proveedor sin salir del punto de compra"
    >
      <form
        [formGroup]="supplierForm"
        (ngSubmit)="onSubmit()"
        class="mt-4"
      >
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Name -->
          <div class="md:col-span-2">
            <app-input
              label="Nombre del Proveedor"
              formControlName="name"
              [required]="true"
              placeholder="Ej: Distribuidora Central S.A."
              [control]="supplierForm.get('name')"
              customWrapperClass="!mt-0"
            ></app-input>
          </div>

          <!-- Code -->
          <app-input
            label="Código"
            formControlName="code"
            [required]="true"
            placeholder="Ej: PROV-001"
            [control]="supplierForm.get('code')"
            customWrapperClass="!mt-0"
          ></app-input>

          <!-- Email -->
          <app-input
            label="Email"
            type="email"
            formControlName="email"
            placeholder="contacto@proveedor.com"
            [control]="supplierForm.get('email')"
            customWrapperClass="!mt-0"
          ></app-input>

          <!-- Phone -->
          <app-input
            label="Teléfono"
            type="tel"
            formControlName="phone"
            placeholder="+57 300 123 4567"
            [control]="supplierForm.get('phone')"
            customWrapperClass="!mt-0"
          ></app-input>

          <!-- Tax ID -->
          <app-input
            label="RUT/NIT"
            formControlName="tax_id"
            placeholder="900123456-7"
            [control]="supplierForm.get('tax_id')"
            helperText="Puedes ingresar 'test' si es necesario"
            customWrapperClass="!mt-0"
          ></app-input>

          <!-- Payment Terms -->
          <div class="md:col-span-2">
            <app-input
              label="Términos de Pago"
              formControlName="payment_terms"
              placeholder="Ej: 30 días"
              [control]="supplierForm.get('payment_terms')"
              customWrapperClass="!mt-0"
            ></app-input>
          </div>
        </div>
      </form>

      <!-- Footer Actions -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" (clicked)="onClose()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            [disabled]="supplierForm.invalid || isLoading"
            [loading]="isLoading"
            (clicked)="onSubmit()"
          >
            Crear Proveedor
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
  styleUrls: ['./pop-supplier-quick-create.component.scss'],
})
export class PopSupplierQuickCreateComponent implements OnInit {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() close = new EventEmitter<void>();
  @Output() supplierCreated = new EventEmitter<number>();

  private fb = inject(FormBuilder);
  private suppliersService = inject(SuppliersService);
  private toastService = inject(ToastService);

  supplierForm!: FormGroup;
  isLoading = false;

  ngOnInit(): void {
    this.initForm();
  }

  private initForm(): void {
    this.supplierForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3)]],
      code: ['', [Validators.required]],
      email: ['', [Validators.email]],
      phone: [''],
      tax_id: [''],
      payment_terms: [''],
    });
  }

  // ============================================================
  // Form Actions
  // ============================================================

  onSubmit(): void {
    if (this.supplierForm.invalid) {
      this.supplierForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;

    // Clean data: remove empty strings and only send valid fields
    const formValues = this.supplierForm.value;
    const createDto: any = {
      is_active: true,
    };

    // Only add non-empty values to the DTO
    Object.keys(formValues).forEach((key) => {
      const value = formValues[key];
      if (value !== null && value !== undefined && value !== '') {
        createDto[key] = value;
      }
    });

    this.suppliersService.createSupplier(createDto).subscribe({
      next: (response: any) => {
        if (response.success && response.data) {
          this.toastService.success('Proveedor creado correctamente');
          this.supplierCreated.emit(response.data.id);
          this.resetForm();
          this.isOpenChange.emit(false);
          this.close.emit();
        } else {
          this.toastService.error(
            response.message || 'Error al crear el proveedor',
          );
        }
        this.isLoading = false;
      },
      error: (error: any) => {
        console.error('Error creating supplier:', error);

        // Handle backend validation errors
        let errorMessage = 'Error al crear el proveedor';

        if (error.error?.message) {
          if (Array.isArray(error.error.message)) {
            errorMessage = error.error.message.join(', ');
          } else {
            errorMessage = error.error.message;
          }
        } else if (error.message) {
          errorMessage = error.message;
        }

        this.toastService.error(errorMessage);
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

  private resetForm(): void {
    if (this.supplierForm) {
      this.supplierForm.reset();
    }
  }
}
