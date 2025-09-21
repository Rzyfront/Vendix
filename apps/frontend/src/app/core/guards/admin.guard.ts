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
    const isLoggedIn = this.authService.isLoggedIn();
    const isAdmin = this.authService.isAdmin();
    
    console.log('AdminGuard - isLoggedIn:', isLoggedIn);
    console.log('AdminGuard - isAdmin:', isAdmin);
    
    // Check if user is logged in - temporarily allow any logged in user
    if (isLoggedIn) {
      console.log('AdminGuard - Access granted');
      return true;
    }

    // If not logged in, redirect to login
    console.log('AdminGuard - Access denied, redirecting to login');
    this.router.navigate(['/auth/login']);
    return false;
  }
}
