import {
  Component,
  model,
  signal,
  inject,
  DestroyRef,
  OnInit,
  input,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  FormControl,
  Validators,
  AbstractControl,
} from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError } from 'rxjs';
import { StoreType } from '../../interfaces/store.interface';
import { OrganizationStoresService } from '../../services/organization-stores.service';
import { environment } from '../../../../../../../environments/environment';

import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
  IconComponent,
  SelectorComponent,
  ToggleComponent,
  SelectorOption,
} from '../../../../../../shared/components/index';
import { OperatingHoursPickerComponent, OperatingHoursValue } from '../operating-hours-picker/operating-hours-picker.component';
import { UserSelectComponent } from '../user-select/user-select.component';
import { ColorPickerComponent } from '../color-picker/color-picker.component';

export interface StoreCreateModalData {
  name: string;
  slug?: string;
  store_code?: string;
  store_type?: StoreType;
  website?: string;
  domain?: string;
  timezone?: string;
  is_active?: boolean;
  operating_hours?: OperatingHoursValue;
  manager_user_id?: number;
  address?: {
    address_line1: string;
    address_line2?: string;
    city: string;
    state_province?: string;
    postal_code?: string;
    country_code: string;
    phone_number?: string;
  };
  settings?: {
    currency_code?: string;
    color_primary?: string;
    color_secondary?: string;
    [key: string]: any;
  };
}

interface Tab {
  id: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-store-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    ToggleComponent,
    OperatingHoursPickerComponent,
    UserSelectComponent,
    ColorPickerComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalChange($event)"
      (cancel)="onCancel()"
      [size]="'xl'"
      title="Crear Nueva Tienda"
      subtitle="Completa los detalles para crear una nueva tienda en tu organización"
    >
      <!-- Info Banner -->
      <div class="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 mb-4">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
          <app-icon name="info" [size]="16" />
        </div>
        <div class="text-sm text-blue-900 leading-relaxed">
          Al crear la tienda, se creará automáticamente una
          <strong>bodega principal</strong>.
          Podrás modificarla luego desde <strong>Inventario &rarr; Bodegas</strong>.
        </div>
      </div>

      <!-- Tab Navigation -->
      <div class="mb-4">
        <nav class="flex gap-1 bg-muted/50 rounded-xl p-1 border border-border overflow-x-auto">
          @for (tab of tabs; track tab.id) {
            <button
              type="button"
              (click)="setTab(tab.id)"
              [class]="
                activeTabId() === tab.id
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'text-text-secondary hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10'
              "
              class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap"
            >
              <app-icon [name]="tab.icon" [size]="14" />
              {{ tab.label }}
              @if (tab.id === 'manager' && managerUserIdControl.value) {
                <span class="w-2 h-2 rounded-full bg-green-400"></span>
              }
              @if (tab.id === 'schedule' && operatingHoursControl.value) {
                <span class="w-2 h-2 rounded-full bg-green-400"></span>
              }
            </button>
          }
        </nav>
      </div>

