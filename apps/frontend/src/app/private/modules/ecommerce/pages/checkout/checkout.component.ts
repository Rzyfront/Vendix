import { Component, OnInit, OnDestroy, signal, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CartService, Cart } from '../../services/cart.service';
import { CheckoutService, PaymentMethod, CheckoutRequest } from '../../services/checkout.service';
import { AccountService, Address } from '../../services/account.service';
import { CatalogService, Product } from '../../services/catalog.service';
import { CountryService, Country, Department, City } from '../../../../../services/country.service';

import { ProductCarouselComponent } from '../../components/product-carousel/product-carousel.component';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal/product-quick-view-modal.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule, ProductCarouselComponent, ProductQuickViewModalComponent, InputComponent],
  templateUrl: './checkout.component.html',
  styleUrls: ['./checkout.component.scss'],
})
export class CheckoutComponent implements OnInit, OnDestroy {
  cart: Cart | null = null;
  payment_methods: PaymentMethod[] = [];
  addresses: Address[] = [];

  selected_payment_method_id: number | null = null;
  selected_address_id: number | null = null;
  use_new_address = false;

  address_form!: FormGroup;
  notes = '';

  is_loading = true;
  is_submitting = false;
  error_message = '';

  step = 1; // 1: Address, 2: Payment, 3: Confirm

  // Recommendations
  recommendedProducts = signal<Product[]>([]);
  quickViewOpen = false;
  selectedProductSlug: string | null = null;

  // Location data (Country API)
  countries: Country[] = [];
  departments: Department[] = [];
  cities: City[] = [];
  loading_departments = false;
  loading_cities = false;

  private destroy$ = new Subject<void>();
  private catalogService = inject(CatalogService);
  private countryService = inject(CountryService);
  private cdr = inject(ChangeDetectorRef);

  constructor(
    private cart_service: CartService,
    private checkout_service: CheckoutService,
    private account_service: AccountService,
    private router: Router,
    private fb: FormBuilder,
  ) {
    this.initForm();
  }

