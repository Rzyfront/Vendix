import { Component, OnInit, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AccountService, UserProfile, Address } from '../../services/account.service';
import { AuthFacade } from '../../../../../core/store';
import { AddressModalComponent } from '../../components/address-modal/address-modal.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { SelectorComponent, SelectorOption } from '../../../../../shared/components/selector/selector.component';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule, AddressModalComponent, IconComponent, ButtonComponent, InputComponent, SelectorComponent],
  templateUrl: './account.component.html',
  styleUrls: ['./account.component.scss'],
})
export class AccountComponent implements OnInit {
  private account_service = inject(AccountService);
  private auth_facade = inject(AuthFacade);
  private fb = inject(FormBuilder);
  private destroy_ref = inject(DestroyRef);
  private router = inject(Router);

  profile: UserProfile | null = null;

  profile_form!: FormGroup;
  password_form!: FormGroup;

  is_loading = true;
  is_saving = false;
  is_changing_password = false;

  show_password_form = false;
  success_message = '';
  error_message = '';

  // Address Modal State
  show_address_modal = false;
  address_modal_mode: 'create' | 'edit' = 'create';
  editing_address: Address | undefined = undefined;

  // Address type labels mapping
  private address_type_labels: Record<string, string> = {
    shipping: 'Envío',
    billing: 'Facturación',
    home: 'Casa',
    work: 'Trabajo',
  };

  // Document type options for selector
  document_type_options: SelectorOption[] = [
    { value: 'CC', label: 'Cédula de Ciudadanía' },
    { value: 'CE', label: 'Cédula de Extranjería' },
    { value: 'NIT', label: 'NIT' },
    { value: 'passport', label: 'Pasaporte' },
  ];

  ngOnInit(): void {
    this.initForms();
    this.loadProfile();
  }

  initForms(): void {
    this.profile_form = this.fb.group({
      first_name: ['', Validators.required],
      last_name: ['', Validators.required],
      phone: ['', [Validators.pattern(/^[\d+#*\s()-]*$/)]],
      document_type: [''],
      document_number: ['', [Validators.pattern(/^[0-9]+$/)]],
    });

    this.password_form = this.fb.group({
      current_password: ['', Validators.required],
      new_password: ['', [Validators.required, Validators.minLength(8)]],
      confirm_password: ['', Validators.required],
    });
  }

  loadProfile(): void {
    this.is_loading = true;
    this.clearMessages();

    this.account_service.getProfile()
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.profile = response.data;
            this.profile_form.patchValue({
              first_name: response.data.first_name || '',
              last_name: response.data.last_name || '',
              phone: response.data.phone || '',
              document_type: response.data.document_type || '',
              document_number: response.data.document_number || '',
            });
          }
          this.is_loading = false;
        },
        error: (err) => {
          this.error_message = err.error?.message || 'Error al cargar el perfil';
          this.is_loading = false;
        },
      });
  }

  saveProfile(): void {
    if (!this.profile_form.valid) {
      this.markFormGroupTouched(this.profile_form);
      return;
    }

    this.is_saving = true;
    this.clearMessages();

    this.account_service.updateProfile(this.profile_form.value)
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.profile = response.data;
            this.success_message = 'Perfil actualizado correctamente';
            setTimeout(() => this.clearMessages(), 3000);
          }
          this.is_saving = false;
        },
        error: (err) => {
          this.error_message = err.error?.message || 'Error al actualizar el perfil';
          this.is_saving = false;
        },
      });
  }

  changePassword(): void {
    if (!this.password_form.valid) {
      this.markFormGroupTouched(this.password_form);
      return;
    }

    const { current_password, new_password, confirm_password } = this.password_form.value;

    if (new_password !== confirm_password) {
      this.error_message = 'Las contraseñas no coinciden';
      return;
    }

    this.is_changing_password = true;
    this.clearMessages();

    this.account_service.changePassword(current_password, new_password)
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.success_message = 'Contraseña cambiada correctamente';
            this.password_form.reset();
            this.show_password_form = false;
            setTimeout(() => this.clearMessages(), 3000);
          }
          this.is_changing_password = false;
        },
        error: (err) => {
          this.error_message = err.error?.message || 'Error al cambiar la contraseña';
          this.is_changing_password = false;
        },
      });
  }

  // Address Modal Methods
  openAddressModal(mode: 'create' | 'edit', address?: Address): void {
    this.address_modal_mode = mode;
    this.editing_address = address;
    this.show_address_modal = true;
    this.clearMessages();
  }

  onAddressSaved(address: Address): void {
    // Reload profile to get updated addresses
    this.loadProfile();
    this.success_message = this.address_modal_mode === 'create'
      ? 'Dirección agregada correctamente'
      : 'Dirección actualizada correctamente';
    setTimeout(() => this.clearMessages(), 3000);
    // Reset modal state after modal closes
    this.address_modal_mode = 'create';
    this.editing_address = undefined;
  }

  setAddressPrimary(address_id: number): void {
    this.clearMessages();

    this.account_service.setAddressPrimary(address_id)
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: (response) => {
          if (response.success) {
            // Reload profile to get updated addresses
            this.loadProfile();
            this.success_message = 'Dirección principal establecida';
            setTimeout(() => this.clearMessages(), 3000);
          }
        },
        error: (err) => {
          this.error_message = err.error?.message || 'Error al establecer dirección principal';
        },
      });
  }

  deleteAddress(address_id: number): void {
    if (!confirm('¿Estás seguro de eliminar esta dirección?')) return;

    this.clearMessages();

    this.account_service.deleteAddress(address_id)
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: (response) => {
          if (response.success) {
            // Remove from local profile addresses
            if (this.profile) {
              this.profile.addresses = this.profile.addresses.filter((a) => a.id !== address_id);
            }
            this.success_message = 'Dirección eliminada correctamente';
            setTimeout(() => this.clearMessages(), 3000);
          }
        },
        error: (err) => {
          this.error_message = err.error?.message || 'Error al eliminar la dirección';
        },
      });
  }

  getAddressTypeLabel(type: string): string {
    return this.address_type_labels[type] || type;
  }

  logout(): void {
    this.auth_facade.logout({ redirect: false });
    this.router.navigate(['/']);
  }

  clearMessages(): void {
    this.success_message = '';
    this.error_message = '';
  }

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.keys(formGroup.controls).forEach((key) => {
      const control = formGroup.get(key);
      control?.markAsTouched();

      if (control instanceof FormGroup) {
        this.markFormGroupTouched(control);
      }
    });
  }
}
