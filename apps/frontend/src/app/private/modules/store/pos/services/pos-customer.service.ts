import { Injectable, signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, delay, map, tap } from 'rxjs/operators';
import { HttpClient, HttpParams } from '@angular/common/http';
import { toObservable } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../environments/environment';
import {
  PosCustomer,
  CreatePosCustomerRequest,
  SearchCustomersRequest,
  PaginatedCustomersResponse,
  CustomerValidationError,
} from '../models/customer.model';

// Re-export types for component usage
export type {
  PosCustomer,
  CreatePosCustomerRequest,
  SearchCustomersRequest,
  PaginatedCustomersResponse,
  CustomerValidationError,
} from '../models/customer.model';

@Injectable({
  providedIn: 'root',
})
export class PosCustomerService {
  readonly customers = signal<PosCustomer[]>([]);
  readonly loading = signal<boolean>(false);
  readonly selectedCustomer = signal<PosCustomer | null>(null);

  private readonly apiUrl = `${environment.apiUrl}/store/customers`;
  private readonly registerUrl = `${environment.apiUrl}/store/customers`;

  constructor(private http: HttpClient) {
    // Initialize with mock data for development if needed
    // this.initializeMockData();
  }

  // Observable getters
  get customers$(): Observable<PosCustomer[]> {
    return toObservable(this.customers);
  }

  get loading$(): Observable<boolean> {
    return toObservable(this.loading);
  }

  get selectedCustomer$(): Observable<PosCustomer | null> {
    return toObservable(this.selectedCustomer);
  }

