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
import { HttpClient } from '@angular/common/http';
import { ModalComponent } from '../modal/modal.component';
import { AuthService } from '../../../core/services/auth.service';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { finalize, take } from 'rxjs';
import { ButtonComponent } from '../button/button.component';
import { InputComponent } from '../input/input.component';
import { SelectorComponent, SelectorOption } from '../selector/selector.component';
import { ToastService } from '../toast/toast.service';
import { IconComponent } from '../icon/icon.component';
import {
  CountryService,
  Country,
  Department,
  City,
} from '../../../services/country.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-profile-modal',
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
      [(isOpen)]="isOpen"
      [title]="isEditing ? 'Editar Perfil' : ''"
      [subtitle]="isEditing ? 'Actualiza tu información personal' : ''"
      [size]="'lg'"
      (closed)="onClose()"
      (opened)="onOpen()"
    >
      <div *ngIf="!isEditing; else editMode">
        <!-- ═══ VISTA DE PERFIL (Mobile-First) ═══ -->

        <!-- Profile Header — centered card -->
        <div class="flex flex-col items-center text-center pt-2 pb-5">
          <div class="w-20 h-20 md:w-24 md:h-24 rounded-xl overflow-hidden border-2 border-primary-200 mb-3">
            <img
              *ngIf="userInfo?.avatar_url"
              [src]="userInfo.avatar_url"
              alt="Avatar"
              class="w-full h-full object-contain"
            />
            <div
              *ngIf="!userInfo?.avatar_url"
              class="w-full h-full bg-primary-100 flex items-center justify-center text-primary-600 text-2xl md:text-3xl font-bold"
            >
              {{ getInitials() }}
            </div>
          </div>
          <h3 class="text-lg font-semibold text-gray-900">
            {{ userInfo?.first_name }} {{ userInfo?.last_name }}
          </h3>
          <p class="text-sm text-gray-500">{{ userInfo?.email }}</p>
        </div>

        <!-- Información Personal — icon rows -->
        <div class="space-y-2 mb-5">
          <h4 class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-1">
            Información Personal
          </h4>
          <div class="bg-gray-50 rounded-xl border border-gray-100 divide-y divide-gray-100">
            <!-- Teléfono -->
            <div class="flex items-center gap-3 px-4 py-3">
              <app-icon name="phone" [size]="18" class="text-gray-400 flex-shrink-0"></app-icon>
              <div class="min-w-0">
                <p class="text-[11px] text-gray-400 leading-tight">Teléfono</p>
                <p class="text-sm text-gray-900 truncate">{{ userInfo?.phone || 'No registrado' }}</p>
              </div>
            </div>
            <!-- Documento -->
            <div class="flex items-center gap-3 px-4 py-3">
              <app-icon name="file-text" [size]="18" class="text-gray-400 flex-shrink-0"></app-icon>
              <div class="min-w-0">
                <p class="text-[11px] text-gray-400 leading-tight">Documento</p>
                <p
                  *ngIf="userInfo?.document_type && userInfo?.document_number"
                  class="text-sm text-gray-900 truncate"
                >
                  {{ userInfo?.document_type | uppercase }} {{ userInfo?.document_number }}
                </p>
                <p
                  *ngIf="!userInfo?.document_type || !userInfo?.document_number"
                  class="text-sm text-gray-400 italic"
                >
                  No registrado
                </p>
              </div>
            </div>
            <!-- Miembro desde -->
            <div class="flex items-center gap-3 px-4 py-3">
              <app-icon name="calendar" [size]="18" class="text-gray-400 flex-shrink-0"></app-icon>
              <div class="min-w-0">
                <p class="text-[11px] text-gray-400 leading-tight">Miembro desde</p>
                <p class="text-sm text-gray-900">{{ userInfo?.created_at | date: 'mediumDate' }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Dirección — compact card -->
        <div class="space-y-2 mb-5">
          <h4 class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-1">
            Dirección
          </h4>
          <div class="bg-gray-50 rounded-xl border border-gray-100">
            <div *ngIf="hasAddress; else noAddress">
              <div class="flex items-start gap-3 px-4 py-3">
                <app-icon name="map-pin" [size]="18" class="text-gray-400 flex-shrink-0 mt-0.5"></app-icon>
                <div class="min-w-0">
                  <p class="text-sm text-gray-900">{{ addressInfo?.address_line_1 }}</p>
                  <p *ngIf="addressInfo?.address_line_2" class="text-sm text-gray-500">
                    {{ addressInfo?.address_line_2 }}
                  </p>
                  <p class="text-xs text-gray-400 mt-1">
                    {{ addressInfo?.city }}<span *ngIf="addressInfo?.state">, {{ addressInfo?.state }}</span>
                  </p>
                  <p class="text-xs text-gray-400">
                    {{ addressInfo?.country }}
                    <span *ngIf="addressInfo?.postal_code"> · {{ addressInfo?.postal_code }}</span>
                  </p>
                </div>
              </div>
            </div>
            <ng-template #noAddress>
              <div class="flex flex-col items-center py-6 px-4">
                <app-icon name="map-pin" [size]="24" class="text-gray-300 mb-2"></app-icon>
                <p class="text-sm text-gray-400 mb-2">No hay dirección registrada</p>
                <button
                  type="button"
                  class="text-sm font-medium text-primary-600 hover:text-primary-700"
                  (click)="enableEditMode()"
                >
                  Agregar dirección
                </button>
              </div>
            </ng-template>
          </div>
        </div>

        <!-- Cuenta — icon rows -->
        <div class="space-y-2 mb-2">
          <h4 class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-1">
            Cuenta
          </h4>
          <div class="bg-gray-50 rounded-xl border border-gray-100 divide-y divide-gray-100">
            <!-- Username -->
            <div class="flex items-center gap-3 px-4 py-3">
              <app-icon name="user" [size]="18" class="text-gray-400 flex-shrink-0"></app-icon>
              <div class="min-w-0 flex-grow">
                <p class="text-[11px] text-gray-400 leading-tight">Usuario</p>
                <p class="text-sm text-gray-900 truncate">{{ userInfo?.username || userInfo?.email }}</p>
              </div>
            </div>
            <!-- Change password trigger -->
            <div class="px-4 py-3">
              <button
                type="button"
                class="flex items-center gap-3 text-sm font-medium w-full"
                [class]="showPasswordSection ? 'text-gray-500' : 'text-primary-600 hover:text-primary-700'"
                (click)="togglePasswordSection()"
              >
                <app-icon name="lock" [size]="18" class="flex-shrink-0"></app-icon>
                <span *ngIf="!showPasswordSection">Cambiar contraseña</span>
                <span *ngIf="showPasswordSection">Cancelar cambio</span>
              </button>
            </div>
          </div>

          <!-- Password form (expandable) -->
          <div
            *ngIf="showPasswordSection"
            class="bg-white border border-gray-200 rounded-xl p-4"
          >
            <form
              [formGroup]="passwordForm"
              (ngSubmit)="onChangePassword()"
              class="space-y-3"
            >
              <app-input
                label="Contraseña Actual"
                formControlName="current_password"
                type="password"
                placeholder="••••••"
                [error]="getPasswordError('current_password')"
              ></app-input>
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
              <div class="flex justify-end pt-1">
                <app-button
                  variant="primary"
                  type="submit"
                  [loading]="savingPassword"
                  [disabled]="passwordForm.invalid"
                >
                  Actualizar
                </app-button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- ═══ MODO EDICIÓN ═══ -->
      <ng-template #editMode>
        <form
          [formGroup]="profileForm"
          (ngSubmit)="onSubmit()"
          class="space-y-5"
        >
          <!-- Foto de Perfil -->
          <div class="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-4">
            <div
              class="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-primary-200 cursor-pointer group flex-shrink-0"
              (click)="avatarInput.click()"
            >
              <img
                *ngIf="avatarPreview || userInfo?.avatar_url"
                [src]="avatarPreview || userInfo?.avatar_url"
                alt="Avatar"
                class="w-full h-full object-contain"
              />
              <div
                *ngIf="!avatarPreview && !userInfo?.avatar_url"
                class="w-full h-full bg-primary-100 flex items-center justify-center text-primary-600 text-2xl font-bold"
              >
                {{ getInitials() }}
              </div>
              <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <app-icon name="camera" [size]="20" class="text-white"></app-icon>
              </div>
            </div>
            <input
              #avatarInput
              type="file"
              accept="image/*"
              class="hidden"
              (change)="onAvatarSelected($event)"
            />
            <div class="flex flex-col items-center sm:items-start gap-1">
              <button
                type="button"
                class="text-primary-600 hover:text-primary-700 text-sm font-medium"
                (click)="avatarInput.click()"
                [disabled]="uploadingAvatar"
              >
                {{ uploadingAvatar ? 'Subiendo...' : 'Cambiar foto' }}
              </button>
              <span class="text-xs text-gray-400">JPG, PNG o WebP. Máx 5MB</span>
              <button
                *ngIf="avatarPreview || userInfo?.avatar_url"
                type="button"
                class="text-red-500 hover:text-red-600 text-xs font-medium"
                (click)="removeAvatar()"
                [disabled]="uploadingAvatar"
              >
                Eliminar foto
              </button>
            </div>
          </div>

          <div class="border-t border-gray-100"></div>

          <!-- Información Personal -->
          <div class="space-y-3">
            <h4 class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Información Personal
            </h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                type="tel"
                placeholder="+57 300 123 4567"
                [error]="getError('phone')"
              ></app-input>
              <app-selector
                [label]="'Tipo de Documento'"
                formControlName="document_type"
                [styleVariant]="'modern'"
                [placeholder]="'Selecciona tipo'"
                [options]="documentTypeOptions"
              ></app-selector>
              <app-input
                [label]="'Número de Documento'"
                formControlName="document_number"
                [styleVariant]="'modern'"
                [placeholder]="'12345678'"
              ></app-input>
            </div>
          </div>

          <div class="border-t border-gray-100"></div>

          <!-- Dirección -->
          <div formGroupName="address" class="space-y-3">
            <h4 class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Dirección
            </h4>
            <div class="grid grid-cols-1 gap-3">
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
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <app-selector
                  [label]="'País'"
                  formControlName="country_code"
                  [styleVariant]="'modern'"
                  [placeholder]="'Selecciona un país'"
                  [options]="countryOptions"
                  [errorText]="getAddressError('country_code')"
                ></app-selector>
                <app-selector
                  [label]="'Departamento'"
                  formControlName="state_province"
                  [styleVariant]="'modern'"
                  [placeholder]="'Selecciona un departamento'"
                  [options]="departmentOptions"
                  [errorText]="getAddressError('state_province')"
                ></app-selector>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <app-selector
                  [label]="'Ciudad'"
                  formControlName="city"
                  [styleVariant]="'modern'"
                  [placeholder]="'Selecciona una ciudad'"
                  [options]="cityOptions"
                  [errorText]="getAddressError('city')"
                ></app-selector>
                <app-input
                  [label]="'Código Postal'"
                  formControlName="postal_code"
                  [styleVariant]="'modern'"
                  [placeholder]="'00000'"
                  [error]="getAddressError('postal_code')"
                ></app-input>
              </div>
            </div>
          </div>
        </form>
      </ng-template>

      <!-- ═══ FOOTER ═══ -->
      <div slot="footer" class="grid gap-2 sm:flex sm:justify-end sm:gap-3 w-full">
        <ng-container *ngIf="!isEditing">
          <app-button class="order-1 sm:order-2" variant="primary" iconName="edit" [fullWidth]="true" (click)="enableEditMode()">
            Editar Perfil
          </app-button>
          <app-button class="order-2 sm:order-1 sm:!w-auto" variant="secondary" [fullWidth]="true" (click)="onClose()">
            Cerrar
          </app-button>
        </ng-container>
        <ng-container *ngIf="isEditing">
          <app-button class="order-1 sm:order-2" variant="primary" [fullWidth]="true" (click)="onSubmit()" [loading]="saving" [disabled]="profileForm.invalid">
            Guardar Cambios
          </app-button>
          <app-button class="order-2 sm:order-1 sm:!w-auto" variant="secondary" [fullWidth]="true" (click)="cancelEditMode()">
            Cancelar
          </app-button>
        </ng-container>
      </div>
    </app-modal>
  `,
  styles: [],
})
export class ProfileModalComponent implements OnInit {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();

  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
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

  // Avatar upload state
  avatarPreview: string | null = null;
  uploadingAvatar = false;
  pendingAvatarKey: string | null = null;

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
      avatar_url: [''],
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
    // Reset avatar state
    this.avatarPreview = null;
    this.pendingAvatarKey = null;

    // Ensure form is populated with current data
    if (this.userInfo) {
      this.profileForm.patchValue({
        first_name: this.userInfo.first_name,
        last_name: this.userInfo.last_name,
        email: this.userInfo.email,
        phone: this.userInfo.phone,
        document_type: this.userInfo.document_type,
        document_number: this.userInfo.document_number,
        avatar_url: '', // Will be set only if changed
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
    this.avatarPreview = null;
    this.pendingAvatarKey = null;
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

    // Build payload
    const payload: any = {
      first_name: formValue.first_name,
      last_name: formValue.last_name,
      phone: formValue.phone,
      document_type: formValue.document_type,
      document_number: formValue.document_number,
      address: {
        address_line_1: addressData.address_line_1,
        address_line_2: addressData.address_line_2,
        country: addressData.country_code,
        state: addressData.state_province,
        city: addressData.city,
        postal_code: addressData.postal_code,
      },
    };

    // Handle avatar_url: only include if changed
    if (this.pendingAvatarKey) {
      // New avatar was uploaded
      payload.avatar_url = this.pendingAvatarKey;
    } else if (formValue.avatar_url === null) {
      // Avatar was explicitly removed
      payload.avatar_url = null;
    }
    // If neither condition is true, avatar_url is not included in payload (unchanged)

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

  get documentTypeOptions(): SelectorOption[] {
    return this.documentTypes.map(t => ({ value: t.value, label: t.label }));
  }

  get countryOptions(): SelectorOption[] {
    return this.countries.map(c => ({ value: c.code, label: c.name }));
  }

  get departmentOptions(): SelectorOption[] {
    return this.departments.map(d => ({ value: d.id, label: d.name }));
  }

  get cityOptions(): SelectorOption[] {
    return this.cities.map(c => ({ value: c.id, label: c.name }));
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

  onAvatarSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      this.toastService.error('La imagen no debe superar los 5MB');
      return;
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      this.toastService.error('Solo se permiten imágenes JPG, PNG o WebP');
      return;
    }

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = () => {
      this.avatarPreview = reader.result as string;
    };
    reader.readAsDataURL(file);

    // Upload to S3
    this.uploadingAvatar = true;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entityType', 'avatars');

    this.http.post<any>(`${environment.apiUrl}/upload`, formData).subscribe({
      next: (response) => {
        // Store the key for saving later
        this.pendingAvatarKey = response.key;
        // Use the signed URL for preview
        this.avatarPreview = response.url;
        this.uploadingAvatar = false;
        this.toastService.success('Imagen cargada correctamente');
      },
      error: (err) => {
        console.error('Error uploading avatar:', err);
        this.avatarPreview = null;
        this.pendingAvatarKey = null;
        this.uploadingAvatar = false;
        this.toastService.error('Error al subir la imagen');
      },
    });

    // Reset input to allow selecting the same file again
    input.value = '';
  }

  removeAvatar() {
    this.avatarPreview = null;
    this.pendingAvatarKey = null;
    // Mark avatar for removal by setting to null in form
    this.profileForm.patchValue({ avatar_url: null });
  }
}