      <!-- Tab Content -->
      <div class="max-h-[60vh] overflow-y-auto pr-1">
        <form [formGroup]="storeForm" class="space-y-4">
          <!-- Tab: Básico -->
          @if (activeTabId() === 'basic') {
            <div class="space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  formControlName="name"
                  label="Nombre de la Tienda"
                  placeholder="Tienda Central"
                  [required]="true"
                  [control]="nameControl"
                  [error]="getErrorMessage(nameControl)"
                  size="md"
                >
                  <app-icon name="building" [size]="16" slot="prefix" />
                </app-input>

                <app-input
                  formControlName="store_code"
                  label="Código"
                  placeholder="TC001"
                  [control]="storeCodeControl"
                  [error]="getErrorMessage(storeCodeControl)"
                  [helperText]="storeCodeAvailable() ? 'Código disponible' : ''"
                  size="md"
                >
                  <app-icon name="hash" [size]="16" slot="prefix" />
                  @if (checkingCode()) {
                    <span slot="suffix" class="animate-spin text-text-secondary">
                      <app-icon name="loader" [size]="14" />
                    </span>
                  }
                </app-input>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  formControlName="slug"
                  label="Slug (URL)"
                  placeholder="tienda-central"
                  [control]="slugControl"
                  helperText="Generado automáticamente desde el nombre"
                  size="md"
                >
                  <app-icon name="link" [size]="16" slot="prefix" />
                </app-input>

                <app-selector
                  formControlName="store_type"
                  label="Tipo de Tienda"
                  [options]="storeTypeOptions"
                  [required]="true"
                  [errorText]="getErrorMessage(storeTypeControl)"
                  placeholder="Seleccionar tipo"
                  size="md"
                />
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  formControlName="website"
                  label="Sitio Web"
                  type="url"
                  placeholder="https://ejemplo.com"
                  [control]="websiteControl"
                  size="md"
                >
                  <app-icon name="globe" [size]="16" slot="prefix" />
                </app-input>

                <app-selector
                  formControlName="timezone"
                  label="Zona Horaria"
                  [options]="timezoneOptions"
                  placeholder="Seleccionar zona horaria"
                  size="md"
                />
              </div>

              <div class="flex items-center gap-4 pt-2">
                <app-toggle formControlName="is_active" label="Tienda activa" />
                <span class="text-sm text-text-secondary">
                  Las tiendas inactivas no serán visibles para los clientes
                </span>
              </div>
            </div>
          }

          <!-- Tab: Dirección -->
          @if (activeTabId() === 'address') {
            <div class="space-y-4">
              <app-input
                formControlName="address_line1"
                label="Dirección"
                placeholder="Carrera 7 # 72-01"
                [required]="true"
                [control]="addressLine1Control"
                [error]="getErrorMessage(addressLine1Control)"
                size="md"
              >
                <app-icon name="map-pin" [size]="16" slot="prefix" />
              </app-input>

              <app-input
                formControlName="address_line2"
                label="Complemento (opcional)"
                placeholder="Oficina 301, Torre A"
                [control]="addressLine2Control"
                size="md"
              >
                <app-icon name="plus" [size]="16" slot="prefix" />
              </app-input>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  formControlName="city"
                  label="Ciudad"
                  placeholder="Bogotá"
                  [required]="true"
                  [control]="cityControl"
                  [error]="getErrorMessage(cityControl)"
                  size="md"
                />

                <app-input
                  formControlName="state_province"
                  label="Departamento / Estado"
                  placeholder="Cundinamarca"
                  [control]="stateProvinceControl"
                  size="md"
                />
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <app-input
                  formControlName="postal_code"
                  label="Código Postal"
                  placeholder="110231"
                  [control]="postalCodeControl"
                  size="md"
                />

                <app-selector
                  formControlName="country_code"
                  label="País"
                  [options]="countryOptions"
                  placeholder="Seleccionar país"
                  size="md"
                />

                <app-input
                  formControlName="phone_number"
                  label="Teléfono"
                  type="tel"
                  placeholder="+57 300 123 4567"
                  [control]="phoneNumberControl"
                  size="md"
                >
                  <app-icon name="phone" [size]="16" slot="prefix" />
                </app-input>
              </div>
            </div>
          }

          <!-- Tab: Manager -->
          @if (activeTabId() === 'manager') {
            <div class="space-y-4">
              <div class="bg-muted/30 rounded-lg border border-border p-4">
                <h3 class="text-sm font-semibold text-text-primary mb-1 flex items-center gap-2">
                  <app-icon name="user" [size]="16" />
                  Responsable de la Tienda
                </h3>
                <p class="text-xs text-text-secondary mb-4">
                  Asigna un usuario como manager de esta tienda. El manager tendrá acceso privilegiado a la tienda.
                </p>

                <app-user-select
                  [value]="managerUserIdControl.value"
                  (valueChange)="onManagerChange($event)"
                  placeholder="Buscar por nombre o email..."
                />

                @if (managerUserIdControl.value) {
                  <div class="mt-3 flex items-center gap-2 text-xs text-green-600">
                    <app-icon name="check-circle" [size]="14" />
                    Manager asignado
                  </div>
                } @else {
                  <div class="mt-3 flex items-center gap-2 text-xs text-text-secondary">
                    <app-icon name="info" [size]="14" />
                    Sin manager asignado — puedes asignarlo después
                  </div>
                }
              </div>
            </div>
          }

