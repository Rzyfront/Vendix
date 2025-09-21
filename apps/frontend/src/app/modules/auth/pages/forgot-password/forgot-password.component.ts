import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../../../core/services/auth.service';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { takeUntil, combineLatest } from 'rxjs/operators';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    CardComponent,
    InputComponent
  ],
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.scss']
})
export class ForgotPasswordComponent implements OnInit, OnDestroy {
  forgotForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  private destroy$ = new Subject<void>();

  // Branding colors from domain config - reactive (no defaults)
  brandingColors: any = {};

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private tenantFacade: TenantFacade
  ) {
    this.forgotForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  ngOnInit(): void {
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

  get borderColor(): string {
    return this.brandingColors?.border || '#B0B0B0';
  }

  onSubmit(): void {
    if (this.forgotForm.valid && !this.isLoading) {
      this.errorMessage = '';
      this.successMessage = '';

      const { email } = this.forgotForm.value;

      // Get organization slug from current domain
      let organizationSlug: string | undefined;
      const currentDomain = this.tenantFacade.getCurrentDomainConfig();
      if (currentDomain?.organizationSlug) {
        organizationSlug = currentDomain.organizationSlug;
      }

      if (!organizationSlug) {
        this.errorMessage = 'No se pudo determinar la organización para este dominio';
        return;
      }

      this.isLoading = true;

      this.authService.forgotPassword(email, organizationSlug).subscribe({
        next: (response) => {
          this.isLoading = false;
          this.successMessage = response.message || 'Se ha enviado un enlace de recuperación a tu correo electrónico';
          this.forgotForm.reset();
        },
        error: (error) => {
          this.isLoading = false;
          this.errorMessage = error.error?.message || 'Error al enviar el correo de recuperación';
        }
      });
    } else {
      // Mark all fields as touched to show validation errors
      Object.keys(this.forgotForm.controls).forEach(key => {
        this.forgotForm.get(key)?.markAsTouched();
      });
    }
  }

  getFieldError(fieldName: string): string {
    const field = this.forgotForm.get(fieldName);
    if (field?.errors && field?.touched) {
      if (field.errors['required']) {
        return 'El email es requerido';
      }
      if (field.errors['email']) {
        return 'Debe ser un email válido';
      }
    }
    return '';
  }

  hasFieldError(fieldName: string): boolean {
    const field = this.forgotForm.get(fieldName);
    return !!(field?.errors && field?.touched);
  }
}