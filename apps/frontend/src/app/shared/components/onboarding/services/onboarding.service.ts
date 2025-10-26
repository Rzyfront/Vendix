import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../environments/environment';
import {
  OnboardingStatusResponse,
  OnboardingCompleteRequest,
  OrganizationConfigData,
  StoreConfigData,
  DomainConfigData,
  AddressData,
  UserConfigData,
  OnboardingStepId,
} from '../interfaces/onboarding.interface';

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  meta?: any;
}

export interface CreateOrganizationResponse {
  organization: {
    id: number;
    name: string;
    description?: string;
    industry?: string;
    website?: string;
    phone?: string;
  };
}

export interface CreateStoreResponse {
  store: {
    id: number;
    name: string;
    description?: string;
    store_type: string;
    phone?: string;
    email?: string;
  };
}

export interface CreateDomainResponse {
  domain: {
    id: number;
    hostname: string;
    domain_type: string;
    is_active: boolean;
    ssl_enabled: boolean;
  };
}

export interface CreateAddressResponse {
  address: {
    id: number;
    street_address: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
    address_type: string;
    is_primary: boolean;
  };
}

@Injectable({
  providedIn: 'root',
})
export class OnboardingService {
  private readonly API_URL = `${environment.apiUrl}/auth/onboarding`;
  private readonly DOMAINS_API_URL = `${environment.apiUrl}/domains`;
  private readonly ADDRESSES_API_URL = `${environment.apiUrl}/addresses`;
  private readonly USERS_API_URL = `${environment.apiUrl}/users`;

  private http = inject(HttpClient);

  // Estado local del onboarding
  private onboardingStateSubject = new BehaviorSubject<{
    isOpen: boolean;
    currentStep: OnboardingStepId;
    isCompleted: boolean;
    loading: boolean;
    error: string | null;
  }>({
    isOpen: false,
    currentStep: 'user',
    isCompleted: false,
    loading: false,
    error: null,
  });

  onboardingState$ = this.onboardingStateSubject.asObservable();

  // Obtener estado del onboarding
  getOnboardingStatus(): Observable<OnboardingStatusResponse> {
    return this.http
      .get<ApiResponse<OnboardingStatusResponse>>(`${this.API_URL}/status`)
      .pipe(
        map((response) => {
          if (!response.success || !response.data) {
            throw new Error(
              response.message || 'Error al obtener estado del onboarding',
            );
          }
          return response.data;
        }),
        catchError((error) => {
          console.error('Error getting onboarding status:', error);
          // Retornar estado por defecto si hay error
          return of({
            onboarding_completed: false,
            current_step: 'user' as OnboardingStepId,
            completed_steps: [],
          } as OnboardingStatusResponse);
        }),
      );
  }

  // Actualizar perfil del usuario
  updateUserProfile(
    userId: number,
    userData: UserConfigData,
  ): Observable<ApiResponse> {
    return this.http
      .patch<ApiResponse>(`${this.USERS_API_URL}/${userId}`, userData)
      .pipe(
        map((response) => {
          if (!response.success) {
            throw new Error(
              response.message || 'Error al actualizar perfil del usuario',
            );
          }
          return response;
        }),
        catchError((error) => {
          console.error('Error updating user profile:', error);
          return throwError(() => error);
        }),
      );
  }

  // Crear organización durante onboarding
  createOrganization(
    organizationData: OrganizationConfigData,
  ): Observable<CreateOrganizationResponse> {
    return this.http
      .post<
        ApiResponse<CreateOrganizationResponse>
      >(`${this.API_URL}/create-organization`, organizationData)
      .pipe(
        map((response) => {
          if (!response.success || !response.data) {
            throw new Error(response.message || 'Error al crear organización');
          }
          return response.data;
        }),
        catchError((error) => {
          console.error('Error creating organization:', error);
          return throwError(() => error);
        }),
      );
  }

  // Configurar detalles de la organización
  setupOrganization(
    organizationId: number,
    setupData: Partial<OrganizationConfigData>,
  ): Observable<ApiResponse> {
    return this.http
      .post<ApiResponse>(
        `${this.API_URL}/setup-organization/${organizationId}`,
        setupData,
      )
      .pipe(
        map((response) => {
          if (!response.success) {
            throw new Error(
              response.message || 'Error al configurar organización',
            );
          }
          return response;
        }),
        catchError((error) => {
          console.error('Error setting up organization:', error);
          return throwError(() => error);
        }),
      );
  }

  // Crear dirección para organización
  createOrganizationAddress(
    addressData: AddressData,
  ): Observable<CreateAddressResponse> {
    return this.http
      .post<
        ApiResponse<CreateAddressResponse>
      >(this.ADDRESSES_API_URL, addressData)
      .pipe(
        map((response) => {
          if (!response.success || !response.data) {
            throw new Error(
              response.message || 'Error al crear dirección de organización',
            );
          }
          return response.data;
        }),
        catchError((error) => {
          console.error('Error creating organization address:', error);
          return throwError(() => error);
        }),
      );
  }

  // Crear tienda durante onboarding
  createStore(
    organizationId: number,
    storeData: StoreConfigData,
  ): Observable<CreateStoreResponse> {
    return this.http
      .post<
        ApiResponse<CreateStoreResponse>
      >(`${this.API_URL}/create-store/${organizationId}`, storeData)
      .pipe(
        map((response) => {
          if (!response.success || !response.data) {
            throw new Error(response.message || 'Error al crear tienda');
          }
          return response.data;
        }),
        catchError((error) => {
          console.error('Error creating store:', error);
          return throwError(() => error);
        }),
      );
  }