          <!-- Tab: Horario -->
          @if (activeTabId() === 'schedule') {
            <div class="space-y-4">
              <div class="bg-muted/30 rounded-lg border border-border p-4">
                <h3 class="text-sm font-semibold text-text-primary mb-1 flex items-center gap-2">
                  <app-icon name="clock" [size]="16" />
                  Horario de Atención
                </h3>
                <p class="text-xs text-text-secondary mb-4">
                  Define los horarios de atención de la tienda por día de la semana.
                </p>
                <app-operating-hours-picker
                  [value]="operatingHoursControl.value"
                  (valueChange)="onOperatingHoursChange($event)"
                />
              </div>
            </div>
          }

          <!-- Tab: Branding -->
          @if (activeTabId() === 'branding') {
            <div class="space-y-6">
              <!-- Logo URL -->
              <app-input
                formControlName="logo_url"
                label="URL del Logo"
                type="url"
                placeholder="https://ejemplo.com/logo.png"
                [control]="logoUrlControl"
                size="md"
              >
                <app-icon name="image" [size]="16" slot="prefix" />
              </app-input>

              <!-- Color Primary -->
              <div class="bg-muted/30 rounded-lg border border-border p-4">
                <h3 class="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                  <app-icon name="palette" [size]="16" />
                  Colores de Marca
                </h3>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label class="block text-sm font-medium text-text-primary mb-2">
                      Color Primario
                    </label>
                    <app-color-picker
                      [value]="colorPrimaryControl.value || '#7ED7A5'"
                      (valueChange)="colorPrimaryControl.setValue($event)"
                    />
                  </div>

                  <div>
                    <label class="block text-sm font-medium text-text-primary mb-2">
                      Color Secundario
                    </label>
                    <app-color-picker
                      [value]="colorSecondaryControl.value || '#2F6F4E'"
                      (valueChange)="colorSecondaryControl.setValue($event)"
                    />
                  </div>
                </div>
              </div>

              <!-- Live Preview -->
              <div class="bg-muted/30 rounded-lg border border-border p-4">
                <h3 class="text-sm font-semibold text-text-primary mb-3">Vista Previa</h3>
                <div
                  class="rounded-xl p-6 border border-border text-white transition-all duration-300"
                  [style.background]="colorPrimaryControl.value || '#7ED7A5'"
                >
                  <div class="flex items-center gap-3 mb-4">
                    @if (storeForm.get('logo_url')?.value) {
                      <img
                        [src]="storeForm.get('logo_url')?.value"
                        alt="Logo"
                        class="w-10 h-10 rounded object-cover bg-white/20"
                      />
                    } @else {
                      <div
                        class="w-10 h-10 rounded flex items-center justify-center text-sm font-bold"
                        [style.background]="colorSecondaryControl.value || '#2F6F4E'"
                      >
                        {{ storeForm.get('name')?.value?.charAt(0)?.toUpperCase() || 'T' }}
                      </div>
                    }
                    <div>
                      <p class="font-semibold text-base">
                        {{ storeForm.get('name')?.value || 'Mi Tienda' }}
                      </p>
                      <p class="text-xs opacity-80">
                        {{ storeForm.get('store_type')?.value || 'physical' | titlecase }}
                      </p>
                    </div>
                  </div>
                  <div
                    class="inline-block rounded px-3 py-1 text-xs font-medium"
                    [style.background]="colorSecondaryControl.value || '#2F6F4E'"
                  >
                    Visitar tienda →
                  </div>
                </div>
              </div>
            </div>
          }

