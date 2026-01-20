import {
  Component,
  EventEmitter,
  inject,
  Input,
  OnInit,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ModalComponent } from '../modal/modal.component';
import { AuthService } from '../../../core/services/auth.service';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { finalize, take } from 'rxjs';
import { ButtonComponent } from '../button/button.component';
import { InputComponent } from '../input/input.component';
import { ToastService } from '../toast/toast.service';
import {
  CountryService,
  Country,
  Department,
  City,
} from '../../../services/country.service';

@Component({
  selector: 'app-profile-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
  ],
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
          <h4 class="text-lg font-medium text-gray-900 mb-4 border-b pb-2">
            Información Personal
          </h4>
          <div class="flex items-start gap-6">
            <!-- Foto / Placeholder -->
            <div class="flex-shrink-0">
              <div
                class="w-24 h-24 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-3xl font-bold border-2 border-primary-200"
              >
                {{ getInitials() }}
              </div>
            </div>

            <!-- Datos Personales -->
            <div class="space-y-3 flex-grow">
              <div>
                <label class="block text-sm font-medium text-gray-500"
                  >Nombre Completo</label
                >
                <div class="text-gray-900 font-medium">
                  {{ userInfo?.first_name }} {{ userInfo?.last_name }}
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-500"
                    >Email</label
                  >
                  <div class="text-gray-900">{{ userInfo?.email }}</div>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-500"
                    >Teléfono</label
                  >
                  <div class="text-gray-900">
                    {{ userInfo?.phone || 'No registrado' }}
                  </div>
                </div>
              </div>

              <!-- Documento y Fecha de Registro -->
              <div
                class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-100"
              >
                <div>
                  <label class="block text-sm font-medium text-gray-500"
                    >Documento</label
                  >
                  <div class="text-gray-900">
                    <span
                      *ngIf="
                        userInfo?.document_type && userInfo?.document_number
                      "
                    >
                      {{ userInfo?.document_type }}
                      {{ userInfo?.document_number }}
                    </span>
                    <span
                      *ngIf="
                        !userInfo?.document_type || !userInfo?.document_number
                      "
                      class="text-gray-400 italic"
                    >
                      No registrado
                    </span>
                  </div>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-500"
                    >Miembro desde</label
                  >
                  <div class="text-gray-900">
                    {{ userInfo?.created_at | date: 'mediumDate' }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Dirección -->
        <div class="mb-6">
          <h4 class="text-lg font-medium text-gray-900 mb-4 border-b pb-2">
            Dirección
          </h4>

          <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <div *ngIf="hasAddress; else noAddress" class="space-y-4">
              <!-- Calle Principal -->
              <div>
                <label
                  class="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1"
                  >Dirección</label
                >
                <div class="text-gray-900 font-medium">
                  {{ addressInfo?.address_line_1 }}
                </div>
                <div
                  class="text-gray-600 text-sm mt-1"
                  *ngIf="addressInfo?.address_line_2"
                >
                  {{ addressInfo?.address_line_2 }}
                </div>
              </div>

              <!-- Ciudad y Estado -->
              <div
                class="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-200 pt-3"
              >
                <div>
                  <label
                    class="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1"
                    >Ciudad</label
                  >
                  <div class="text-gray-900">{{ addressInfo?.city }}</div>
                </div>
                <div>
                  <label
                    class="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1"
                    >Estado / Provincia</label
                  >
                  <div class="text-gray-900">{{ addressInfo?.state }}</div>
                </div>
              </div>

              <!-- País y Código Postal -->
              <div
                class="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-200 pt-3"
              >
                <div>
                  <label
                    class="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1"
                    >País</label
                  >
                  <div class="text-gray-900">{{ addressInfo?.country }}</div>
                </div>
                <div>
                  <label
                    class="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1"
                    >Código Postal</label
                  >
                  <div class="text-gray-900">
                    {{ addressInfo?.postal_code }}
                  </div>
                </div>
              </div>
            </div>
            <ng-template #noAddress>
              <div class="text-center py-4">
                <p class="text-gray-500 italic mb-2">
                  No hay dirección registrada.
                </p>
                <button
                  class="text-primary-600 hover:text-primary-800 text-sm font-medium"
                  (click)="enableEditMode()"
                >
                  Agregar Dirección
                </button>
              </div>
            </ng-template>
          </div>
        </div>

        <!-- Datos de Cuenta / Password -->
        <div class="mb-6">
          <h4 class="text-lg font-medium text-gray-900 mb-4 border-b pb-2">
            Datos de Cuenta
          </h4>
          <div
            class="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200"
          >
            <div>
              <label class="block text-sm font-medium text-gray-500"
                >Nombre de Usuario</label
              >
              <div class="text-gray-900 font-medium">
                {{ userInfo?.username || userInfo?.email }}
              </div>
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
          <div
            *ngIf="showPasswordSection"
            class="mt-4 p-4 bg-white border border-gray-200 rounded-lg shadow-sm"
          >
            <form
              [formGroup]="passwordForm"
              (ngSubmit)="onChangePassword()"
              class="space-y-4"
            >
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
        <form
          [formGroup]="profileForm"
          (ngSubmit)="onSubmit()"
          class="space-y-6"
        >
          <!-- Información Personal -->
          <div>
            <h4 class="text-lg font-medium text-gray-900 mb-4">
              Información Personal
            </h4>
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

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1"
                  >Tipo de Documento</label
                >
                <select class="modal-input" formControlName="document_type">
                  <option value="">Selecciona tipo de documento</option>
                  <option
                    *ngFor="let type of documentTypes"
                    [value]="type.value"
                  >
                    {{ type.label }}
                  </option>
                </select>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1"
                  >Número de Documento</label
                >
                <input
                  class="modal-input"
                  type="text"
                  formControlName="document_number"
                  placeholder="12345678"
                />
              </div>
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

              <!-- País -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1"
                    >País</label
                  >
                  <select class="modal-input" formControlName="country_code">
                    <option value="">Selecciona un país</option>
                    <option
                      *ngFor="let country of countries"
                      [value]="country.code"
                    >
                      {{ country.name }}
                    </option>
                  </select>
                  <div
                    class="text-red-500 text-sm mt-1"
                    *ngIf="
                      profileForm.get('address')?.get('country_code')
                        ?.touched &&
                      profileForm.get('address')?.get('country_code')?.errors?.[
                        'required'
                      ]
                    "
                  >
                    Este campo es requerido
                  </div>
                </div>

                <!-- Departamento/Estado -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1"
                    >Departamento</label
                  >
                  <select class="modal-input" formControlName="state_province">
                    <option value="">Selecciona un departamento</option>
                    <option *ngFor="let dep of departments" [value]="dep.id">
                      {{ dep.name }}
                    </option>
                  </select>
                  <div
                    class="text-red-500 text-sm mt-1"
                    *ngIf="
                      profileForm.get('address')?.get('state_province')
                        ?.touched &&
                      profileForm.get('address')?.get('state_province')
                        ?.errors?.['required']
                    "
                  >
                    Este campo es requerido
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <!-- Ciudad -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1"
                    >Ciudad</label
                  >
                  <select class="modal-input" formControlName="city">
                    <option value="">Selecciona una ciudad</option>
                    <option *ngFor="let city of cities" [value]="city.id">
                      {{ city.name }}
                    </option>
                  </select>
                  <div
                    class="text-red-500 text-sm mt-1"
                    *ngIf="
                      profileForm.get('address')?.get('city')?.touched &&
                      profileForm.get('address')?.get('city')?.errors?.[
                        'required'
                      ]
                    "
                  >
                    Este campo es requerido
                  </div>
                </div>

                <!-- Código Postal -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1"
                    >Código Postal</label
                  >
                  <input
                    type="text"
                    class="modal-input"
                    formControlName="postal_code"
                    placeholder="00000"
                  />
                  <div
                    class="text-red-500 text-sm mt-1"
                    *ngIf="
                      profileForm.get('address')?.get('postal_code')?.touched &&
                      profileForm.get('address')?.get('postal_code')?.errors?.[
                        'required'
                      ]
                    "
                  >
                    Este campo es requerido
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      </ng-template>

      <!-- FOOTER GLOBAL -->
      <div slot="footer" class="flex justify-end gap-3 w-full">
        <ng-container *ngIf="!isEditing">
          <app-button variant="secondary" (click)="onClose()">
            Cerrar
          </app-button>
          <app-button variant="primary" (click)="enableEditMode()">
            Editar Perfil
          </app-button>
        </ng-container>

        <ng-container *ngIf="isEditing">
          <app-button variant="secondary" (click)="cancelEditMode()">
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
  `,
  styles: [
    `
      .modal-input {
        display: block;
        width: 100%;
        padding: 0.5rem 1rem;
        border: 2px solid #e5e7eb;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        transition: all 0.2s ease;
        background: white;
        box-sizing: border-box;
        line-height: 1.5;
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
      }

      .modal-input:focus {
        outline: none;
        border-color: var(--color-text-primary);
        box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.1);
      }

      .modal-input:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        background-color: #f9fafb;
      }

      .modal-input::placeholder {
        color: #9ca3af;
      }
    `,
  ],
})
export class ProfileModalComponent implements OnInit {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();

  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private authFacade = inject(AuthFacade);
  private countryService = inject(CountryService);
  private toastService = inject(ToastService);

  profileForm: FormGroup;
  passwordForm: FormGroup;

  loading = false;
  saving = false;
  savingPassword = false;
  isInitialLoad = true; // Flag to track initial profile load

  isEditing = false;
  showPasswordSection = false;

  userInfo: any = null;
  addressInfo: any = null;
  hasAddress = false;

  countries: Country[] = [];
  departments: Department[] = [];
  cities: City[] = [];

  // Document types for Colombia
  documentTypes = [
    { value: 'cc', label: 'Cédula de Ciudadanía' },
    { value: 'ce', label: 'Cédula de Extranjería' },
    { value: 'ti', label: 'Tarjeta de Identidad' },
    { value: 'nit', label: 'NIT' },
    { value: 'pas', label: 'Pasaporte' },
  ];

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
        country_code: ['', [Validators.required, Validators.maxLength(3)]],
        state_province: ['', Validators.required],
        city: ['', Validators.required],
        postal_code: ['', Validators.required],
      }),
    });

    this.passwordForm = this.fb.group(
      {
        current_password: ['', Validators.required],
        new_password: ['', [Validators.required, Validators.minLength(6)]],
        confirm_password: ['', Validators.required],
      },
      { validators: this.passwordMatchValidator },
    );
  }

  ngOnInit() {
    // Subscribe to user state to have immediate data
    this.authFacade.user$.subscribe((user) => {
      if (user) {
        this.updateLocalUserInfo(user);
      }
    });

    // Load countries for the selects
    this.countries = this.countryService.getCountries();

    // Setup cascade logic like onboarding
    const countryControl = this.profileForm.get('address.country_code');
    const depControl = this.profileForm.get('address.state_province');
    const cityControl = this.profileForm.get('address.city');

    if (countryControl && depControl && cityControl) {
      // Load departments when country changes to Colombia
      countryControl.valueChanges.subscribe((code: string) => {
        if (code === 'CO') {
          this.loadDepartments();
          depControl.enable(); // ✅ Enable department control
          if (depControl.value) {
            cityControl.enable(); // ✅ Enable city control if department selected
          }
        } else {
          this.departments = [];
          this.cities = [];
          depControl.setValue('');
          cityControl.setValue('');
          depControl.disable(); // ✅ Disable department control
          cityControl.disable(); // ✅ Disable city control
        }
      });

      // Load cities when department changes
      depControl.valueChanges.subscribe((depId: number) => {
        if (depId) {
          this.loadCities(depId);
          cityControl.enable(); // ✅ Enable city control
        } else {
          this.cities = [];
          cityControl.setValue('');
          cityControl.disable(); // ✅ Disable city control
        }
      });

      // Set initial disabled state
      if (countryControl.value === 'CO') {
        depControl.enable();
        if (depControl.value) {
          cityControl.enable();
        } else {
          cityControl.disable();
        }
      } else {
        depControl.disable();
        cityControl.disable();
      }

      // If Colombia is already selected, load departments
      if (countryControl.value === 'CO') {
        this.loadDepartments();
      }
    }
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
  }

  async enableEditMode() {
    this.isEditing = true;
    // Ensure form is populated with current data
    if (this.userInfo) {
      this.profileForm.patchValue({
        first_name: this.userInfo.first_name,
        last_name: this.userInfo.last_name,
        email: this.userInfo.email,
        phone: this.userInfo.phone,
        document_type: this.userInfo.document_type,
        document_number: this.userInfo.document_number,
      });
    }

    if (this.addressInfo) {
      // For editing, we need to convert names to IDs
      const countryCode = this.addressInfo?.country;

      let stateProvinceId = '';
      let cityId = '';

      if (countryCode === 'CO') {
        // Load departments first, then map names to IDs
        try {
          await this.loadDepartments();

          // Now find IDs corresponding to saved names
          const department = this.departments.find(
            (d) => d.name === this.addressInfo?.state,
          );

          if (department) {
            stateProvinceId = department.id.toString();

            // Load cities for this department
            await this.loadCities(department.id);

            // Once we have the cities, find the city
            const city = this.cities.find(
              (c) => c.name === this.addressInfo.city,
            );

            if (city) {
              cityId = city.id.toString();
            }
          }
        } catch (error) {
          console.error('Error loading location data:', error);
          // Continue without pre-filling location data
        }
      }

      this.profileForm.patchValue({
        address: {
          address_line_1: this.addressInfo.address_line_1,
          address_line_2: this.addressInfo.address_line_2,
          country_code: countryCode,
          state_province: stateProvinceId, // ID, not name
          city: cityId, // ID, not name
          postal_code: this.addressInfo.postal_code,
        },
      });
    }
  }

  cancelEditMode() {
    this.isEditing = false;
    this.loadProfile();
  }

  loadProfile() {
    // Prevent concurrent loads
    if (this.loading) {
      return;
    }

    // Don't call if not logged in to avoid 401 on startup or unauthorized access
    if (!this.authService.getToken()) {
      return;
    }

    this.loading = true;
    this.authService
      .getProfile()
      .pipe(
        finalize(() => {
          this.loading = false;
          this.isInitialLoad = false; // Mark initial load as complete
        }),
      )
      .subscribe({
        next: (response) => {
          const userData = response.data || response.user || response;
          this.updateLocalUserInfo(userData);
        },
        error: (err) => {
          console.error('Error loading profile:', err);

          // Durante carga inicial, no mostrar toasts para evitar molestar al usuario al cargar la página
          if (this.isInitialLoad) {
            // Solo loggear el error, no mostrar toast
            return;
          }

          // Para cargas posteriores (cuando el usuario interactúa), sí mostrar toasts
          if (
            err.message?.includes('Token refresh failed') ||
            err.message?.includes('logged out') ||
            !this.authService.getToken()
          ) {
            this.toastService.warning(
              'Tu sesión ha expirado. Inicia sesión nuevamente.',
            );
            return;
          }

          this.toastService.error(
            'No se pudieron cargar tus datos. Actualiza la página para intentarlo nuevamente.',
          );
        },
      });
  }

  updateLocalUserInfo(user: any) {
    if (!user) {
      return;
    }

    this.userInfo = user;

    // Handle addresses array - take primary address or first one
    if (
      user.addresses &&
      Array.isArray(user.addresses) &&
      user.addresses.length > 0
    ) {
      // Find primary address first, otherwise take the first one
      const primaryAddress =
        user.addresses.find((addr: any) => addr.is_primary) ||
        user.addresses[0];

      // Map backend field names to frontend expected names
      this.addressInfo = {
        address_line_1: primaryAddress.address_line1,
        address_line_2: primaryAddress.address_line2,
        city: primaryAddress.city,
        state: primaryAddress.state_province,
        country: primaryAddress.country_code,
        postal_code: primaryAddress.postal_code,
      };
      this.hasAddress = true;
    } else {
      this.addressInfo = null;
      this.hasAddress = false;
    }
  }

  onSubmit() {
    if (this.profileForm.invalid) return;

    this.saving = true;
    const formValue = this.profileForm.value;

    // Convert IDs back to names for backend
    const addressData = { ...formValue.address };

    // Find department name from ID
    if (addressData.state_province) {
      const department = this.departments.find(
        (d) => d.id.toString() === addressData.state_province,
      );
      if (department) {
        addressData.state_province = department.name;
      }
    }

    // Find city name from ID
    if (addressData.city) {
      const city = this.cities.find(
        (c) => c.id.toString() === addressData.city,
      );
      if (city) {
        addressData.city = city.name;
      }
    }

    const payload = {
      ...formValue,
      address: {
        address_line_1: addressData.address_line_1,
        address_line_2: addressData.address_line_2,
        country: addressData.country_code,
        state: addressData.state_province,
        city: addressData.city,
        postal_code: addressData.postal_code,
      },
    };

    this.authService
      .updateProfile(payload)
      .pipe(finalize(() => (this.saving = false)))
      .subscribe({
        next: (response) => {
          this.isEditing = false;
          this.loadProfile();
          this.toastService.success('¡Perfil guardado correctamente!');
        },
        error: (err) => {
          // Detectar cuando el AuthInterceptor hizo logout automático por token expirado
          if (
            err.message?.includes('Token refresh failed') ||
            err.message?.includes('logged out') ||
            !this.authService.getToken()
          ) {
            this.toastService.warning(
              'Tu sesión ha expirado. Inicia sesión nuevamente.',
            );
            return;
          }

          // Mostrar mensaje más específico al usuario
          if (err.error?.message) {
            this.toastService.error(err.error.message);
          } else if (err.error?.errors) {
            this.toastService.error(
              'Algunos campos tienen información incorrecta. Revisa y corrige los datos marcados.',
            );
          } else {
            this.toastService.error(
              'No se pudo guardar el perfil. Verifica tu conexión a internet e intenta nuevamente.',
            );
          }
        },
      });
  }

  onChangePassword() {
    if (this.passwordForm.invalid) return;

    this.savingPassword = true;
    const { current_password, new_password } = this.passwordForm.value;

    this.authService
      .changePassword(current_password, new_password)
      .pipe(finalize(() => (this.savingPassword = false)))
      .subscribe({
        next: () => {
          this.showPasswordSection = false;
          this.passwordForm.reset();
          this.toastService.success('Contraseña actualizada exitosamente');
        },
        error: (err) => {
          console.error('Error updating password', err);
          this.toastService.error(
            'Error al actualizar contraseña. Verifica tu contraseña actual.',
          );
        },
      });
  }

  togglePasswordSection() {
    this.showPasswordSection = !this.showPasswordSection;
    if (!this.showPasswordSection) {
      this.passwordForm.reset();
    }
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
    const control = this.profileForm.get(`address.${controlName}`);
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
      if (control.errors['passwordMismatch'])
        return 'Las contraseñas no coinciden';
    }
    return '';
  }

  async loadDepartments(): Promise<void> {
    try {
      this.departments = await this.countryService.getDepartments();
    } catch (error) {
      console.error('Error loading departments', error);
      this.departments = [];
    }
  }

  async loadCities(departmentId: number): Promise<void> {
    try {
      this.cities =
        await this.countryService.getCitiesByDepartment(departmentId);
    } catch (error) {
      console.error('Error loading cities', error);
      this.cities = [];
    }
  }

  passwordMatchValidator(g: FormGroup) {
    return g.get('new_password')?.value === g.get('confirm_password')?.value
      ? null
      : { passwordMismatch: true };
  }

  getInitials(): string {
    if (!this.userInfo) return '';
    const first = this.userInfo?.first_name
      ? this.userInfo.first_name.charAt(0)
      : '';
    const last = this.userInfo?.last_name
      ? this.userInfo.last_name.charAt(0)
      : '';
    return (first + last).toUpperCase();
  }
}
