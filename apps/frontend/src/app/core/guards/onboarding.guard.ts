import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { AuthFacade } from '../store/auth/auth.facade';
import { OnboardingService } from '../../shared/components/onboarding/services/onboarding.service';

@Injectable({
  providedIn: 'root',
})
export class OnboardingGuard implements CanActivate {
  constructor(
    private router: Router,
    private authFacade: AuthFacade,
    private onboardingService: OnboardingService,
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
        return this.onboardingService.getOnboardingStatus().pipe(
          map((status) => {
            if (status.onboarding_completed) {
              // Si el onboarding está completado, permitir acceso
              return true;
            } else {
              // Si el onboarding no está completado, abrir modal y permitir acceso
              // (el modal se mostrará en el layout)
              this.onboardingService.openOnboarding();
              return true;
            }
          }),
          catchError((error) => {
            console.error('Error checking onboarding status:', error);
            // En caso de error, permitir acceso pero mostrar modal
            this.onboardingService.openOnboarding();
            return of(true);
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