  ngOnInit(): void {
    this.setupLocationData();
    this.loadData();
    this.loadRecommendations();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  initForm(): void {
    this.address_form = this.fb.group({
      address_line1: ['', Validators.required],
      address_line2: [''],
      city: ['', Validators.required],
      state_province: [''],
      country_code: ['CO', Validators.required],
      postal_code: [''],
      phone_number: ['', Validators.required],
    });
  }

  private setupLocationData(): void {
    // Load countries
    this.countries = this.countryService.getCountries();

    // Setup listeners
    const countryControl = this.address_form.get('country_code');
    const depControl = this.address_form.get('state_province');
    const cityControl = this.address_form.get('city');

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

    // Load departments for default country
    this.loadDepartments();
  }

  private async loadDepartments(): Promise<void> {
    this.loading_departments = true;
    this.departments = await this.countryService.getDepartments();
    this.loading_departments = false;
    this.cdr.markForCheck();
  }

  private async loadCities(depId: number): Promise<void> {
    this.loading_cities = true;
    this.cities = await this.countryService.getCitiesByDepartment(depId);
    this.loading_cities = false;
    this.cdr.markForCheck();
  }

  loadData(): void {
    this.is_loading = true;

    // Load cart
    this.cart_service.cart$.pipe(takeUntil(this.destroy$)).subscribe((cart) => {
      this.cart = cart;
      if (!cart || cart.items.length === 0) {
        this.router.navigate(['/cart']);
      }
    });

    this.cart_service.getCart().subscribe();

    // Load payment methods
    this.checkout_service.getPaymentMethods().subscribe({
      next: (response) => {
        if (response.success) {
          this.payment_methods = response.data;
          if (this.payment_methods.length > 0) {
            this.selected_payment_method_id = this.payment_methods[0].id;
          }
        }
      },
    });

    // Load addresses
    this.account_service.getAddresses().subscribe({
      next: (response: any) => {
        if (response.success) {
          this.addresses = response.data;
          if (this.addresses.length > 0) {
            this.selected_address_id = this.addresses[0].id;
          } else {
            this.use_new_address = true;
          }
        }
        this.is_loading = false;
      },
      error: () => {
        this.is_loading = false;
        this.use_new_address = true;
      },
    });
  }

  loadRecommendations(): void {
    this.catalogService.getProducts({ limit: 10, sort_by: 'newest', has_discount: true }).subscribe({
      next: (response) => {
        if (response.data.length > 0) {
          this.recommendedProducts.set(response.data);
        } else {
          // Fallback if no sales
          this.catalogService.getProducts({ limit: 10, sort_by: 'newest' }).subscribe(res => {
            this.recommendedProducts.set(res.data);
          });
        }
      }
    });
  }

  selectAddress(address_id: number): void {
    this.selected_address_id = address_id;
    this.use_new_address = false;
  }

  selectNewAddress(): void {
    this.selected_address_id = null;
    this.use_new_address = true;
  }

  selectPaymentMethod(method_id: number): void {
    this.selected_payment_method_id = method_id;
  }

  // Shipping
  shipping_options: any[] = [];
  selected_shipping_method_id: number | null = null;
  selected_shipping_option_id: number | null = null;
  shipping_cost = 0;

  // ... (existing methods)

  // Modified logic: call this when address is finalized (e.g. Next from Address step)
  loadShippingOptions(): void {
    if (this.use_new_address && this.address_form.valid) {
      // Convert form to address object
      const address = this.mapFormToCalcAddress(this.address_form.value);
      this.fetchShipping(address);
    } else if (this.selected_address_id) {
      const address = this.addresses.find(a => a.id === this.selected_address_id);
      if (address) {
        this.fetchShipping(this.mapAddressToCalc(address));
      }
    }
  }

  private mapFormToCalcAddress(formValue: any): any {
    const address = { ...formValue };

    // For Colombia, convert department and city IDs to names
    if (address.country_code === 'CO') {
      // Convert department ID to name
      if (address.state_province) {
        const depId = Number(address.state_province);
        const department = this.departments.find(d => d.id === depId);
        if (department) {
          address.state_province = department.name;
        }
      }

      // Convert city ID to name
      if (address.city) {
        const cityId = Number(address.city);
        const city = this.cities.find(c => c.id === cityId);
        if (city) {
          address.city = city.name;
        }
      }
    }
    return address;
  }

  fetchShipping(address: any) {
    this.is_loading = true;
    this.cart_service.getShippingEstimates(address).subscribe({
      next: (options) => {
        this.shipping_options = options;
        if (options.length > 0) {
          // Default select first or cheapest?
          // Select first
          this.selectShippingMethod(options[0], options[0].cost);
        } else {
          this.selected_shipping_method_id = null;
          this.selected_shipping_option_id = null;
          this.shipping_cost = 0;
        }
        this.is_loading = false;
      },
      error: () => {
        this.is_loading = false;
        // Handle error
      }
    });
  }

  selectShippingMethod(option: any, cost: number) {
    this.selected_shipping_option_id = option.id;
    this.selected_shipping_method_id = option.method_id;
    this.shipping_cost = cost;
  }

  mapAddressToCalc(addr: Address) {
    return {
      country_code: addr.country_code,
      state_province: addr.state_province,
      city: addr.city,
      postal_code: addr.postal_code || undefined
    };
  }

  // Override nextStep to load shipping if moving from Step 1
  nextStep(): void {
    if (this.step === 1) {
      if (this.use_new_address && !this.address_form.valid) {
        this.error_message = 'Por favor completa la dirección de envío';
        return;
      }
      if (!this.use_new_address && !this.selected_address_id) {
        this.error_message = 'Por favor selecciona una dirección';
        return;
      }

      // Load shipping before moving? Or move to step 2 (Payment/Shipping)
      // If we move to step 2, we load shipping there.
      this.loadShippingOptions();
    }

    if (this.step === 2 && !this.selected_payment_method_id) {
      this.error_message = 'Por favor selecciona un método de pago';
      return;
    }

    // Check shipping selection
    if (this.step === 2 && this.shipping_options.length > 0 && !this.selected_shipping_method_id) {
      this.error_message = 'Por favor selecciona un método de envío';
      return;
    }

    this.error_message = '';
    this.step++;
  }

  prevStep(): void {
    this.step--;
  }

  placeOrder(): void {
    if (!this.selected_payment_method_id) {
      this.error_message = 'Por favor selecciona un método de pago';
      return;
    }

    this.is_submitting = true;
    this.error_message = '';

    const request: CheckoutRequest = {
      payment_method_id: this.selected_payment_method_id,
      notes: this.notes || undefined,
      shipping_method_id: this.selected_shipping_method_id || undefined,
      shipping_rate_id: this.selected_shipping_option_id || undefined
    };

    if (this.use_new_address) {
      // Convert IDs to names for backend compatibility
      let addressValue = { ...this.address_form.value };

      // For Colombia, convert department and city IDs to names
      if (addressValue.country_code === 'CO') {
        // Convert department ID to name
        if (addressValue.state_province) {
          const depId = Number(addressValue.state_province);
          const department = this.departments.find(d => d.id === depId);
          if (department) {
            addressValue.state_province = department.name;
          }
        }

        // Convert city ID to name
        if (addressValue.city) {
          const cityId = Number(addressValue.city);
          const city = this.cities.find(c => c.id === cityId);
          if (city) {
            addressValue.city = city.name;
          }
        }
      }

      request.shipping_address = addressValue;
    } else if (this.selected_address_id) {
      request.shipping_address_id = this.selected_address_id;
    }

    this.checkout_service.checkout(request).subscribe({
      next: (response) => {
        if (response.success) {
          this.router.navigate(['/account/orders', response.data.order_id], {
            queryParams: { success: true },
          });
        }
      },
      error: (err) => {
        this.is_submitting = false;
        this.error_message = err.error?.message || 'Error al procesar el pedido';
      },
    });
  }

  // ... (previous helper methods)


  goToCart(): void {
    this.router.navigate(['/cart']);
  }

  onQuickView(product: Product): void {
    this.selectedProductSlug = product.slug;
    this.quickViewOpen = true;
  }

  onAddToCartFromSlider(product: Product): void {
    const result = this.cart_service.addToCart(product.id, 1);
    if (result) result.subscribe();
  }

  // Helper getters for displaying selected location names in confirmation
  getSelectedCountryName(): string {
    const code = this.address_form.get('country_code')?.value;
    const country = this.countries.find(c => c.code === code);
    return country?.name || code || '';
  }

  getSelectedDepartmentName(): string {
    const depId = Number(this.address_form.get('state_province')?.value);
    const department = this.departments.find(d => d.id === depId);
    return department?.name || this.address_form.get('state_province')?.value || '';
  }

  getSelectedCityName(): string {
    const cityId = Number(this.address_form.get('city')?.value);
    const city = this.cities.find(c => c.id === cityId);
    return city?.name || this.address_form.get('city')?.value || '';
  }

  // Helper method for field validation errors
  getFieldError(fieldName: string): string {
    const control = this.address_form.get(fieldName);
    if (!control || !control.touched || !control.errors) {
      return '';
    }

    const errors = control.errors;
    if (errors['required']) {
      return 'Este campo es requerido';
    }
    if (errors['minlength']) {
      return `Mínimo ${errors['minlength'].requiredLength} caracteres`;
    }
    if (errors['pattern']) {
      return 'Formato inválido';
    }

    return '';
  }
}