          <!-- Tab: Fiscal -->
          @if (activeTabId() === 'fiscal') {
            <div class="space-y-4">
              <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
                <app-icon name="alert-triangle" [size]="16" class="text-amber-600 shrink-0 mt-0.5" />
                <div class="text-xs text-amber-800">
                  <strong>Información DIAN (Colombia):</strong> La configuración fiscal completa
                  (NIT, certificado digital, software ID) se gestiona desde
                  <strong>Configuración → Facturación</strong>.
                </div>
              </div>

              <app-selector
                formControlName="currency_code"
                label="Moneda de Facturación"
                [options]="currencyOptions"
                placeholder="Seleccionar moneda"
                size="md"
              />

              <div class="flex items-center gap-4 pt-2">
                <app-toggle formControlName="tax_included" label="Precios incluyen impuestos en POS" />
              </div>

              <div class="bg-muted/30 rounded-lg border border-border p-4">
                <h3 class="text-sm font-semibold text-text-primary mb-3">Configuración Fiscal Avanzada</h3>
                <p class="text-xs text-text-secondary mb-3">
                  Una vez creada la tienda, puedes configurar la facturación electrónica:
                </p>
                <ul class="text-xs text-text-secondary space-y-1 list-disc list-inside">
                  <li>NIT y datos de contacto fiscal</li>
                  <li>Certificado digital DIAN</li>
                  <li>Resoluciones de facturación</li>
                  <li>Tipos de documento (FC, NC, ND)</li>
                </ul>
                <p class="text-xs text-primary mt-3 font-medium">
                  Ir a: Configuración → Facturación después de crear la tienda
                </p>
              </div>
            </div>
          }
        </form>
      </div>

