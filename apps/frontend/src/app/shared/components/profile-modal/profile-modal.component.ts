import { Component, EventEmitter, inject, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ModalComponent } from '../modal/modal.component';
import { AuthService } from '../../../core/services/auth.service';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { finalize, take } from 'rxjs';
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
      <div *ngIf="!isEditing; else editMode">
        <!-- VISTA DE PERFIL -->

        <!-- Información Personal -->
        <div class="mb-6">
          <h4 class="text-lg font-medium text-gray-900 mb-4 border-b pb-2">Información Personal</h4>
          <div class="flex items-start gap-6">
            <!-- Foto / Placeholder -->
            <div class="flex-shrink-0">
               <div class="w-24 h-24 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-3xl font-bold border-2 border-primary-200">
                  {{ getInitials() }}
               </div>
            </div>
            
            <!-- Datos Personales -->
             <div class="space-y-3 flex-grow">
               <div>
                  <label class="block text-sm font-medium text-gray-500">Nombre Completo</label>
                  <div class="text-gray-900 font-medium">{{ userInfo?.first_name }} {{ userInfo?.last_name }}</div>
               </div>
               <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-500">Email</label>
                    <div class="text-gray-900">{{ userInfo?.email }}</div>
                  </div>
                   <div>
                    <label class="block text-sm font-medium text-gray-500">Teléfono</label>
                    <div class="text-gray-900">{{ userInfo?.phone || 'No registrado' }}</div>
                  </div>
               </div>
               
               <!-- Documento y Fecha de Registro -->
               <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                  <div>
                    <label class="block text-sm font-medium text-gray-500">Documento</label>
                    <div class="text-gray-900">
                      <span *ngIf="userInfo?.document_type && userInfo?.document_number">
                        {{ userInfo?.document_type }} {{ userInfo?.document_number }}
                      </span>
                      <span *ngIf="!userInfo?.document_type || !userInfo?.document_number" class="text-gray-400 italic">
                        No registrado
                      </span>
                    </div>
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-500">Miembro desde</label>
                    <div class="text-gray-900">{{ userInfo?.created_at | date:'mediumDate' }}</div>
                  </div>
               </div>
             </div>
          </div>
        </div>

        <!-- Dirección -->
        <div class="mb-6">
           <h4 class="text-lg font-medium text-gray-900 mb-4 border-b pb-2">Dirección</h4>
           <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <div *ngIf="hasAddress; else noAddress" class="space-y-4">
                 <!-- Calle Principal -->
                 <div>
                    <label class="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Dirección</label>
                    <div class="text-gray-900 font-medium">{{ addressInfo?.address_line_1 }}</div>
                    <div class="text-gray-600 text-sm mt-1" *ngIf="addressInfo?.address_line_2">{{ addressInfo?.address_line_2 }}</div>
                 </div>
                 
                 <!-- Ciudad y Estado -->
                 <div class="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-200 pt-3">
                    <div>
                        <label class="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Ciudad</label>
                        <div class="text-gray-900">{{ addressInfo?.city }}</div>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Estado / Provincia</label>
                        <div class="text-gray-900">{{ addressInfo?.state }}</div>
                    </div>
                 </div>

                 <!-- País y Código Postal -->
                 <div class="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-200 pt-3">
                    <div>
                        <label class="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">País</label>
                        <div class="text-gray-900">{{ addressInfo?.country }}</div>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Código Postal</label>
                        <div class="text-gray-900">{{ addressInfo?.postal_code }}</div>
                    </div>
                 </div>
              </div>
              <ng-template #noAddress>
                  <div class="text-center py-4">
                    <p class="text-gray-500 italic mb-2">No hay dirección registrada.</p>
                    <button class="text-primary-600 hover:text-primary-800 text-sm font-medium" (click)="enableEditMode()">Agregar Dirección</button>
                  </div>
              </ng-template>
           </div>
        </div>

        <!-- Datos de Cuenta / Password -->
        <div class="mb-6">
             <h4 class="text-lg font-medium text-gray-900 mb-4 border-b pb-2">Datos de Cuenta</h4>
             <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div>
                   <label class="block text-sm font-medium text-gray-500">Nombre de Usuario</label>
                   <div class="text-gray-900 font-medium">{{ userInfo?.username || userInfo?.email }}</div>
                </div>
                
                <div class="w-full md:w-auto">
                    <button 
                        type="button" 
                        class="text-primary-600 hover:text-primary-700 font-medium text-sm flex items-center gap-2"
                        (click)="togglePasswordSection()"
                    >
                       <span *ngIf="!showPasswordSection">Cambiar Contraseña</span>
                       <span *ngIf="showPasswordSection">Cancelar cambio</span>
                    </button>
                </div>
             </div>

             <!-- Formulario Cambio Password -->
             <div *ngIf="showPasswordSection" class="mt-4 p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                 <form [formGroup]="passwordForm" (ngSubmit)="onChangePassword()" class="space-y-4">
                     <app-input
                        label="Contraseña Actual"
                        formControlName="current_password"
                        type="password"
                        placeholder="••••••"
                        [error]="getPasswordError('current_password')"
                     ></app-input>

                     <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <app-input
                            label="Nueva Contraseña"
                            formControlName="new_password"
                            type="password"
                            placeholder="••••••"
                            [error]="getPasswordError('new_password')"
                        ></app-input>
                        
                        <app-input
                            label="Confirmar Contraseña"
                            formControlName="confirm_password"
                            type="password"
                            placeholder="••••••"
                            [error]="getPasswordError('confirm_password')"
                        ></app-input>
                     </div>

                     <div class="flex justify-end mt-2">
                        <app-button
                            variant="primary"
                            type="submit"
                            [loading]="savingPassword"
                            [disabled]="passwordForm.invalid"
                        >
                            Actualizar Contraseña
                        </app-button>
                     </div>
                 </form>
             </div>
        </div>
      </div>

      <!-- MODO EDICIÓN -->
      <ng-template #editMode>
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
            
            <app-input
              label="Tipo Documento"
              formControlName="document_type"
              placeholder="CC, NIT, etc."
            ></app-input>

            <app-input
              label="Número Documento"
              formControlName="document_number"
              placeholder="12345678"
            ></app-input>
          </div>
        </div>

        <div class="border-t border-gray-200"></div>

        <!-- Dirección -->
        <div formGroupName="address">
          <h4 class="text-lg font-medium text-gray-900 mb-4">Dirección</h4>
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
                placeholder="País (ej. COL)"
                [error]="getAddressError('country')"
                helperText="Código de 2 o 3 letras (ej. CO, USA)"
              ></app-input>
            </div>
          </div>
        </div>
      </form>
      </ng-template>

      <!-- FOOTER GLOBAL -->
      <div slot="footer" class="flex justify-end gap-3 w-full">
         <ng-container *ngIf="!isEditing">
            <app-button
              variant="secondary"
              (click)="onClose()"
            >
                Cerrar
            </app-button>
            <app-button
              variant="primary"
              (click)="enableEditMode()"
            >
                Editar Perfil
            </app-button>
         </ng-container>

         <ng-container *ngIf="isEditing">
            <app-button
              variant="secondary"
              (click)="cancelEditMode()"
            >
                Cancelar
            </app-button>
            <app-button
              variant="primary"
              (click)="onSubmit()"
              [loading]="saving"
              [disabled]="profileForm.invalid"
            >
                Guardar Cambios
            </app-button>
         </ng-container>
      </div>
    </app-modal>
  `
})
export class ProfileModalComponent implements OnInit {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();

  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private authFacade = inject(AuthFacade);

  profileForm: FormGroup;
  passwordForm: FormGroup;

  loading = false;
  saving = false;
  savingPassword = false;

  isEditing = false;
  showPasswordSection = false;

  userInfo: any = null;
  addressInfo: any = null;
  hasAddress = false;

  constructor() {
    this.profileForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      email: [{ value: '', disabled: true }],
      phone: [''],
      document_type: [''],
      document_number: [''],
      address: this.fb.group({
        address_line_1: ['', Validators.required],
        address_line_2: [''],
        city: ['', Validators.required],
        state: ['', Validators.required],
        postal_code: ['', Validators.required],
        country: ['', [Validators.required, Validators.maxLength(3)]]
      })
    });

    this.passwordForm = this.fb.group({
      current_password: ['', Validators.required],
      new_password: ['', [Validators.required, Validators.minLength(6)]],
      confirm_password: ['', Validators.required]
    }, { validators: this.passwordMatchValidator });
  }

  ngOnInit() {
    // Subscribe to user state to have immediate data
    this.authFacade.user$.subscribe(user => {
      if (user) {
        this.updateLocalUserInfo(user);
      }
    });
  }

  onOpen() {
    this.isEditing = false;
    this.showPasswordSection = false;
    this.passwordForm.reset();
    this.loadProfile();
  }

  onClose() {
    this.isOpen = false;
    this.isOpenChange.emit(false);
    this.isEditing = false;
    this.showPasswordSection = false;
    // Don't reset forms here, let onOpen handle reset to avoid clearing state during fade out
  }

  enableEditMode() {
    this.isEditing = true;
    // Ensure form is populated with current data
    if (this.userInfo) {
      this.profileForm.patchValue({
        first_name: this.userInfo.first_name,
        last_name: this.userInfo.last_name,
        email: this.userInfo.email,
        phone: this.userInfo.phone,
        document_type: this.userInfo.document_type,
        document_number: this.userInfo.document_number
      });
    }
    if (this.addressInfo) {
      this.profileForm.patchValue({
        address: {
          address_line_1: this.addressInfo.address_line_1,
          address_line_2: this.addressInfo.address_line_2,
          city: this.addressInfo.city,
          state: this.addressInfo.state,
          postal_code: this.addressInfo.postal_code,
          country: this.addressInfo.country
        }
      });
    }
  }
  cancelEditMode() {
    this.isEditing = false;
    // Optionally reload profile to revert any unsaved form changes validly
    this.loadProfile();
  }

  togglePasswordSection() {
    this.showPasswordSection = !this.showPasswordSection;
    if (!this.showPasswordSection) {
      this.passwordForm.reset();
    }
  }

  loadProfile() {
    this.loading = true;
    this.authService.getProfile()
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: (response) => {
          const user = response.data || response;
          this.updateLocalUserInfo(user);
        },
        error: (err) => console.error('Error loading profile', err)
      });
  }

  updateLocalUserInfo(user: any) {
    if (!user) return;
    this.userInfo = user;

    if (user.addresses && user.addresses.length > 0) {
      const primary = user.addresses.find((a: any) => a.is_primary) || user.addresses[0];
      this.addressInfo = {
        address_line_1: primary.address_line1,
        address_line_2: primary.address_line2,
        city: primary.city,
        state: primary.state_province,
        postal_code: primary.postal_code,
        country: primary.country_code
      };
      this.hasAddress = true;
    } else {
      // Address info might be null if not loaded yet or not existing
      // If user object from store doesn't have addresses, we don't clear addressInfo if it was already set by API
      // But here we are overwriting. 
      // Better to only overwrite if addresses are present OR if we are sure this is the source of truth.
      // For now, if addresses missing in user object, check if we have them from previous load? 
      // No, simplicity first.
      if (!this.addressInfo) {
        this.addressInfo = null;
        this.hasAddress = false;
      }
    }
  }

  onSubmit() {
    if (this.profileForm.invalid) return;

    this.saving = true;
    const formValue = this.profileForm.getRawValue();

    const dto = {
      first_name: formValue.first_name,
      last_name: formValue.last_name,
      phone: formValue.phone,
      document_type: formValue.document_type,
      document_number: formValue.document_number,
      address: formValue.address
    };

    this.authService.updateProfile(dto)
      .pipe(finalize(() => this.saving = false))
      .subscribe({
        next: () => {
          this.isEditing = false;
          this.loadProfile(); // Reload to update view and sync everything
          // Also refresh auth user in store if possible
          this.authFacade.loadUser();
        },
        error: (err) => console.error('Error saving profile', err)
      });
  }

  onChangePassword() {
    if (this.passwordForm.invalid) return;

    this.savingPassword = true;
    const { current_password, new_password } = this.passwordForm.value;

    this.authService.changePassword(current_password, new_password)
      .pipe(finalize(() => this.savingPassword = false))
      .subscribe({
        next: () => {
          this.showPasswordSection = false;
          this.passwordForm.reset();
          // Alert or Toast success
          alert('Contraseña actualizada exitosamente');
        },
        error: (err) => {
          console.error('Error updating password', err);
          alert('Error al actualizar contraseña. Verifica tu contraseña actual.');
        }
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

  getPasswordError(controlName: string): string {
    const control = this.passwordForm.get(controlName);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Requerido';
      if (control.errors['minlength']) return 'Mínimo 6 caracteres';
      if (control.errors['passwordMismatch']) return 'Las contraseñas no coinciden';
    }
    return '';
  }

  passwordMatchValidator(g: FormGroup) {
    return g.get('new_password')?.value === g.get('confirm_password')?.value
      ? null : { 'passwordMismatch': true };
  }

  getInitials(): string {
    if (!this.userInfo) return '';
    const first = this.userInfo.first_name ? this.userInfo.first_name.charAt(0) : '';
    const last = this.userInfo.last_name ? this.userInfo.last_name.charAt(0) : '';
    return (first + last).toUpperCase();
  }
}
