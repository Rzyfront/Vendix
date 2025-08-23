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
    // Allow access to any authenticated user
    if (this.authService.isLoggedIn()) {
      return true;
    }

    // If not logged in, redirect to login
    this.router.navigate(['/auth/login']);
    return false;
  }
}
