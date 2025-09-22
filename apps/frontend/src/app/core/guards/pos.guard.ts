import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthFacade } from '../store/auth/auth.facade';

@Injectable({
  providedIn: 'root'
})
export class POSGuard implements CanActivate {

  constructor(
    private authFacade: AuthFacade,
    private router: Router
  ) {}

  canActivate(): Observable<boolean> | Promise<boolean> | boolean {
    const isLoggedIn = this.authFacade.isLoggedIn();
    const userRole = this.authFacade.getCurrentUserRole();

    // Allow roles that can access POS: CASHIER, EMPLOYEE, MANAGER, etc.
    const allowedRoles = ['CASHIER', 'EMPLOYEE', 'MANAGER', 'SUPERVISOR', 'OWNER', 'ADMIN'];

    if (isLoggedIn && userRole && allowedRoles.includes(userRole)) {
      return true;
    }

    // If not authorized, redirect to login or dashboard
    this.router.navigate(['/auth/login']);
    return false;
  }
}