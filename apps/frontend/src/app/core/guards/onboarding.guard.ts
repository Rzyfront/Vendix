import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { AuthFacade } from '../store/auth/auth.facade';
import { OnboardingWizardService } from '../services/onboarding-wizard.service';

@Injectable({
  providedIn: 'root',
})
export class OnboardingGuard implements CanActivate {
  constructor(
    private router: Router,
    private authFacade: AuthFacade,
    private onboardingWizardService: OnboardingWizardService,
  ) {}

  canActivate(): Observable<boolean> {
    return this.authFacade.isAuthenticated$.pipe(
      take(1),
      switchMap((isAuthenticated) => {
        if (!isAuthenticated) {
          // Si no está autenticado, redirigir al login
          this.router.navigate(['/auth/login']);
          return of(false);
        }

        // Si está autenticado, verificar estado del onboarding
        return this.onboardingWizardService.getWizardStatus().pipe(
          map((response: any) => {
            if (response.success && response.data?.onboarding_completed) {
              // Si el onboarding está completado, permitir acceso
              return true;
            } else {
              // Si el onboarding no está completado, redirigir al wizard
              this.router.navigate(['/onboarding-wizard']);
              return false;
            }
          }),
          catchError((error) => {
            console.error('Error checking onboarding status:', error);
            // En caso de error, redirigir al wizard
            this.router.navigate(['/onboarding-wizard']);
            return of(false);
          }),
        );
      }),
      catchError((error) => {
        console.error('Error in onboarding guard:', error);
        // En caso de error grave, redirigir al login
        this.router.navigate(['/auth/login']);
        return of(false);
      }),
    );
  }
}
