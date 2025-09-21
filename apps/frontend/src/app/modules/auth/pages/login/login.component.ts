import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../../../core/services/auth.service';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { takeUntil, combineLatest } from 'rxjs/operators';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit, OnDestroy {
  loginForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  private destroy$ = new Subject<void>();

  // Branding colors from domain config - reactive (no defaults)
  brandingColors: any = {};

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private tenantFacade: TenantFacade,
    private authFacade: AuthFacade
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  ngOnInit(): void {
    // Subscribe to reactive auth state
    this.authFacade.loading$.pipe(takeUntil(this.destroy$)).subscribe(loading => {
      this.isLoading = loading;
    });

    this.authFacade.error$.pipe(takeUntil(this.destroy$)).subscribe(error => {
      this.errorMessage = error || '';
    });

    // Subscribe to authentication success to redirect
    this.authFacade.isAuthenticated$.pipe(takeUntil(this.destroy$)).subscribe(isAuth => {
      if (isAuth) {
        console.log('User authenticated, redirecting to admin dashboard...');
        // Small delay to ensure the auth state is fully updated
        setTimeout(() => {
          this.authService.redirectAfterLogin();
        }, 100);
      }
    });

    // Subscribe to tenant branding colors
    this.tenantFacade.tenantConfig$.pipe(takeUntil(this.destroy$)).subscribe(tenantConfig => {
      if (tenantConfig?.branding?.colors) {
        const colors = tenantConfig.branding.colors;
        this.brandingColors = {
          primary: colors.primary,
          secondary: colors.secondary,
          accent: colors.accent,
          background: colors.background,
          text: colors.text?.primary || colors.text,
          border: colors.surface
        };
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }


  getBackgroundGradient(): string {
    const background = this.brandingColors?.background || '#F4F4F4';
    const secondary = this.brandingColors?.secondary || '#2F6F4E';
    return `linear-gradient(to bottom right, ${background}80, ${secondary}20)`;
  }

  // Helper methods for template colors with defaults
  get primaryColor(): string {
    return this.brandingColors?.primary || '#7ED7A5';
  }

  get secondaryColor(): string {
    return this.brandingColors?.secondary || '#2F6F4E';
  }

  get accentColor(): string {
    return this.brandingColors?.accent || '#FFFFFF';
  }

  get textColor(): string {
    return this.brandingColors?.text || '#222222';
  }
  onSubmit(): void {
    if (this.loginForm.valid && !this.isLoading) {
      this.errorMessage = '';

      const { email, password } = this.loginForm.value;

      // Get tenant information from reactive state
      let storeSlug: string | undefined;
      let organizationSlug: string | undefined;

      const currentStore = this.tenantFacade.getCurrentStore();
      const currentOrganization = this.tenantFacade.getCurrentOrganization();

      if (currentStore?.slug) {
        storeSlug = currentStore.slug;
      } else if (currentOrganization?.slug) {
        organizationSlug = currentOrganization.slug;
      }

      this.authFacade.login(email, password, storeSlug, organizationSlug);
    } else {
      // Mark all fields as touched to show validation errors
      Object.keys(this.loginForm.controls).forEach(key => {
        this.loginForm.get(key)?.markAsTouched();
      });
    }
  }

  getFieldError(fieldName: string): string {
    const field = this.loginForm.get(fieldName);
    if (field?.errors && field?.touched) {
      if (field.errors['required']) {
        return `${fieldName === 'email' ? 'El email' : 'La contraseña'} es requerida`;
      }
      if (field.errors['email']) {
        return 'Debe ser un email válido';
      }
      if (field.errors['minlength']) {
        return 'La contraseña debe tener al menos 6 caracteres';
      }
    }
    return '';
  }

  hasFieldError(fieldName: string): boolean {
    const field = this.loginForm.get(fieldName);
    return !!(field?.errors && field?.touched);
  }
}