  /**
   * Quick customer creation for POS flow
   */
  createQuickCustomer(
    request: CreatePosCustomerRequest,
  ): Observable<PosCustomer> {
    this.loading.set(true);

    // Validate required fields
    const validationErrors = this.validateCustomerRequest(request);
    if (validationErrors.length > 0) {
      this.loading.set(false);
      return throwError(
        () => new Error(validationErrors.map((e) => e.message).join(', ')),
      );
    }

    // Call API to create customer
    return this.http.post<PosCustomer>(this.registerUrl, request).pipe(
      map((response: any) => this.mapApiCustomerToPosCustomer(response)),
      tap((customer) => {
        const currentCustomers = this.customers();
        this.customers.set([customer, ...currentCustomers]);
        this.selectCustomer(customer);
        this.loading.set(false);
      }),
      catchError((error) => {
        this.loading.set(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Search customers by query (email, name, phone, document)
   */
  searchCustomers(
    request: SearchCustomersRequest = {},
  ): Observable<PaginatedCustomersResponse> {
    this.loading.set(true);

    const { query = '', limit = 20, page = 1 } = request;
    let params = new HttpParams()
      .set('limit', limit.toString())
      .set('page', page.toString())
      .set('role', 'customer');

    if (query.trim()) {
      params = params.set('search', query.trim());
    }

    return this.http.get<any>(this.apiUrl, { params }).pipe(
      map((response) => {
        // Handle both wrapped response (response.data with meta) and direct response
        const customers = response.data || [];
        const meta = response.meta || {};

        return {
          data: customers.map((c: any) => this.mapApiCustomerToPosCustomer(c)),
          total: meta.total || response.total || 0,
          page: meta.page || response.page || page,
          limit: meta.limit || response.limit || limit,
          totalPages: meta.totalPages || response.totalPages || 0,
        };
      }),
      tap(() => this.loading.set(false)),
      catchError((error) => {
        this.loading.set(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Select a customer for the current POS transaction
   */
  selectCustomer(customer: PosCustomer | null): void {
    this.selectedCustomer.set(customer);
  }

  /**
   * Create a new customer
   */
  createCustomer(request: CreatePosCustomerRequest): Observable<PosCustomer> {
    this.loading.set(true);

    return this.http.post<PosCustomer>(this.registerUrl, request).pipe(
      map((response: any) => this.mapApiCustomerToPosCustomer(response)),
      tap((customer) => {
        // Add to local customers list
        const currentCustomers = this.customers();
        this.customers.set([...currentCustomers, customer]);
        this.loading.set(false);
      }),
      catchError((error) => {
        this.loading.set(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Get customer by ID
   */
  getCustomerById(id: number): Observable<PosCustomer | null> {
    const customer = this.customers().find((c) => c.id === id);
    return of(customer || null);
  }

  /**
   * Update customer information
   */
  updateCustomer(
    id: number,
    updates: Partial<CreatePosCustomerRequest>,
  ): Observable<PosCustomer> {
    this.loading.set(true);

    return of(updates).pipe(
      delay(250),
      map((updates) => {
        const currentCustomers = this.customers();
        const customerIndex = currentCustomers.findIndex((c) => c.id === id);

        if (customerIndex === -1) {
          throw new Error('Customer not found');
        }

        const updatedCustomer = {
          ...currentCustomers[customerIndex],
          ...updates,
          name:
            updates.first_name || updates.last_name
              ? `${updates.first_name || currentCustomers[customerIndex].first_name} ${updates.last_name || currentCustomers[customerIndex].last_name}`.trim()
              : currentCustomers[customerIndex].name,
          updated_at: new Date(),
        };

        currentCustomers[customerIndex] = updatedCustomer;
        this.customers.set([...currentCustomers]);

        // Update selected customer if it's the same
        const selectedCustomer = this.selectedCustomer();
        if (selectedCustomer?.id === id) {
          this.selectedCustomer.set(updatedCustomer);
        }

        return updatedCustomer;
      }),
      tap(() => this.loading.set(false)),
      catchError((error) => {
        this.loading.set(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Clear selected customer
   */
  clearSelectedCustomer(): void {
    this.selectedCustomer.set(null);
  }

  /**
   * Get current selected customer value
   */
  getSelectedCustomerValue(): PosCustomer | null {
    return this.selectedCustomer();
  }

  /**
   * Validate customer creation request
   */
  private validateCustomerRequest(
    request: CreatePosCustomerRequest,
  ): CustomerValidationError[] {
    const errors: CustomerValidationError[] = [];

    if (!request.email?.trim()) {
      errors.push({ field: 'email', message: 'Email es requerido' });
    } else if (!this.isValidEmail(request.email)) {
      errors.push({ field: 'email', message: 'Email no es válido' });
    }

    if (!request.first_name?.trim()) {
      errors.push({ field: 'firstName', message: 'Nombre es requerido' });
    }

    if (!request.last_name?.trim()) {
      errors.push({ field: 'lastName', message: 'Apellido es requerido' });
    }

    // Document fields are optional for quick POS customer creation
    // Only validate if at least one is provided
    if ((request.document_type && !request.document_number?.trim()) ||
        (!request.document_type?.trim() && request.document_number)) {
      errors.push({
        field: 'document',
        message: 'Si ingresas documento, debes completar tipo y número',
      });
    }

    // Check for duplicate email
    const existingCustomer = this.customers().find(
      (c) => c.email.toLowerCase() === request.email.toLowerCase(),
    );
    if (existingCustomer) {
      errors.push({
        field: 'email',
        message: 'Ya existe un cliente con este email',
      });
    }

    return errors;
  }

  /**
   * Email validation helper
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Create customer object from request
   */
  private createCustomerFromRequest(
    request: CreatePosCustomerRequest,
  ): PosCustomer {
    const firstName = request.first_name.trim();
    const lastName = request.last_name?.trim() || '';
    const name = `${firstName} ${lastName}`.trim();

    return {
      id: this.generateCustomerId(),
      email: request.email.trim().toLowerCase(),
      first_name: firstName,
      last_name: lastName,
      name: name,
      phone: request.phone,
      document_type: request.document_type,
      document_number: request.document_number?.trim(),
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  /**
   * Generate unique customer ID
   */
  private generateCustomerId(): number {
    return Date.now();
  }

  /**
   * Lookup customer by document number across the organization
   */
  lookupByDocument(documentNumber: string, documentType?: string): Observable<PosCustomer | null> {
    let params = new HttpParams().set('document_number', documentNumber);
    if (documentType) {
      params = params.set('document_type', documentType);
    }

    return this.http.get<any>(`${this.apiUrl}/lookup`, { params }).pipe(
      map((response) => {
        const data = response?.data;
        if (!data) return null;
        return this.mapApiCustomerToPosCustomer(data.customer);
      }),
      catchError(() => of(null)),
    );
  }

  /**
   * Map API customer response to PosCustomer
   */
  private mapApiCustomerToPosCustomer(apiCustomer: any): PosCustomer {
    const firstName = apiCustomer.first_name || '';
    const lastName = apiCustomer.last_name || '';
    const name = `${firstName} ${lastName}`.trim();

    return {
      id: apiCustomer.id,
      email: apiCustomer.email,
      first_name: apiCustomer.first_name,
      last_name: apiCustomer.last_name,
      name: name || apiCustomer.email, // Fallback to email if no name
      phone: apiCustomer.phone,
      document_type: apiCustomer.document_type,
      document_number: apiCustomer.document_number,
      addresses: (apiCustomer.addresses || []).map((addr: any) => ({
        id: addr.id,
        address_line1: addr.address_line1,
        address_line2: addr.address_line2,
        city: addr.city,
        state_province: addr.state_province,
        postal_code: addr.postal_code,
        country_code: addr.country_code,
        phone_number: addr.phone_number,
        type: addr.type,
        is_primary: addr.is_primary,
      })),
      created_at: new Date(apiCustomer.created_at),
      updated_at: new Date(apiCustomer.updated_at),
    };
  }

  /**
   * Initialize mock data for development (commented out)
   */
  // private initializeMockData(): void {
  //   const mockCustomers: PosCustomer[] = [
  //     // ... mock data
  //   ];
  //   this.customers.set(mockCustomers);
  // }
}
