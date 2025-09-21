import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CardComponent
  ],
  templateUrl: './verify-email.component.html',
  styleUrls: ['./verify-email.component.scss']
})
export class VerifyEmailComponent implements OnInit, OnDestroy {
  isLoading = true;
  isSuccess = false;
  errorMessage = '';
  token: string | null = null;
  private destroy$ = new Subject<void>();

  // Branding colors from domain config - reactive (no defaults)
  brandingColors: any = {};

  constructor(
    private authService: AuthService,
    private tenantFacade: TenantFacade,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Get token from URL query parameters
    this.route.queryParams.subscribe(params => {
      this.token = params['token'];
      if (this.token) {
        this.verifyEmail();
      } else {
        this.isLoading = false;
        this.errorMessage = 'Token de verificación no válido';
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

  private verifyEmail(): void {
    if (!this.token) return;

    this.authService.verifyEmail(this.token).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.isSuccess = true;

        // Redirect to login after 3 seconds
        setTimeout(() => {
          this.router.navigate(['/auth/login']);
        }, 3000);
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.error?.message || 'Error al verificar el email';
      }
    });
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

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }

  resendVerification(): void {
    // This would typically require the user's email
    // For now, just redirect to login
    this.router.navigate(['/auth/login']);
  }
}