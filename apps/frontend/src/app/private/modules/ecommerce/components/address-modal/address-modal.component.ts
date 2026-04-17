import { Component, inject, DestroyRef, input, output, model, signal, computed } from '@angular/core';

import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AccountService, Address } from '../../services/account.service';
import { CountryService, Country, Department, City } from '../../../../../services/country.service';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { SelectorComponent, SelectorOption } from '../../../../../shared/components/selector/selector.component';
import { ToggleComponent } from '../../../../../shared/components/toggle/toggle.component';

export interface AddressModalData {
    mode: 'create' | 'edit';
    address?: Address;
}

@Component({
    selector: 'app-address-modal',
    standalone: true,
    imports: [ReactiveFormsModule, ModalComponent, ButtonComponent, IconComponent, InputComponent, SelectorComponent, ToggleComponent],
    templateUrl: './address-modal.component.html',
    styleUrls: ['./address-modal.component.scss'],
})
export class AddressModalComponent {
    private fb = inject(FormBuilder);
    private account_service = inject(AccountService);
    private destroy_ref = inject(DestroyRef);
    private country_service = inject(CountryService);

    // Modal state (two-way binding)
    readonly isOpen = model<boolean>(false);

    // Inputs
    readonly mode = input<'create' | 'edit'>('create');
    readonly address = input<Address | undefined>(undefined);
    readonly saved = output<Address>();

    // Form
    address_form!: FormGroup;

    // UI state — signals (Zoneless requires signals for template reactivity)
    readonly is_saving = signal(false);
    readonly error_message = signal('');

    // Location data — signals
    readonly countries = signal<Country[]>([]);
    readonly departments = signal<Department[]>([]);
    readonly cities = signal<City[]>([]);
    readonly loading_departments = signal(false);
    readonly loading_cities = signal(false);

    // Address type options for selector
    readonly address_type_options: SelectorOption[] = [
        { value: 'shipping', label: 'Envío' },
        { value: 'billing', label: 'Facturación' },
        { value: 'home', label: 'Casa' },
        { value: 'work', label: 'Trabajo' },
    ];

    // Computed options for selectors
    readonly country_options = computed<SelectorOption[]>(() =>
        this.countries().map((c) => ({ value: c.code, label: c.name })),
    );

    readonly department_options = computed<SelectorOption[]>(() =>
        this.departments().map((d) => ({ value: d.id, label: d.name })),
    );

    readonly city_options = computed<SelectorOption[]>(() =>
        this.cities().map((c) => ({ value: c.id, label: c.name })),
    );

    readonly title = computed(() =>
        this.mode() === 'create' ? 'Agregar dirección' : 'Editar dirección',
    );

    constructor() {
        // Load static countries
        this.countries.set(this.country_service.getCountries());

        this.initForm();
        this.setupLocationListeners();

        if (this.mode() === 'edit' && this.address()) {
            this.patchForm(this.address()!);
        }
    }