  // Configurar detalles de la tienda
  setupStore(
    storeId: number,
    setupData: Partial<StoreConfigData>,
  ): Observable<ApiResponse> {
    return this.http
      .post<ApiResponse>(`${this.API_URL}/setup-store/${storeId}`, setupData)
      .pipe(
        map((response) => {
          if (!response.success) {
            throw new Error(response.message || 'Error al configurar tienda');
          }
          return response;
        }),
        catchError((error) => {
          console.error('Error setting up store:', error);
          return throwError(() => error);
        }),
      );
  }

  // Crear dirección para tienda
  createStoreAddress(
    addressData: AddressData,
  ): Observable<CreateAddressResponse> {
    return this.http
      .post<
        ApiResponse<CreateAddressResponse>
      >(this.ADDRESSES_API_URL, addressData)
      .pipe(
        map((response) => {
          if (!response.success || !response.data) {
            throw new Error(
              response.message || 'Error al crear dirección de tienda',
            );
          }
          return response.data;
        }),
        catchError((error) => {
          console.error('Error creating store address:', error);
          return throwError(() => error);
        }),
      );
  }

  // Verificar disponibilidad de dominio
  checkDomainAvailability(
    hostname: string,
  ): Observable<ApiResponse<{ available: boolean }>> {
    return this.http
      .get<
        ApiResponse<{ available: boolean }>
      >(`${this.DOMAINS_API_URL}/check/${hostname}`)
      .pipe(
        map((response) => {
          if (!response.success) {
            throw new Error(
              response.message ||
                'Error al verificar disponibilidad del dominio',
            );
          }
          return response;
        }),
        catchError((error) => {
          console.error('Error checking domain availability:', error);
          return throwError(() => error);
        }),
      );
  }

  // Crear configuración de dominio
  createDomain(domainData: DomainConfigData): Observable<CreateDomainResponse> {
    return this.http
      .post<ApiResponse<CreateDomainResponse>>(this.DOMAINS_API_URL, domainData)
      .pipe(
        map((response) => {
          if (!response.success || !response.data) {
            throw new Error(response.message || 'Error al crear dominio');
          }
          return response.data;
        }),
        catchError((error) => {
          console.error('Error creating domain:', error);
          return throwError(() => error);
        }),
      );
  }

  // Verificar configuración DNS del dominio
  verifyDomainDns(hostname: string): Observable<ApiResponse> {
    return this.http
      .post<ApiResponse>(
        `${this.DOMAINS_API_URL}/hostname/${hostname}/verify`,
        {},
      )
      .pipe(
        map((response) => {
          if (!response.success) {
            throw new Error(
              response.message || 'Error al verificar configuración DNS',
            );
          }
          return response;
        }),
        catchError((error) => {
          console.error('Error verifying domain DNS:', error);
          return throwError(() => error);
        }),
      );
  }

  // Completar proceso de onboarding
  completeOnboarding(
    completeData: OnboardingCompleteRequest,
  ): Observable<ApiResponse> {
    return this.http
      .post<ApiResponse>(`${this.API_URL}/complete`, completeData)
      .pipe(
        map((response) => {
          if (!response.success) {
            throw new Error(
              response.message || 'Error al completar onboarding',
            );
          }
          return response;
        }),
        catchError((error) => {
          console.error('Error completing onboarding:', error);
          return throwError(() => error);
        }),
      );
  }

  // Métodos para manejo del estado local

  openOnboarding(): void {
    const currentState = this.onboardingStateSubject.value;
    this.onboardingStateSubject.next({
      ...currentState,
      isOpen: true,
      error: null,
    });
  }

  closeOnboarding(): void {
    const currentState = this.onboardingStateSubject.value;
    this.onboardingStateSubject.next({
      ...currentState,
      isOpen: false,
    });
  }

  setCurrentStep(step: OnboardingStepId): void {
    const currentState = this.onboardingStateSubject.value;
    this.onboardingStateSubject.next({
      ...currentState,
      currentStep: step,
    });
  }

  setLoading(loading: boolean): void {
    const currentState = this.onboardingStateSubject.value;
    this.onboardingStateSubject.next({
      ...currentState,
      loading,
    });
  }

  setError(error: string | null): void {
    const currentState = this.onboardingStateSubject.value;
    this.onboardingStateSubject.next({
      ...currentState,
      error,
    });
  }

  setCompleted(completed: boolean): void {
    const currentState = this.onboardingStateSubject.value;
    this.onboardingStateSubject.next({
      ...currentState,
      isCompleted: completed,
      isOpen: !completed, // Cerrar modal si se completó
    });
  }

  // Utilidades para autocompletar datos

  generateOrganizationFromUser(
    userData: UserConfigData,
    organizationName?: string,
  ): Partial<OrganizationConfigData> {
    return {
      name:
        organizationName ||
        `${userData.first_name} ${userData.last_name} Company`,
      phone: userData.phone,
      billing: {
        billing_email: '', // Se podría obtener del usuario si está disponible
      },
    };
  }

  generateStoreFromOrganization(
    organizationData: OrganizationConfigData,
  ): Partial<StoreConfigData> {
    return {
      name: `${organizationData.name} - Main Store`,
      phone: organizationData.phone,
      settings: {
        timezone: organizationData.settings.timezone,
        currency: organizationData.settings.currency,
        language: organizationData.settings.language,
        inventory_tracking: true,
        tax_calculation: true,
      },
    };
  }

  generateDomainFromOrganization(
    organizationData: OrganizationConfigData,
  ): Partial<DomainConfigData> {
    const baseHostname = organizationData.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/\s+/g, '');

    return {
      hostname: `${baseHostname}.vendix.app`,
      domain_type: 'primary',
      is_active: true,
      ssl_enabled: false,
    };
  }
}
