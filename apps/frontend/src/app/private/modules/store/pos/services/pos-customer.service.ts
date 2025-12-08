import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, delay, map, tap } from 'rxjs/operators';
import { HttpClient, HttpParams } from '@angular/common/http';
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
  private readonly customers$ = new BehaviorSubject<PosCustomer[]>([]);
  private readonly loading$ = new BehaviorSubject<boolean>(false);
  private readonly selectedCustomer$ = new BehaviorSubject<PosCustomer | null>(
    null,
  );
  private readonly apiUrl = `${environment.apiUrl}/store/users`;
  private readonly registerUrl = `${environment.apiUrl}/auth/register-customer`;

  constructor(private http: HttpClient) {
    // Initialize with mock data for development if needed
    // this.initializeMockData();
  }

  // Observable getters
  get customers(): Observable<PosCustomer[]> {
    return this.customers$.asObservable();
  }

  get loading(): Observable<boolean> {
    return this.loading$.asObservable();
  }

  get selectedCustomer(): Observable<PosCustomer | null> {
    return this.selectedCustomer$.asObservable();
  }

  /**
   * Quick customer creation for POS flow
   */
  createQuickCustomer(
    request: CreatePosCustomerRequest,
  ): Observable<PosCustomer> {
    this.loading$.next(true);

    // Validate required fields
    const validationErrors = this.validateCustomerRequest(request);
    if (validationErrors.length > 0) {
      this.loading$.next(false);
      return throwError(
        () => new Error(validationErrors.map((e) => e.message).join(', ')),
      );
    }

    // Call API to create customer
    return this.http.post<PosCustomer>(this.registerUrl, request).pipe(
      map((response: any) => this.mapApiCustomerToPosCustomer(response)),
      tap((customer) => {
        const currentCustomers = this.customers$.value;
        this.customers$.next([customer, ...currentCustomers]);
        this.selectCustomer(customer);
        this.loading$.next(false);
      }),
      catchError((error) => {
        this.loading$.next(false);
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
    this.loading$.next(true);

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
      tap(() => this.loading$.next(false)),
      catchError((error) => {
        this.loading$.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Select a customer for the current POS transaction
   */
  selectCustomer(customer: PosCustomer | null): void {
    this.selectedCustomer$.next(customer);
  }

  /**
   * Create a new customer
   */
  createCustomer(request: CreatePosCustomerRequest): Observable<PosCustomer> {
    this.loading$.next(true);

    return this.http.post<PosCustomer>(this.registerUrl, request).pipe(
      map((response: any) => this.mapApiCustomerToPosCustomer(response)),
      tap((customer) => {
        // Add to local customers list
        const currentCustomers = this.customers$.value;
        this.customers$.next([...currentCustomers, customer]);
        this.loading$.next(false);
      }),
      catchError((error) => {
        this.loading$.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Get customer by ID
   */
  getCustomerById(id: number): Observable<PosCustomer | null> {
    const customer = this.customers$.value.find((c) => c.id === id);
    return of(customer || null);
  }

  /**
   * Update customer information
   */
  updateCustomer(
    id: number,
    updates: Partial<CreatePosCustomerRequest>,
  ): Observable<PosCustomer> {
    this.loading$.next(true);

    return of(updates).pipe(
      delay(250),
      map((updates) => {
        const currentCustomers = this.customers$.value;
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
        this.customers$.next([...currentCustomers]);

        // Update selected customer if it's the same
        const selectedCustomer = this.selectedCustomer$.value;
        if (selectedCustomer?.id === id) {
          this.selectedCustomer$.next(updatedCustomer);
        }

        return updatedCustomer;
      }),
      tap(() => this.loading$.next(false)),
      catchError((error) => {
        this.loading$.next(false);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Clear selected customer
   */
  clearSelectedCustomer(): void {
    this.selectedCustomer$.next(null);
  }

  /**
   * Get current selected customer value
   */
  getSelectedCustomerValue(): PosCustomer | null {
    return this.selectedCustomer$.value;
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

    // Document fields are now optional
    // if (!request.document_type?.trim()) {
    //   errors.push({
    //     field: 'documentType',
    //     message: 'Tipo de documento es requerido',
    //   });
    // }

    // if (!request.document_number?.trim()) {
    //   errors.push({
    //     field: 'documentNumber',
    //     message: 'Número de documento es requerido',
    //   });
    // }

    // Check for duplicate email
    const existingCustomer = this.customers$.value.find(
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
  //   this.customers$.next(mockCustomers);
  // }
}
