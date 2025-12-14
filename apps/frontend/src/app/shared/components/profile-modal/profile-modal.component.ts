import { Component, EventEmitter, inject, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ModalComponent } from '../modal/modal.component'; // Ensure path is correct
import { AuthService } from '../../../core/services/auth.service';
import { finalize } from 'rxjs';
import { ButtonComponent } from '../button/button.component';
import { InputComponent } from '../input/input.component';

@Component({
    selector: 'app-profile-modal',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, ModalComponent, ButtonComponent, InputComponent],
    template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="'Mi Perfil'"
      [subtitle]="'Administra tu información personal y dirección'"
      [size]="'lg'"
      (closed)="onClose()"
      (opened)="onOpen()"
    >
      <form [formGroup]="profileForm" (ngSubmit)="onSubmit()" class="space-y-6">
        <!-- Información Personal -->
        <div>
          <h4 class="text-lg font-medium text-gray-900 mb-4">Información Personal</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Nombre"
              formControlName="first_name"
              placeholder="Tu nombre"
              [error]="getError('first_name')"
            ></app-input>

            <app-input
              label="Apellido"
              formControlName="last_name"
              placeholder="Tu apellido"
              [error]="getError('last_name')"
            ></app-input>

            <app-input
              label="Email"
              formControlName="email"
              type="email"
              [disabled]="true"
              helperText="El email no se puede editar"
            ></app-input>

            <app-input
              label="Teléfono"
              formControlName="phone"
              placeholder="Tu número de teléfono"
              [error]="getError('phone')"
            ></app-input>
          </div>
        </div>

        <div class="border-t border-gray-200"></div>

        <!-- Dirección -->
        <div formGroupName="address">
          <h4 class="text-lg font-medium text-gray-900 mb-4">Dirección de Envío</h4>
          <div class="grid grid-cols-1 gap-4">
            <app-input
              label="Dirección (Calle y Número)"
              formControlName="address_line_1"
              placeholder="Calle Principal 123"
              [error]="getAddressError('address_line_1')"
            ></app-input>
          
            <app-input
              label="Detalles adicionales (Depto, Oficina)"
              formControlName="address_line_2"
              placeholder="Apto 4B"
            ></app-input>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
               <app-input
                label="Ciudad"
                formControlName="city"
                 placeholder="Ciudad"
                [error]="getAddressError('city')"
              ></app-input>

              <app-input
                label="Estado / Provincia"
                formControlName="state"
                 placeholder="Estado"
                [error]="getAddressError('state')"
              ></app-input>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-input
                label="Código Postal"
                formControlName="postal_code"
                placeholder="00000"
                [error]="getAddressError('postal_code')"
              ></app-input>

              <app-input
                label="País"
                formControlName="country"
                 placeholder="País"
                [error]="getAddressError('country')"
              ></app-input>
            </div>
          </div>
        </div>

      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="secondary"
          (click)="isOpen = false"
          label="Cancelar"
        ></app-button>
        <app-button
          variant="primary"
          (click)="onSubmit()"
          [loading]="saving"
          [disabled]="profileForm.invalid || profileForm.pristine"
          label="Guardar Cambios"
        ></app-button>
      </div>
    </app-modal>
  `
})
export class ProfileModalComponent implements OnInit {
    @Input() isOpen = false;
    @Output() isOpenChange = new EventEmitter<boolean>();

    private fb = inject(FormBuilder);
    private authService = inject(AuthService);

    profileForm: FormGroup;
    loading = false;
    saving = false;

    constructor() {
        this.profileForm = this.fb.group({
            first_name: ['', [Validators.required, Validators.minLength(2)]],
            last_name: ['', [Validators.required, Validators.minLength(2)]],
            email: [{ value: '', disabled: true }],
            phone: [''],
            address: this.fb.group({
                address_line_1: ['', Validators.required],
                address_line_2: [''],
                city: ['', Validators.required],
                state: ['', Validators.required],
                postal_code: ['', Validators.required],
                country: ['', Validators.required]
            })
        });
    }

    ngOnInit() { }

    onOpen() {
        this.loadProfile();
    }

    onClose() {
        this.isOpenChange.emit(false);
        this.profileForm.reset();
    }

    loadProfile() {
        this.loading = true;
        this.authService.getProfile()
            .pipe(finalize(() => this.loading = false))
            .subscribe({
                next: (response) => {
                    // Response.data contains user object
                    const user = response.data || response; // Adapt depending on if response is wrapped

                    this.profileForm.patchValue({
                        first_name: user.first_name,
                        last_name: user.last_name,
                        email: user.email,
                        phone: user.phone
                    });

                    // Find primary or first address
                    if (user.addresses && user.addresses.length > 0) {
                        // Check for is_primary or take first
                        const primary = user.addresses.find((a: any) => a.is_primary) || user.addresses[0];

                        this.profileForm.patchValue({
                            address: {
                                address_line_1: primary.address_line1,
                                address_line_2: primary.address_line2,
                                city: primary.city,
                                state: primary.state_province,
                                postal_code: primary.postal_code,
                                country: primary.country_code
                            }
                        });
                    }
                },
                error: (err) => console.error('Error loading profile', err)
            });
    }

    onSubmit() {
        if (this.profileForm.invalid) return;

        this.saving = true;
        const formValue = this.profileForm.getRawValue(); // To include disabled email if needed, but we don't send email

        // Prepare DTO
        const dto = {
            first_name: formValue.first_name,
            last_name: formValue.last_name,
            phone: formValue.phone,
            address: formValue.address
        };

        this.authService.updateProfile(dto)
            .pipe(finalize(() => this.saving = false))
            .subscribe({
                next: () => {
                    this.isOpen = false;
                    this.isOpenChange.emit(false);
                    // Optional: Show success toast
                },
                error: (err) => console.error('Error saving profile', err)
            });
    }

    getError(controlName: string): string {
        const control = this.profileForm.get(controlName);
        if (control?.touched && control?.errors) {
            if (control.errors['required']) return 'Este campo es requerido';
            if (control.errors['minlength']) return 'Mínimo 2 caracteres';
        }
        return '';
    }

    getAddressError(controlName: string): string {
        const control = this.profileForm.get('address')?.get(controlName);
        if (control?.touched && control?.errors) {
            if (control.errors['required']) return 'Este campo es requerido';
        }
        return '';
    }
}
