import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface WizardStatus {
  user_id: number;
  email_verified: boolean;
  onboarding_completed: boolean;
  has_user_data: boolean;
  has_user_address: boolean;
  has_organization: boolean;
  has_organization_address: boolean;
  has_store: boolean;
  has_store_address: boolean;
  has_app_config: boolean;
  current_step: number;
}

export interface EmailVerificationStatus {
  verified: boolean;
  state: string;
  email: string;
}

export interface SelectAppTypeData {
  app_type: 'STORE_ADMIN' | 'ORG_ADMIN';
  notes?: string;
}

export interface SelectAppTypeResponse {
  success: boolean;
  app_type: 'STORE_ADMIN' | 'ORG_ADMIN';
  message: string;
}

export interface SetupUserData {
  first_name?: string;
  last_name?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country_code?: string;
}

export interface SetupOrganizationData {
  name: string;
  description?: string;
  legal_name?: string;
  email?: string;
  phone?: string;
  website?: string;
  tax_id?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country_code?: string;
}

export interface SetupStoreData {
  name: string;
  description?: string;
  store_type?: 'physical' | 'online' | 'hybrid';
  timezone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country_code?: string;
}

export interface SetupAppConfigData {
  app_type: 'ORG_ADMIN' | 'STORE_ADMIN';
  primary_color: string;
  secondary_color: string;
  use_custom_domain: boolean;
  custom_domain?: string;
  subdomain?: string;
}

export interface WizardCompletionResult {
  onboarding_completed: boolean;
  redirect_to: string;
}

@Injectable({
  providedIn: 'root',
})
export class OnboardingWizardService {
  private readonly apiUrl = `${environment.apiUrl}/onboarding-wizard`;

  // Wizard state management
  private currentStepSubject = new BehaviorSubject<number>(1);
  public currentStep$ = this.currentStepSubject.asObservable();

  private wizardDataSubject = new BehaviorSubject<any>({
    user: {},
    organization: {},
    store: {},
    appConfig: {},
  });
  public wizardData$ = this.wizardDataSubject.asObservable();

  private _created_store_slug: string | null = null;
  private _app_type: 'STORE_ADMIN' | 'ORG_ADMIN' | null = null;

  constructor(private http: HttpClient) {}

  /**
   * Get created store slug
   */
  getCreatedStoreSlug(): string | null {
    return this._created_store_slug;
  }

  /**
   * Get app type
   */
  getAppType(): 'STORE_ADMIN' | 'ORG_ADMIN' | null {
    return this._app_type;
  }

  /**
   * Get wizard status
   */
  getWizardStatus(): Observable<any> {
    return this.http.get(`${this.apiUrl}/status`);
  }

  /**
   * Sync wizard status from backend and update local state
   */
  syncWizardStatus(): Observable<any> {
    return this.http.get(`${this.apiUrl}/status`).pipe(
      tap((response: any) => {
        if (response.success && response.data) {
          // Only update step if it's different to avoid loops
          const backendStep = response.data.current_step;
          const currentStep = this.currentStepSubject.value;

          if (backendStep !== currentStep) {
            this.currentStepSubject.next(backendStep);
          }
        }
      }),
    );
  }

  /**
   * Check email verification status
   */
  checkEmailVerification(): Observable<any> {
    return this.http.post(`${this.apiUrl}/verify-email-status`, {});
  }

  /**
   * Select application type for the user
   */
  selectAppType(data: SelectAppTypeData): Observable<SelectAppTypeResponse> {
    return this.http
      .post<SelectAppTypeResponse>(`${this.apiUrl}/select-app-type`, data)
      .pipe(
        tap((response: SelectAppTypeResponse) => {
          if (response.success) {
            this._app_type = response.app_type;
            this.updateWizardData('app_type', {
              selected_app_type: response.app_type,
              selected_at: new Date().toISOString(),
            });
          }
        }),
      );
  }

  /**
   * Resend verification email
   */
  resendVerificationEmail(): Observable<any> {
    return this.http.post(`${environment.apiUrl}/auth/resend-verification`, {});
  }

  /**
   * Setup user profile and address
   */
  setupUser(data: SetupUserData): Observable<any> {
    return this.http.post(`${this.apiUrl}/setup-user`, data).pipe(
      tap((response: any) => {
        if (response.success) {
          const currentData = this.wizardDataSubject.value;
          this.wizardDataSubject.next({
            ...currentData,
            user: data,
          });
          // Auto-advance to next step
          this.nextStep();
        }
      }),
    );
  }

  /**
   * Setup organization
   */
  setupOrganization(data: SetupOrganizationData): Observable<any> {
    return this.http.post(`${this.apiUrl}/setup-organization`, data).pipe(
      tap((response: any) => {
        if (response.success) {
          const currentData = this.wizardDataSubject.value;
          this.wizardDataSubject.next({
            ...currentData,
            organization: data,
          });
          // Auto-advance to next step
          this.nextStep();
        }
      }),
    );
  }

  /**
   * Setup store
   */
  setupStore(data: SetupStoreData): Observable<any> {
    return this.http.post(`${this.apiUrl}/setup-store`, data).pipe(
      tap((response: any) => {
        if (response.success) {
          const currentData = this.wizardDataSubject.value;
          this.wizardDataSubject.next({
            ...currentData,
            store: data,
          });
          if (response.data?.slug) {
            this._created_store_slug = response.data.slug;
          }
          this.nextStep();
        }
      }),
    );
  }

  /**
   * Setup app configuration
   */
  setupAppConfig(data: SetupAppConfigData): Observable<any> {
    return this.http.post(`${this.apiUrl}/setup-app-config`, data).pipe(
      tap((response: any) => {
        if (response.success) {
          const currentData = this.wizardDataSubject.value;
          this.wizardDataSubject.next({
            ...currentData,
            appConfig: data,
          });
          // Auto-advance to next step
          this.nextStep();
        }
      }),
    );
  }

  /**
   * Complete wizard
   */
  completeWizard(): Observable<any> {
    return this.http.post(`${this.apiUrl}/complete`, {});
  }

  /**
   * Navigate to specific step
   */
  goToStep(step: number): void {
    this.currentStepSubject.next(step);
  }

  /**
   * Move to next step
   */
  nextStep(): void {
    const current = this.currentStepSubject.value;
    this.currentStepSubject.next(current + 1);
  }

  /**
   * Move to previous step
   */
  previousStep(): void {
    const current = this.currentStepSubject.value;
    if (current > 1) {
      this.currentStepSubject.next(current - 1);
    }
  }

  /**
   * Get current wizard data
   */
  getWizardData(): any {
    return this.wizardDataSubject.value;
  }

  /**
   * Update wizard data for a specific section
   */
  updateWizardData(section: string, data: any): void {
    const currentData = this.wizardDataSubject.value;
    this.wizardDataSubject.next({
      ...currentData,
      [section]: data,
    });
  }

  /**
   * Reset wizard state
   */
  resetWizard(): void {
    this.currentStepSubject.next(1);
    this.wizardDataSubject.next({
      user: {},
      organization: {},
      store: {},
      appConfig: {},
    });
  }
}
