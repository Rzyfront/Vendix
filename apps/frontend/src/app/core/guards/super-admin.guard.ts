import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthFacade } from '../store/auth/auth.facade';

@Injectable({
  providedIn: 'root'
})
export class SuperAdminGuard implements CanActivate {

  constructor(
    private authFacade: AuthFacade,
    private router: Router
  ) {}

  canActivate(): Observable<boolean> | Promise<boolean> | boolean {
    const isLoggedIn = this.authFacade.isLoggedIn();
    const userRole = this.authFacade.getCurrentUserRole();

    if (isLoggedIn && userRole === 'SUPER_ADMIN') {
      return true;
    }

    // If not authorized, redirect to login
    this.router.navigate(['/auth/login']);
    return false;
  }
}