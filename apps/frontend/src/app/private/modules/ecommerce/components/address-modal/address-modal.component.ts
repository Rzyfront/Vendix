import { Component, OnInit, inject, DestroyRef, Input, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AccountService, Address } from '../../services/account.service';
import { CountryService, Country, Department, City } from '../../../../../services/country.service';

export interface AddressModalData {
    mode: 'create' | 'edit';
    address?: Address;
}

@Component({
    selector: 'app-address-modal',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './address-modal.component.html',
    styleUrls: ['./address-modal.component.scss'],
})
export class AddressModalComponent implements OnInit {
    private fb = inject(FormBuilder);
    private account_service = inject(AccountService);
    private destroy_ref = inject(DestroyRef);
    private country_service = inject(CountryService);
    private cdr = inject(ChangeDetectorRef);

    // Inputs
    @Input() mode: 'create' | 'edit' = 'create';
    @Input() address?: Address;
    @Input() onClose = () => {};
    @Input() onSave = (address: Address) => {};

    // Form
    address_form!: FormGroup;
    is_saving = false;
    error_message = '';

    // UI state
    is_open = false;

    // Location data
    countries: Country[] = [];
    departments: Department[] = [];
    cities: City[] = [];
    loading_departments = false;
    loading_cities = false;

    // Address type options
    address_types = [
        { value: 'shipping', label: 'Envío' },
        { value: 'billing', label: 'Facturación' },
        { value: 'home', label: 'Casa' },
        { value: 'work', label: 'Trabajo' },
    ];

    ngOnInit(): void {
        // Load static countries
        this.countries = this.country_service.getCountries();

        this.initForm();
        this.setupLocationListeners();

        if (this.mode === 'edit' && this.address) {
            this.patchForm(this.address);
        }
        // Small delay for animation
        setTimeout(() => {
            this.is_open = true;
        }, 10);
    }

    private initForm(): void {
        this.address_form = this.fb.group({
            address_line1: ['', [Validators.required, Validators.minLength(5)]],
            address_line2: [''],
            city: ['', [Validators.required, Validators.minLength(2)]],
            state_province: [''],
            country_code: ['CO', Validators.required], // Default to Colombia
            postal_code: [''],
            phone_number: ['', [Validators.pattern(/^[0-9+\-\s()]*$/)]],
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
        countryControl?.valueChanges.subscribe((code: string) => {
            if (code === 'CO') {
                this.loadDepartments();
            } else {
                // Clear downstream data for non-Colombia countries
                this.departments = [];
                this.cities = [];
                depControl?.setValue('');
                cityControl?.setValue('');
                this.cdr.markForCheck();
            }
        });

        // Listener: Department Change
        depControl?.valueChanges.subscribe((depId: any) => {
            if (depId) {
                const numericDepId = Number(depId);
                if (!isNaN(numericDepId)) {
                    this.loadCities(numericDepId);
                }
            } else {
                this.cities = [];
                cityControl?.setValue('');
                this.cdr.markForCheck();
            }
        });
    }

    private async loadDepartments(): Promise<void> {
        this.loading_departments = true;
        this.departments = await this.country_service.getDepartments();
        this.loading_departments = false;
        this.cdr.markForCheck();
    }

    private async loadCities(depId: number): Promise<void> {
        this.loading_cities = true;
        this.cities = await this.country_service.getCitiesByDepartment(depId);
        this.loading_cities = false;
        this.cdr.markForCheck();
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
                if (!isNaN(depId) && this.departments.some(d => d.id === depId)) {
                    // It's a department ID, load cities
                    await this.loadCities(depId);

                    const cityValue = address.city;
                    if (cityValue) {
                        const cityId = Number(cityValue);
                        if (!isNaN(cityId) && this.cities.some(c => c.id === cityId)) {
                            // It's a city ID, set the value
                            this.address_form.patchValue({ city: cityId }, { emitEvent: false });
                        }
                    }
                }
            }
            this.cdr.markForCheck();
        }
    }

    get title(): string {
        return this.mode === 'create' ? 'Agregar dirección' : 'Editar dirección';
    }

    save(): void {
        if (this.address_form.invalid) {
            this.markFormGroupTouched(this.address_form);
            return;
        }

        this.is_saving = true;
        this.error_message = '';
        this.clearErrors();

        let form_value = this.address_form.value;

        // For Colombia, convert IDs to names for backend compatibility
        if (form_value.country_code === 'CO') {
            // Convert department ID to name
            if (form_value.state_province) {
                const depId = Number(form_value.state_province);
                const department = this.departments.find(d => d.id === depId);
                if (department) {
                    form_value = { ...form_value, state_province: department.name };
                }
            }

            // Convert city ID to name
            if (form_value.city) {
                const cityId = Number(form_value.city);
                const city = this.cities.find(c => c.id === cityId);
                if (city) {
                    form_value = { ...form_value, city: city.name };
                }
            }
        }

        let operation: Observable<{ success: boolean; data: Address }>;

        if (this.mode === 'create') {
            operation = this.account_service.createAddress(form_value as Omit<Address, 'id'>);
        } else {
            operation = this.account_service.updateAddress(this.address!.id, form_value);
        }

        operation.pipe(takeUntilDestroyed(this.destroy_ref)).subscribe({
            next: (response) => {
                if (response.success) {
                    this.onSave(response.data);
                    this.close();
                }
                this.is_saving = false;
            },
            error: (err) => {
                this.error_message = err.error?.message || 'Error al guardar la dirección';
                this.is_saving = false;
            },
        });
    }

    close(): void {
        this.is_open = false;
        setTimeout(() => {
            this.onClose();
        }, 300); // Wait for animation
    }

    cancel(): void {
        this.close();
    }

    private clearErrors(): void {
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

    // Getters for template validation
    get f() {
        return this.address_form.controls;
    }
}
