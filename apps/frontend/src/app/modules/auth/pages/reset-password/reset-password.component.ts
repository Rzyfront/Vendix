import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../../../core/services/auth.service';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { takeUntil, combineLatest } from 'rxjs/operators';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    CardComponent,
    InputComponent
  ],
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.scss']
})
export class ResetPasswordComponent implements OnInit, OnDestroy {
  resetForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  token: string | null = null;
  private destroy$ = new Subject<void>();

  // Branding colors from domain config - reactive (no defaults)
  brandingColors: any = {};

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private tenantFacade: TenantFacade,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.resetForm = this.fb.group({
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });
  }

  ngOnInit(): void {
    // Get token from URL query parameters
    this.route.queryParams.subscribe(params => {
      this.token = params['token'];
      if (!this.token) {
        this.errorMessage = 'Token de recuperación no válido o expirado';
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

  passwordMatchValidator(form: FormGroup) {
    const password = form.get('password');
    const confirmPassword = form.get('confirmPassword');

    if (password && confirmPassword && password.value !== confirmPassword.value) {
      confirmPassword.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }

    return null;
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
    if (this.resetForm.valid && !this.isLoading && this.token) {
      this.errorMessage = '';
      this.successMessage = '';

      const { password } = this.resetForm.value;

      this.isLoading = true;

      this.authService.resetPassword(this.token, password).subscribe({
        next: (response) => {
          this.isLoading = false;
          this.successMessage = response.message || 'Contraseña actualizada exitosamente';

          // Redirect to login after 3 seconds
          setTimeout(() => {
            this.router.navigate(['/auth/login']);
          }, 3000);
        },
        error: (error) => {
          this.isLoading = false;
          this.errorMessage = error.error?.message || 'Error al actualizar la contraseña';
        }
      });
    } else {
      // Mark all fields as touched to show validation errors
      Object.keys(this.resetForm.controls).forEach(key => {
        this.resetForm.get(key)?.markAsTouched();
      });
    }
  }

  getFieldError(fieldName: string): string {
    const field = this.resetForm.get(fieldName);
    if (field?.errors && field?.touched) {
      if (field.errors['required']) {
        return fieldName === 'password' ? 'La contraseña es requerida' : 'La confirmación es requerida';
      }
      if (field.errors['minlength']) {
        return 'La contraseña debe tener al menos 8 caracteres';
      }
      if (field.errors['passwordMismatch']) {
        return 'Las contraseñas no coinciden';
      }
    }
    return '';
  }

  hasFieldError(fieldName: string): boolean {
    const field = this.resetForm.get(fieldName);
    return !!(field?.errors && field?.touched);
  }
}