import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PushSubscriptionService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/store/notifications/push`;

  private sw_registration: ServiceWorkerRegistration | null = null;
  private vapid_public_key: string | null = null;

  get isSupported(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window;
  }

  get permissionState(): NotificationPermission {
    return this.isSupported ? Notification.permission : 'denied';
  }

  /**
   * Register the push service worker.
   * Safe to call multiple times — browsers deduplicate registrations.
   */
  async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!this.isSupported) return null;

    try {
      this.sw_registration = await navigator.serviceWorker.register('/push-sw.js', {
        scope: '/',
      });
      return this.sw_registration;
    } catch (err) {
      console.warn('[PushSubscription] SW registration failed:', err);
      return null;
    }
  }

  /**
   * Request notification permission, subscribe to push, and save to backend.
   * Returns true if subscription was successful.
   */
  async requestPermissionAndSubscribe(): Promise<boolean> {
    if (!this.isSupported) return false;

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;

      const registration = await this.registerServiceWorker();
      if (!registration) return false;

      // Fetch VAPID public key from backend
      if (!this.vapid_public_key) {
        const response: any = await firstValueFrom(
          this.http.get(`${this.baseUrl}/vapid-key`),
        );
        this.vapid_public_key = response?.data?.key || '';
      }

      if (!this.vapid_public_key) {
        console.warn('[PushSubscription] No VAPID key from backend');
        return false;
      }

      // Subscribe to push
      const push_sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(this.vapid_public_key),
      });

      const push_json = push_sub.toJSON();

      // Save to backend
      await firstValueFrom(
        this.http.patch(`${this.baseUrl}/subscribe`, {
          subscription: {
            endpoint: push_json.endpoint,
            keys: {
              p256dh: push_json.keys?.['p256dh'] || '',
              auth: push_json.keys?.['auth'] || '',
            },
          },
          user_agent: navigator.userAgent,
        }),
      );

      return true;
    } catch (err) {
      console.warn('[PushSubscription] Subscribe failed:', err);
      return false;
    }
  }

  /**
   * Unsubscribe from push notifications and remove from backend.
   */
  async unsubscribe(): Promise<void> {
    if (!this.isSupported) return;

    try {
      const registration = this.sw_registration || await navigator.serviceWorker.getRegistration('/');
      if (!registration) return;

      const push_sub = await registration.pushManager.getSubscription();
      if (!push_sub) return;

      const endpoint = push_sub.endpoint;

      await push_sub.unsubscribe();

      await firstValueFrom(
        this.http.patch(`${this.baseUrl}/unsubscribe`, { endpoint }),
      ).catch(() => {});
    } catch (err) {
      console.warn('[PushSubscription] Unsubscribe failed:', err);
    }
  }

  /**
   * Silently refresh push subscription (for returning users who already granted permission).
   * Registers SW and ensures subscription is saved to backend.
   */
  async refreshSubscription(): Promise<void> {
    if (!this.isSupported || this.permissionState !== 'granted') return;
    await this.requestPermissionAndSubscribe();
  }

  /**
   * Convert a URL-safe base64 VAPID key to Uint8Array for pushManager.subscribe().
   */
  private urlBase64ToUint8Array(base64_string: string): Uint8Array {
    const padding = '='.repeat((4 - (base64_string.length % 4)) % 4);
    const base64 = (base64_string + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      output[i] = raw.charCodeAt(i);
    }
    return output;
  }
}
