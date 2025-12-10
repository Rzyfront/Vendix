import {
  Component,
  inject,
  Output,
  EventEmitter,
  Input,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Subscription } from 'rxjs';
import { CustomersService } from '../../services/customers.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import {
  ModalComponent,
  InputComponent,
  IconComponent,
} from '../../../../../../shared/components/index';
import { ValidationService } from '../../../../../../shared/services/validation.service';

export interface CreateCustomerData {
  username: string;
  email: string;
  first_name: string;
  last_name?: string;
  phone?: string;
  document_type?: string;
  document_number?: string;
}

@Component({
  selector: 'app-customer-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    IconComponent,
  ],
  templateUrl: './customer-create-modal.component.html',
  styleUrls: ['./customer-create-modal.component.css'],
})
export class CustomerCreateModalComponent implements OnInit, OnDestroy {
  private customersService = inject(CustomersService);
  private toastService = inject(ToastService);
  private fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() customerCreated = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  // Reactive Form
  customerForm: FormGroup = this.fb.group({
    username: [
      '',
      [
        Validators.required,
        Validators.minLength(3),
        ValidationService.usernameValidator(),
      ],
    ],
    email: ['', [Validators.required, ValidationService.emailValidator()]],
    first_name: ['', [Validators.required, ValidationService.nameValidator()]],
    last_name: ['', [Validators.required, ValidationService.nameValidator()]],
    phone: ['', [ValidationService.phoneValidator()]],
    document_type: [''],
    document_number: [''],
    password: [
      '',
      [Validators.minLength(8), ValidationService.passwordValidator()],
    ],
  });

  // Form state
  loading = false;
  submitted = false;

  // Document types
  documentTypes = [
    { value: 'dni', label: 'DNI' },
    { value: 'passport', label: 'Pasaporte' },
    { value: 'cedula', label: 'Cédula' },
    { value: 'rut', label: 'RUT' },
  ];

  private documentTypeSubscription?: Subscription;

  ngOnInit(): void {
    // Update document number validation when document type changes
    this.documentTypeSubscription = this.customerForm
      .get('document_type')
      ?.valueChanges.subscribe((documentType) => {
        const documentNumberControl = this.customerForm.get('document_number');
        if (documentType) {
          documentNumberControl?.setValidators([
            ValidationService.documentNumberValidator(documentType),
          ]);
        } else {
          documentNumberControl?.clearValidators();
        }
        documentNumberControl?.updateValueAndValidity();
      });
  }

  ngOnDestroy(): void {
    this.documentTypeSubscription?.unsubscribe();
  }

  onClose(): void {
    this.isOpen = false;
    this.isOpenChange.emit(false);
    this.close.emit();
  }

  onSubmit(): void {
    this.submitted = true;

    if (this.customerForm.invalid) {
      return;
    }

    this.loading = true;

    this.customersService.createCustomer(this.customerForm.value).subscribe({
      next: () => {
        this.toastService.success('Cliente creado exitosamente');
        this.customerCreated.emit();
        this.onClose();
        this.resetForm();
      },
      error: (error: any) => {
        this.loading = false;
        const message =
          error.error?.message || error.message || 'Error al crear cliente';
        this.toastService.error('Error al crear cliente', message);
      },
    });
  }

  private resetForm(): void {
    this.customerForm.reset();
    this.submitted = false;
    this.loading = false;
  }

  // Helper methods for template
  hasError(field: string): boolean {
    const control = this.customerForm.get(field);
    return this.submitted && !!control?.errors;
  }

  getError(field: string): string {
    const control = this.customerForm.get(field);
    if (!control?.errors) return '';

    const firstError = Object.keys(control.errors)[0];
    return ValidationService.getErrorMessage(
      control.errors,
      this.getFieldLabel(field),
    );
  }

  private getFieldLabel(field: string): string {
    const labels: { [key: string]: string } = {
      username: 'Nombre de usuario',
      email: 'Email',
      first_name: 'Nombre',
      last_name: 'Apellido',
      phone: 'Teléfono',
      document_type: 'Tipo de documento',
      document_number: 'Número de documento',
      password: 'Contraseña',
    };
    return labels[field] || field;
  }
}
