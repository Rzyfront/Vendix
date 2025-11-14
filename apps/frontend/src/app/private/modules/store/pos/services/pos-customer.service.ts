import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, delay, map, tap } from 'rxjs/operators';
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

  constructor() {
    // Initialize with mock data for development
    this.initializeMockData();
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

    // Simulate API call
    return of(request).pipe(
      delay(300),
      map((req) => this.createCustomerFromRequest(req)),
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

    const { query = '', limit = 20, offset = 0 } = request;

    return of(this.customers$.value).pipe(
      delay(200),
      map((customers) => {
        let filteredCustomers = customers;

        if (query.trim()) {
          const searchTerm = query.toLowerCase().trim();
          filteredCustomers = customers.filter(
            (customer) =>
              customer.email.toLowerCase().includes(searchTerm) ||
              customer.name.toLowerCase().includes(searchTerm) ||
              customer.phone?.toLowerCase().includes(searchTerm) ||
              customer.documentNumber?.toLowerCase().includes(searchTerm),
          );
        }

        const total = filteredCustomers.length;
        const paginatedCustomers = filteredCustomers.slice(
          offset,
          offset + limit,
        );
        const hasMore = offset + limit < total;

        return {
          customers: paginatedCustomers,
          total,
          limit,
          offset,
          hasMore,
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
   * Get customer by ID
   */
  getCustomerById(id: string): Observable<PosCustomer | null> {
    const customer = this.customers$.value.find((c) => c.id === id);
    return of(customer || null);
  }

  /**
   * Update customer information
   */
  updateCustomer(
    id: string,
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
          updatedAt: new Date(),
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

    if (!request.name?.trim()) {
      errors.push({ field: 'name', message: 'Nombre es requerido' });
    }

    if (request.documentNumber && !request.documentType) {
      errors.push({
        field: 'documentType',
        message: 'Tipo de documento es requerido cuando se proporciona número',
      });
    }

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
    return {
      id: this.generateCustomerId(),
      email: request.email.trim().toLowerCase(),
      name: request.name.trim(),
      phone: request.phone?.trim() || undefined,
      documentType: request.documentType,
      documentNumber: request.documentNumber?.trim() || undefined,
      address: request.address?.trim() || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Generate unique customer ID
   */
  private generateCustomerId(): string {
    return 'CUST_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  /**
   * Initialize mock data for development
   */
  private initializeMockData(): void {
    const mockCustomers: PosCustomer[] = [
      {
        id: 'CUST_001',
        email: 'juan.perez@email.com',
        name: 'Juan Pérez',
        phone: '+5491123456789',
        documentType: 'dni',
        documentNumber: '12345678',
        address: 'Av. Corrientes 1000, Buenos Aires',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
      },
      {
        id: 'CUST_002',
        email: 'maria.garcia@email.com',
        name: 'María García',
        phone: '+5491145678901',
        documentType: 'dni',
        documentNumber: '87654321',
        address: 'Calle Florida 500, Buenos Aires',
        createdAt: new Date('2024-02-20'),
        updatedAt: new Date('2024-02-20'),
      },
      {
        id: 'CUST_003',
        email: 'carlos.rodriguez@email.com',
        name: 'Carlos Rodríguez',
        phone: '+5491178901234',
        documentType: 'dni',
        documentNumber: '45678901',
        createdAt: new Date('2024-03-10'),
        updatedAt: new Date('2024-03-10'),
      },
    ];

    this.customers$.next(mockCustomers);
  }
}
