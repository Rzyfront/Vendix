import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class StoreContextService {
  /**
   * Get store ID from JWT token (reads from vendix_auth_state)
   */
  getStoreId(): number | null {
    const token = this.getAccessToken();
    if (!token) {
      return null;
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.store_id ? parseInt(payload.store_id) : null;
    } catch (e) {
      console.error('❌ Error parsing token for store ID:', e);
      return null;
    }
  }

  /**
   * Helper method to get access token from vendix_auth_state
   */
  private getAccessToken(): string | null {
    try {
      const authState = localStorage.getItem('vendix_auth_state');
      if (!authState) return null;
      const parsed = JSON.parse(authState);
      return parsed.tokens?.access_token || null;
    } catch (e) {
      console.error('❌ Error reading access token from auth state:', e);
      return null;
    }
  }

  /**
   * Get store ID with error throwing
   */
  getStoreIdOrThrow(): number {
    const storeId = this.getStoreId();
    if (!storeId) {
      throw new Error('No se pudo determinar el store ID del contexto actual');
    }
    return storeId;
  }

  /**
   * Get organization ID from JWT token (reads from vendix_auth_state)
   */
  getOrganizationId(): number | null {
    const token = this.getAccessToken();
    if (!token) {
      return null;
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.organization_id ? parseInt(payload.organization_id) : null;
    } catch (e) {
      console.error('❌ Error parsing token for organization ID:', e);
      return null;
    }
  }

  /**
   * Get user ID from JWT token (reads from vendix_auth_state)
   */
  getUserId(): number | null {
    const token = this.getAccessToken();
    if (!token) {
      return null;
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.sub ? parseInt(payload.sub) : null;
    } catch (e) {
      console.error('❌ Error parsing token for user ID:', e);
      return null;
    }
  }

  /**
   * Check if token exists and is valid (reads from vendix_auth_state)
   */
  hasValidToken(): boolean {
    const token = this.getAccessToken();
    if (!token) {
      return false;
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      return payload.exp > now;
    } catch (e) {
      return false;
    }
  }
}