    private initForm(): void {
        this.address_form = this.fb.group({
            address_line1: ['', [Validators.required, Validators.minLength(5)]],
            address_line2: [''],
            city: ['', [Validators.required, Validators.minLength(2)]],
            state_province: [''],
            country_code: ['CO', Validators.required], // Default to Colombia
            postal_code: [''],
            phone_number: ['', [Validators.pattern(/^[\d+#*\s()-]*$/)]],
            is_primary: [false],
            type: ['shipping', Validators.required],
        });

        // Load departments for default country (Colombia)
        this.loadDepartments();
    }

    private setupLocationListeners(): void {
        const countryControl = this.address_form.get('country_code');
        const depControl = this.address_form.get('state_province');
        const cityControl = this.address_form.get('city');

        // Listener: Country Change
        countryControl?.valueChanges
            .pipe(takeUntilDestroyed(this.destroy_ref))
            .subscribe((code: string) => {
                if (code === 'CO') {
                    this.loadDepartments();
                } else {
                    // Clear downstream data for non-Colombia countries
                    this.departments.set([]);
                    this.cities.set([]);
                    depControl?.setValue('');
                    cityControl?.setValue('');
                }
            });

        // Listener: Department Change
        depControl?.valueChanges
            .pipe(takeUntilDestroyed(this.destroy_ref))
            .subscribe((depId: unknown) => {
                if (depId) {
                    const numericDepId = Number(depId);
                    if (!isNaN(numericDepId)) {
                        this.loadCities(numericDepId);
                    }
                } else {
                    this.cities.set([]);
                    cityControl?.setValue('');
                }
            });
    }

    private async loadDepartments(): Promise<void> {
        this.loading_departments.set(true);
        const deps = await this.country_service.getDepartments();
        this.departments.set(deps);
        this.loading_departments.set(false);
    }

    private async loadCities(depId: number): Promise<void> {
        this.loading_cities.set(true);
        const cities = await this.country_service.getCitiesByDepartment(depId);
        this.cities.set(cities);
        this.loading_cities.set(false);
    }

    private async patchForm(address: Address): Promise<void> {
        const countryCode = address.country_code || 'CO';

        // Basic form values
        this.address_form.patchValue({
            address_line1: address.address_line1,
            address_line2: address.address_line2 || '',
            city: address.city,
            state_province: address.state_province || '',
            country_code: countryCode,
            postal_code: address.postal_code || '',
            phone_number: address.phone_number || '',
            is_primary: address.is_primary,
            type: address.type || 'shipping',
        });

        // If Colombia, load departments and cities for edit mode
        if (countryCode === 'CO') {
            await this.loadDepartments();

            const depValue = address.state_province;
            if (depValue) {
                const depId = Number(depValue);
                if (!isNaN(depId) && this.departments().some((d) => d.id === depId)) {
                    // It's a department ID, load cities
                    await this.loadCities(depId);

                    const cityValue = address.city;
                    if (cityValue) {
                        const cityId = Number(cityValue);
                        if (!isNaN(cityId) && this.cities().some((c) => c.id === cityId)) {
                            // It's a city ID, set the value
                            this.address_form.patchValue({ city: cityId }, { emitEvent: false });
                        }
                    }
                }
            }
        }
    }

    save(): void {
        if (this.address_form.invalid) {
            this.markFormGroupTouched(this.address_form);
            return;
        }

        this.is_saving.set(true);
        this.error_message.set('');

        let form_value = this.address_form.value;

        // For Colombia, convert IDs to names for backend compatibility
        if (form_value.country_code === 'CO') {
            // Convert department ID to name
            if (form_value.state_province) {
                const depId = Number(form_value.state_province);
                const department = this.departments().find((d) => d.id === depId);
                if (department) {
                    form_value = { ...form_value, state_province: department.name };
                }
            }

            // Convert city ID to name
            if (form_value.city) {
                const cityId = Number(form_value.city);
                const city = this.cities().find((c) => c.id === cityId);
                if (city) {
                    form_value = { ...form_value, city: city.name };
                }
            }
        }

        let operation: Observable<{ success: boolean; data: Address }>;

        if (this.mode() === 'create') {
            operation = this.account_service.createAddress(form_value as Omit<Address, 'id'>);
        } else {
            operation = this.account_service.updateAddress(this.address()!.id, form_value);
        }

        operation.pipe(takeUntilDestroyed(this.destroy_ref)).subscribe({
            next: (response) => {
                if (response.success) {
                    this.saved.emit(response.data);
                    this.close();
                }
                this.is_saving.set(false);
            },
            error: (err) => {
                this.error_message.set(err.error?.message || 'Error al guardar la dirección');
                this.is_saving.set(false);
            },
        });
    }

    close(): void {
        this.isOpen.set(false);
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

    // Getters for template validation
    get f() {
        return this.address_form.controls;
    }
}
