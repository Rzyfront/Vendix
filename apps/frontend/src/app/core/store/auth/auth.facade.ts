import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import * as AuthActions from './auth.actions';
import * as AuthSelectors from './auth.selectors';
import { AuthState } from './auth.reducer';

@Injectable({
  providedIn: 'root'
})
export class AuthFacade {
  private store = inject(Store<AuthState>);

  // State observables
  readonly user$ = this.store.select(AuthSelectors.selectUser);
  readonly isAuthenticated$ = this.store.select(AuthSelectors.selectIsAuthenticated);
  readonly loading$ = this.store.select(AuthSelectors.selectAuthLoading);
  readonly error$ = this.store.select(AuthSelectors.selectAuthError);

  // Role-based observables
  readonly userRole$ = this.store.select(AuthSelectors.selectUserRole);
  readonly isAdmin$ = this.store.select(AuthSelectors.selectIsAdmin);
  readonly isOwner$ = this.store.select(AuthSelectors.selectIsOwner);
  readonly isManager$ = this.store.select(AuthSelectors.selectIsManager);
  readonly isEmployee$ = this.store.select(AuthSelectors.selectIsEmployee);
  readonly isCustomer$ = this.store.select(AuthSelectors.selectIsCustomer);

  // User info observables
  readonly userId$ = this.store.select(AuthSelectors.selectUserId);
  readonly userEmail$ = this.store.select(AuthSelectors.selectUserEmail);
  readonly userName$ = this.store.select(AuthSelectors.selectUserName);

  // Combined observables
  readonly authInfo$ = this.store.select(AuthSelectors.selectAuthInfo);

  // Actions
  login(email: string, password: string, storeSlug?: string, organizationSlug?: string): void {
    this.store.dispatch(AuthActions.login({ email, password, storeSlug, organizationSlug }));
  }

  logout(): void {
    this.store.dispatch(AuthActions.logout());
  }

  refreshToken(refreshToken: string): void {
    this.store.dispatch(AuthActions.refreshToken({ refreshToken }));
  }

  loadUser(): void {
    this.store.dispatch(AuthActions.loadUser());
  }

  checkAuthStatus(): void {
    this.store.dispatch(AuthActions.checkAuthStatus());
  }

  clearAuthState(): void {
    this.store.dispatch(AuthActions.clearAuthState());
  }

  // Synchronous getters for templates
  getCurrentUser(): any {
    let result: any = null;
    this.user$.subscribe(user => result = user).unsubscribe();
    
    // Fallback to localStorage if NgRx state is empty
    if (!result) {
      try {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          result = JSON.parse(storedUser);
          console.log('getCurrentUser: Loaded user from localStorage:', result);
        }
      } catch (error) {
        console.warn('Failed to load user from localStorage:', error);
      }
    }
    
    return result;
  }

  getCurrentUserRole(): string | null {
    let result: string | null = null;
    this.userRole$.subscribe(role => result = role).unsubscribe();
    return result;
  }

  isLoggedIn(): boolean {
    let result = false;
    this.isAuthenticated$.subscribe(auth => result = auth).unsubscribe();
    return result;
  }

  isAdmin(): boolean {
    let result = false;
    this.isAdmin$.subscribe(admin => result = admin).unsubscribe();
    return result;
  }

  isLoading(): boolean {
    let result = false;
    this.loading$.subscribe(loading => result = loading).unsubscribe();
    return result;
  }

  getError(): string | null {
    let result: string | null = null;
    this.error$.subscribe(error => result = error).unsubscribe();
    return result;
  }
}