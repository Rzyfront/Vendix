import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AccountService, UserProfile, Address } from '../../services/account.service';
import { AuthFacade } from '../../../../../core/auth/services/auth.facade';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule],
  templateUrl: './account.component.html',
  styleUrls: ['./account.component.scss'],
})
export class AccountComponent implements OnInit {
  profile: UserProfile | null = null;
  addresses: Address[] = [];

  profile_form!: FormGroup;
  password_form!: FormGroup;

  is_loading = true;
  is_saving = false;
  is_changing_password = false;

  show_password_form = false;
  success_message = '';
  error_message = '';

  constructor(
    private account_service: AccountService,
    private auth_facade: AuthFacade,
    private fb: FormBuilder,
  ) {
    this.initForms();
  }

  ngOnInit(): void {
    this.loadProfile();
    this.loadAddresses();
  }

  initForms(): void {
    this.profile_form = this.fb.group({
      first_name: ['', Validators.required],
      last_name: ['', Validators.required],
      phone: [''],
      document_type: [''],
      document_number: [''],
    });

    this.password_form = this.fb.group({
      current_password: ['', Validators.required],
      new_password: ['', [Validators.required, Validators.minLength(8)]],
      confirm_password: ['', Validators.required],
    });
  }

  loadProfile(): void {
    this.is_loading = true;
    this.account_service.getProfile().subscribe({
      next: (response) => {
        if (response.success) {
          this.profile = response.data;
          this.profile_form.patchValue({
            first_name: response.data.first_name,
            last_name: response.data.last_name,
            phone: response.data.phone,
            document_type: response.data.document_type,
            document_number: response.data.document_number,
          });
        }
        this.is_loading = false;
      },
      error: () => {
        this.is_loading = false;
      },
    });
  }

  loadAddresses(): void {
    this.account_service.getAddresses().subscribe({
      next: (response) => {
        if (response.success) {
          this.addresses = response.data;
        }
      },
    });
  }

  saveProfile(): void {
    if (!this.profile_form.valid) return;

    this.is_saving = true;
    this.clearMessages();

    this.account_service.updateProfile(this.profile_form.value).subscribe({
      next: (response) => {
        if (response.success) {
          this.profile = response.data;
          this.success_message = 'Perfil actualizado correctamente';
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
    if (!this.password_form.valid) return;

    const { current_password, new_password, confirm_password } = this.password_form.value;

    if (new_password !== confirm_password) {
      this.error_message = 'Las contraseñas no coinciden';
      return;
    }

    this.is_changing_password = true;
    this.clearMessages();

    this.account_service.changePassword(current_password, new_password).subscribe({
      next: (response) => {
        if (response.success) {
          this.success_message = 'Contraseña cambiada correctamente';
          this.password_form.reset();
          this.show_password_form = false;
        }
        this.is_changing_password = false;
      },
      error: (err) => {
        this.error_message = err.error?.message || 'Error al cambiar la contraseña';
        this.is_changing_password = false;
      },
    });
  }

  deleteAddress(address_id: number): void {
    if (!confirm('¿Estás seguro de eliminar esta dirección?')) return;

    this.account_service.deleteAddress(address_id).subscribe({
      next: () => {
        this.addresses = this.addresses.filter((a) => a.id !== address_id);
        this.success_message = 'Dirección eliminada';
      },
      error: () => {
        this.error_message = 'Error al eliminar la dirección';
      },
    });
  }

  logout(): void {
    this.auth_facade.logout();
  }

  clearMessages(): void {
    this.success_message = '';
    this.error_message = '';
  }
}
