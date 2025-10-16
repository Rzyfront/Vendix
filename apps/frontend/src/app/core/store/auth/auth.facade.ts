import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
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
  readonly tokens$ = this.store.select(AuthSelectors.selectTokens);
  readonly isAuthenticated$ = this.store.select(AuthSelectors.selectIsAuthenticated);
  readonly loading$ = this.store.select(AuthSelectors.selectAuthLoading);
  readonly error$ = this.store.select(AuthSelectors.selectAuthError);

  // Role-based observables
  readonly userRole$ = this.store.select(AuthSelectors.selectUserRole);
  readonly userRoles$ = this.store.select(AuthSelectors.selectRoles);
  readonly userPermissions$ = this.store.select(AuthSelectors.selectPermissions);
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
  login(email: string, password: string, store_slug?: string, organization_slug?: string): void {
    this.store.dispatch(AuthActions.login({ email, password, store_slug, organization_slug }));
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

  restoreAuthState(user: any, tokens: { accessToken: string; refreshToken: string }): void {
    this.store.dispatch(AuthActions.restoreAuthState({ user, tokens }));
  }

  forgotOwnerPassword(organization_slug: string, email: string): void {
    this.store.dispatch(AuthActions.forgotOwnerPassword({ organization_slug, email }));
  }

  resetOwnerPassword(token: string, new_password: string): void {
    this.store.dispatch(AuthActions.resetOwnerPassword({ token, new_password }));
  }

  // Synchronous getters for templates
  getCurrentUser(): any {
    let result: any = null;
    this.user$.pipe(take(1)).subscribe(user => result = user);
    return result;
  }

  getCurrentUserRole(): string | null {
    let result: string | null = null;
    this.userRole$.pipe(take(1)).subscribe(role => result = role);
    return result;
  }

  isLoggedIn(): boolean {
    let result = false;
    this.isAuthenticated$.pipe(take(1)).subscribe(auth => result = auth);
    return result;
  }

  isAdmin(): boolean {
    let result = false;
    this.isAdmin$.pipe(take(1)).subscribe(admin => result = admin);
    return result;
  }

  isLoading(): boolean {
    let result = false;
    this.loading$.pipe(take(1)).subscribe(loading => result = loading);
    return result;
  }

  getError(): string | null {
    let result: string | null = null;
    this.error$.pipe(take(1)).subscribe(error => result = error);
    return result;
  }

  getTokens(): { accessToken: string; refreshToken: string } | null {
    let result: { accessToken: string; refreshToken: string } | null = null;
    this.tokens$.pipe(take(1)).subscribe(tokens => result = tokens);
    return result;
  }

  // Permission methods
  hasPermission(permission: string): boolean {
    let result = false;
    this.userPermissions$.pipe(take(1)).subscribe(permissions => {
      result = permissions.includes(permission);
    });
    return result;
  }

  hasAnyPermission(permissions: string[]): boolean {
    let result = false;
    this.userPermissions$.pipe(take(1)).subscribe(userPermissions => {
      result = permissions.some(permission => userPermissions.includes(permission));
    });
    return result;
  }

  hasRole(role: string): boolean {
    let result = false;
    this.userRoles$.pipe(take(1)).subscribe(roles => {
      result = roles.includes(role);
    });
    return result;
  }

  hasAnyRole(roles: string[]): boolean {
    let result = false;
    this.userRoles$.pipe(take(1)).subscribe(userRoles => {
      result = roles.some(role => userRoles.includes(role));
    });
    return result;
  }

  getPermissions(): string[] {
    let result: string[] = [];
    this.userPermissions$.pipe(take(1)).subscribe(permissions => result = permissions);
    return result;
  }

  getRoles(): string[] {
    let result: string[] = [];
    this.userRoles$.pipe(take(1)).subscribe(roles => result = roles);
    return result;
  }
}