import { Component, inject, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CustomersService } from '../../services/customers.service';
import { Customer, UserState } from '../../interfaces/customer.interface';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';

@Component({
  selector: 'app-customer-details-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  templateUrl: './customer-details-modal.component.html',
  styleUrls: ['./customer-details-modal.component.css'],
})
export class CustomerDetailsModalComponent {
  private customersService = inject(CustomersService);
  private toastService = inject(ToastService);

  @Input() customerId: number | null = null;
  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();
  @Output() customerUpdated = new EventEmitter<void>();

  // Customer data
  customer: Customer | null = null;
  loading = false;
  editing = false;

  // Edit form data
  editData: Partial<Customer> = {};

  // Status options
  statusOptions = [
    { value: UserState.ACTIVE, label: 'Activo', color: 'green' },
    { value: UserState.INACTIVE, label: 'Inactivo', color: 'gray' },
    {
      value: UserState.PENDING_VERIFICATION,
      label: 'Pendiente de Verificación',
      color: 'yellow',
    },
    { value: UserState.SUSPENDED, label: 'Suspendido', color: 'red' },
    { value: UserState.ARCHIVED, label: 'Archivado', color: 'gray' },
  ];

  // Watch for customer ID changes
  ngOnChanges(): void {
    if (this.isOpen && this.customerId) {
      this.loadCustomerDetails();
    }
  }

  onClose(): void {
    this.close.emit();
    this.resetState();
  }

  loadCustomerDetails(): void {
    if (!this.customerId) return;

    this.loading = true;
    this.customersService.getCustomerById(this.customerId).subscribe({
      next: (customer: Customer) => {
        this.customer = customer;
        this.loading = false;
      },
      error: (error: any) => {
        this.loading = false;
        const message =
          error.error?.message ||
          error.message ||
          'Error al cargar detalles del cliente';
        this.toastService.error('Error', message);
      },
    });
  }

  startEditing(): void {
    if (!this.customer) return;

    this.editing = true;
    this.editData = {
      first_name: this.customer.first_name,
      last_name: this.customer.last_name,
      phone: this.customer.phone,
      document_type: this.customer.document_type,
      document_number: this.customer.document_number,
    };
  }

  cancelEditing(): void {
    this.editing = false;
    this.editData = {};
  }

  saveChanges(): void {
    if (!this.customer || !this.customerId) return;

    this.loading = true;
    this.customersService
      .updateCustomer(this.customerId, this.editData)
      .subscribe({
        next: (updatedCustomer: Customer) => {
          this.customer = updatedCustomer;
          this.editing = false;
          this.loading = false;
          this.toastService.success('Cliente actualizado exitosamente');
          this.customerUpdated.emit();
        },
        error: (error: any) => {
          this.loading = false;
          const message =
            error.error?.message ||
            error.message ||
            'Error al actualizar cliente';
          this.toastService.error('Error al actualizar cliente', message);
        },
      });
  }

  changeStatus(newStatus: UserState): void {
    if (!this.customer || !this.customerId) return;

    this.loading = true;
    this.customersService
      .changeCustomerStatus(this.customerId, newStatus)
      .subscribe({
        next: (updatedCustomer: Customer) => {
          this.customer = updatedCustomer;
          this.loading = false;
          this.toastService.success('Estado actualizado exitosamente');
          this.customerUpdated.emit();
        },
        error: (error: any) => {
          this.loading = false;
          const message =
            error.error?.message || error.message || 'Error al cambiar estado';
          this.toastService.error('Error al cambiar estado', message);
        },
      });
  }

  private resetState(): void {
    this.customer = null;
    this.loading = false;
    this.editing = false;
    this.editData = {};
  }

  // Helper methods for template
  getStatusLabel(status: UserState): string {
    const option = this.statusOptions.find((opt) => opt.value === status);
    return option?.label || status;
  }

  getStatusColor(status: UserState): string {
    const option = this.statusOptions.find((opt) => opt.value === status);
    return option?.color || 'gray';
  }

  formatDate(date: Date | string | undefined): string {
    if (!date) return 'N/A';
    const d = new Date(date);
    return d.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatPhone(phone: string | undefined): string {
    if (!phone) return 'N/A';
    return phone;
  }

  getCustomerInitials(): string {
    if (!this.customer) return '?';

    const firstName = this.customer.first_name || '';
    const lastName = this.customer.last_name || '';
    const username = this.customer.username || '';

    if (firstName && lastName) {
      return (firstName[0] + lastName[0]).toUpperCase();
    }

    if (firstName) {
      return firstName[0].toUpperCase();
    }

    if (username) {
      return username[0].toUpperCase();
    }

    return '?';
  }
}
