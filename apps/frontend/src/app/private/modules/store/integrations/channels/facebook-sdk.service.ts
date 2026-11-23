import { Injectable } from '@angular/core';
import {
  EmbeddedSignupFacebookApi,
  EmbeddedSignupFlowError,
} from './embedded-signup-flow';

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

/** The Meta app identifiers the SDK needs; both are public by design. */
export interface FacebookSdkConfig {
  app_id: string | null;
  graph_version: string | null;
}

const SDK_SCRIPT_ID = 'facebook-jssdk';
const SDK_SRC = 'https://connect.facebook.net/es_LA/sdk.js';
const SDK_LOAD_TIMEOUT_MS = 15000;

/**
 * Loads and initialises Meta's JS SDK once per page. Shared by the store
 * panel (inline signup on the fixed host) and the public signup bridge.
 */
@Injectable({ providedIn: 'root' })
export class FacebookSdkService {
  private loadingPromise: Promise<void> | null = null;

  async load(config: FacebookSdkConfig): Promise<EmbeddedSignupFacebookApi> {
    await this.ensureLoaded(config);
    if (!window.FB) {
      throw new EmbeddedSignupFlowError('WhatsApp no está listo para conectar');
    }
    return window.FB;
  }

  private ensureLoaded(config: FacebookSdkConfig): Promise<void> {
    if (typeof window === 'undefined') {
      return Promise.reject(
        new Error('WhatsApp no está disponible en este momento'),
      );
    }

    if (window.FB) {
      this.init(config);
      return Promise.resolve();
    }

    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('WhatsApp no respondió a tiempo'));
      }, SDK_LOAD_TIMEOUT_MS);

      window.fbAsyncInit = () => {
        this.init(config);
        window.clearTimeout(timeout);
        resolve();
      };

      const existingScript = document.getElementById(SDK_SCRIPT_ID);
      if (existingScript) return;

      const script = document.createElement('script');
      script.id = SDK_SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.src = SDK_SRC;
      script.onerror = () => {
        // Remove the failed tag, or a retry would wait for it forever.
        script.remove();
        window.clearTimeout(timeout);
        reject(new Error('No fue posible preparar la conexión de WhatsApp'));
      };
      document.body.appendChild(script);
    }).catch((error: unknown) => {
      // The service lives for the whole app: let the next attempt retry.
      this.loadingPromise = null;
      throw error;
    });

    return this.loadingPromise;
  }

  private init(config: FacebookSdkConfig): void {
    window.FB?.init({
      appId: config.app_id,
      cookie: true,
      xfbml: true,
      version: config.graph_version,
    });
  }
}
