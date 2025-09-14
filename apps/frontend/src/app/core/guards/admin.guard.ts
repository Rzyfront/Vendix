import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}
  canActivate(): Observable<boolean> | Promise<boolean> | boolean {
    // Check if user is logged in and has admin role
    if (this.authService.isLoggedIn() && this.authService.isAdmin()) {
      return true;
    }

    // If not logged in or not admin, redirect to login
    this.router.navigate(['/auth/login']);
    return false;
  }
}
