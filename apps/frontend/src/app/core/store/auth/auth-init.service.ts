import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthState } from './auth.reducer';
import * as AuthActions from './auth.actions';

@Injectable({ providedIn: 'root' })
export class AuthInitService {
  private readonly LOCALSTORAGE_KEY = 'vendix_auth_state';

  constructor(private store: Store) {}

  initAuthState(): void {
    try {
      const raw = localStorage.getItem(this.LOCALSTORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.user && parsed.tokens) {
        this.store.dispatch(
          AuthActions.restoreAuthState({
            user: parsed.user,
            user_settings: parsed.user_settings,
            tokens: parsed.tokens,
            permissions: parsed.permissions || [],
            roles: parsed.roles || []
          })
        );
      }
    } catch (e) {
      // Si hay error, no restaurar nada
      console.warn('[AuthInitService] Error restoring auth state:', e);
    }
  }
}