      <!-- Footer -->
      <div slot="footer" class="flex justify-between items-center pt-4 border-t border-border">
        <div class="text-sm text-text-secondary">
          <span class="text-destructive">*</span> Campos requeridos
        </div>
        <div class="flex gap-3">
          <app-button
            variant="outline"
            (clicked)="onCancel()"
            [disabled]="isSubmitting()"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="storeForm.invalid || isSubmitting() || checkingCode()"
            [loading]="isSubmitting()"
          >
            <app-icon name="plus" [size]="16" slot="icon" />
            Crear Tienda
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
  styles: [`
    :host { display: block; }
  `],
})
export class StoreCreateModalComponent implements OnInit {
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);
  private storesService = inject(OrganizationStoresService);

  readonly isOpen = model<boolean>(false);
  readonly isSubmitting = input<boolean>(false);
  readonly cancel = output<void>();
  readonly submit = output<StoreCreateModalData>();

  readonly tabs: Tab[] = [
    { id: 'basic', label: 'Básico', icon: 'building' },
    { id: 'address', label: 'Dirección', icon: 'map-pin' },
    { id: 'manager', label: 'Manager', icon: 'user' },
    { id: 'schedule', label: 'Horario', icon: 'clock' },
    { id: 'branding', label: 'Branding', icon: 'palette' },
    { id: 'fiscal', label: 'Fiscal', icon: 'file-text' },
  ];

  readonly activeTabId = signal('basic');
  readonly checkingCode = signal(false);
  readonly storeCodeAvailable = signal(true);

  storeTypeOptions: SelectorOption[] = [];
  timezoneOptions: SelectorOption[] = [];
  currencyOptions: SelectorOption[] = [];

  countryOptions: SelectorOption[] = [
    { value: 'CO', label: 'Colombia' },
    { value: 'MX', label: 'México' },
    { value: 'US', label: 'Estados Unidos' },
    { value: 'ES', label: 'España' },
    { value: 'AR', label: 'Argentina' },
    { value: 'PE', label: 'Perú' },
    { value: 'CL', label: 'Chile' },
    { value: 'EC', label: 'Ecuador' },
    { value: 'VE', label: 'Venezuela' },
  ];

  storeForm!: FormGroup;

  private codeSubject = new Subject<string>();

  // Typed getters
  get nameControl(): FormControl<string> { return this.storeForm.get('name') as FormControl<string>; }
  get slugControl(): FormControl<string> { return this.storeForm.get('slug') as FormControl<string>; }
  get storeCodeControl(): FormControl<string> { return this.storeForm.get('store_code') as FormControl<string>; }
  get storeTypeControl(): FormControl<string> { return this.storeForm.get('store_type') as FormControl<string>; }
  get websiteControl(): FormControl<string> { return this.storeForm.get('website') as FormControl<string>; }
  get timezoneControl(): FormControl<string> { return this.storeForm.get('timezone') as FormControl<string>; }
  get isActiveControl(): FormControl<boolean> { return this.storeForm.get('is_active') as FormControl<boolean>; }
  get logoUrlControl(): FormControl<string | null> { return this.storeForm.get('logo_url') as FormControl<string | null>; }
  get colorPrimaryControl(): FormControl<string | null> { return this.storeForm.get('color_primary') as FormControl<string | null>; }
  get colorSecondaryControl(): FormControl<string | null> { return this.storeForm.get('color_secondary') as FormControl<string | null>; }
  get addressLine1Control(): FormControl<string> { return this.storeForm.get('address_line1') as FormControl<string>; }
  get addressLine2Control(): FormControl<string | null> { return this.storeForm.get('address_line2') as FormControl<string | null>; }
  get cityControl(): FormControl<string> { return this.storeForm.get('city') as FormControl<string>; }
  get stateProvinceControl(): FormControl<string | null> { return this.storeForm.get('state_province') as FormControl<string | null>; }
  get postalCodeControl(): FormControl<string | null> { return this.storeForm.get('postal_code') as FormControl<string | null>; }
  get countryCodeControl(): FormControl<string> { return this.storeForm.get('country_code') as FormControl<string>; }
  get phoneNumberControl(): FormControl<string | null> { return this.storeForm.get('phone_number') as FormControl<string | null>; }
  get managerUserIdControl(): FormControl<number | null> { return this.storeForm.get('manager_user_id') as FormControl<number | null>; }
  get operatingHoursControl(): FormControl<OperatingHoursValue | null> { return this.storeForm.get('operating_hours') as FormControl<OperatingHoursValue | null>; }
  get currencyCodeControl(): FormControl<string> { return this.storeForm.get('currency_code') as FormControl<string>; }
  get taxIncludedControl(): FormControl<boolean> { return this.storeForm.get('tax_included') as FormControl<boolean>; }

  ngOnInit(): void {
    this.initializeForm();
    this.loadOptions();
    this.setupAutoSlugGeneration();
    this.setupStoreCodeValidation();
  }

  private initializeForm(): void {
    this.storeForm = this.fb.group({
      // Basic
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(255)]],
      slug: [''],
      store_code: ['', [Validators.maxLength(20)]],
      store_type: [StoreType.PHYSICAL, [Validators.required]],
      website: [''],
      timezone: ['America/Bogota'],
      is_active: [true],
      // Address
      address_line1: [''],
      address_line2: [''],
      city: [''],
      state_province: [''],
      postal_code: [''],
      country_code: ['CO'],
      phone_number: [''],
      // Manager
      manager_user_id: [null],
      // Schedule
      operating_hours: [null],
      // Branding
      logo_url: [null],
      color_primary: ['#7ED7A5'],
      color_secondary: ['#2F6F4E'],
      // Fiscal
      currency_code: ['COP'],
      tax_included: [false],
    });
  }

  private async loadOptions(): Promise<void> {
    this.storeTypeOptions = this.storesService.getStoreTypeOptions();
    this.timezoneOptions = this.storesService.getTimezoneOptions();
    this.currencyOptions = await this.storesService.getCurrencyOptions();
  }

  private setupAutoSlugGeneration(): void {
    this.storeForm.get('name')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((name: string) => {
        const slugControl = this.storeForm.get('slug');
        if (name && !slugControl?.value) {
          slugControl?.setValue(this.generateSlug(name), { emitEvent: false });
        }
      });
  }

  private setupStoreCodeValidation(): void {
    this.codeSubject
      .pipe(
        debounceTime(400),
        distinctUntilChanged(),
        switchMap((code) => {
          if (!code || code.length < 2) {
            this.storeCodeAvailable.set(true);
            this.checkingCode.set(false);
            return of(null);
          }
          this.checkingCode.set(true);
          return this.http
            .get<any>(`${environment.apiUrl}/organization/stores/check-code?code=${encodeURIComponent(code)}`)
            .pipe(
              catchError(() => of({ success: true, data: { available: true } })),
            );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result: any) => {
        this.checkingCode.set(false);
        if (result) {
          this.storeCodeAvailable.set(result.success !== false && result.data?.available !== false);
        }
      });

    this.storeForm.get('store_code')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((code: string) => {
        if (code) {
          this.codeSubject.next(code);
        } else {
          this.storeCodeAvailable.set(true);
          this.checkingCode.set(false);
        }
      });
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  setTab(tabId: string): void {
    this.activeTabId.set(tabId);
  }

  onModalChange(isOpen: boolean): void {
    if (!isOpen) {
      this.resetForm();
    }
  }

  onCancel(): void {
    this.isOpen.set(false);
    this.cancel.emit();
  }

  onManagerChange(userId: number | null): void {
    this.managerUserIdControl.setValue(userId, { emitEvent: false });
  }

  onOperatingHoursChange(hours: OperatingHoursValue | null): void {
    this.operatingHoursControl.setValue(hours, { emitEvent: false });
  }

  onSubmit(): void {
    if (this.storeForm.invalid) {
      this.storeForm.markAllAsTouched();
      return;
    }
    if (this.checkingCode()) return;

    const v = this.storeForm.value;

    const address = v.address_line1
      ? {
          address_line1: v.address_line1,
          address_line2: v.address_line2 || null,
          city: v.city,
          state_province: v.state_province || null,
          postal_code: v.postal_code || null,
          country_code: v.country_code || 'CO',
          phone_number: v.phone_number || null,
        }
      : undefined;

    const storeData: StoreCreateModalData = {
      name: v.name,
      slug: v.slug || undefined,
      store_code: v.store_code || undefined,
      store_type: v.store_type,
      website: v.website || undefined,
      timezone: v.timezone || undefined,
      is_active: v.is_active,
      operating_hours: v.operating_hours || undefined,
      manager_user_id: v.manager_user_id || undefined,
      address,
      settings: {
        currency_code: v.currency_code || undefined,
        color_primary: v.color_primary || undefined,
        color_secondary: v.color_secondary || undefined,
      },
    };

    this.submit.emit(storeData);
  }

  private resetForm(): void {
    this.storeForm.reset({
      name: '',
      slug: '',
      store_code: '',
      store_type: StoreType.PHYSICAL,
      website: '',
      timezone: 'America/Bogota',
      is_active: true,
      address_line1: '',
      address_line2: '',
      city: '',
      state_province: '',
      postal_code: '',
      country_code: 'CO',
      phone_number: '',
      manager_user_id: null,
      operating_hours: null,
      logo_url: null,
      color_primary: '#7ED7A5',
      color_secondary: '#2F6F4E',
      currency_code: 'COP',
      tax_included: false,
    });
    this.activeTabId.set('basic');
    this.storeCodeAvailable.set(true);
    this.checkingCode.set(false);
  }

  getErrorMessage(control: AbstractControl | null): string {
    if (!control || !control.errors || !control.touched) return '';
    const errors = control.errors;
    if (errors['required']) return 'Este campo es requerido';
    if (errors['minlength']) return `Mínimo ${errors['minlength'].requiredLength} caracteres`;
    if (errors['maxlength']) return `Máximo ${errors['maxlength'].requiredLength} caracteres`;
    if (errors['pattern']) return 'Formato inválido';
    if (errors['email']) return 'Email inválido';
    if (errors['storeCodeExists']) return 'Este código ya está en uso';
    return 'Valor inválido';
  }
}
