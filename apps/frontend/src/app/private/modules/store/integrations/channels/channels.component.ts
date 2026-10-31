import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom, forkJoin } from 'rxjs';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../shared/components';
import type {
  BadgeVariant,
  StickyHeaderActionButton,
} from '../../../../../shared/components';
import { SocialSalesService } from './social-sales.service';
import { MetaReadiness, WhatsappChannel } from './social-sales.interface';

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

interface EmbeddedSignupResult {
  code: string;
  waba_id: string;
  phone_number_id: string;
  display_phone_number?: string;
  business_account_id?: string;
}

@Component({
  selector: 'app-social-sales',
  standalone: true,
  imports: [
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    StickyHeaderComponent,
  ],
  template: `
    <section class="w-full">
      <app-sticky-header
        title="Social Sales"
        subtitle="Conecta WhatsApp para iniciar ventas conversacionales."
        icon="message-circle"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      ></app-sticky-header>

      <div class="space-y-7">
        @if (error()) {
          <app-alert-banner variant="danger" icon="triangle-alert">
            {{ error() }}
          </app-alert-banner>
        }

        <app-card [responsivePadding]="true" overflow="visible">
          <div class="flex flex-col gap-7 lg:flex-row lg:items-start">
            <div class="flex min-w-0 flex-1 items-start gap-5">
              <div
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-green-100 text-green-700"
              >
                <app-icon name="message-circle" [size]="22"></app-icon>
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h2
                    class="text-base font-semibold text-[var(--color-text-primary)]"
                  >
                    WhatsApp Business
                  </h2>
                  <app-badge [variant]="channelBadgeVariant()" size="sm">
                    {{ channelStatusLabel() }}
                  </app-badge>
                </div>
                <p class="mt-3 text-sm text-[var(--color-text-secondary)]">
                  Canal base para recibir mensajes, conectar inbox e iniciar
                  flujos de venta asistidos por IA.
                </p>
              </div>
            </div>

            <div class="flex flex-wrap gap-3 pt-1 lg:pt-0">
              @if (channel()?.connected) {
                <app-button
                  variant="outline-danger"
                  size="md"
                  [loading]="disconnecting()"
                  (clicked)="disconnectWhatsapp()"
                >
                  <app-icon slot="icon" name="plug" [size]="16"></app-icon>
                  Desconectar
                </app-button>
              } @else {
                <app-button
                  variant="primary"
                  size="md"
                  [disabled]="!canConnectWhatsapp()"
                  [loading]="connecting()"
                  (clicked)="connectWhatsapp()"
                >
                  <app-icon
                    slot="icon"
                    name="message-circle"
                    [size]="16"
                  ></app-icon>
                  Conectar WhatsApp
                </app-button>
              }
            </div>
          </div>
        </app-card>

        @if (readiness()) {
          <app-card [responsivePadding]="true">
            <div class="flex flex-col gap-7">
              <div class="flex flex-wrap items-center justify-between gap-5">
                <div>
                  <h2
                    class="text-base font-semibold text-[var(--color-text-primary)]"
                  >
                    Disponibilidad de WhatsApp
                  </h2>
                  <p class="mt-3 text-sm text-[var(--color-text-secondary)]">
                    La conexión de WhatsApp se habilitará cuando esté lista para
                    tu tienda.
                  </p>
                </div>
                <app-badge [variant]="readinessBadgeVariant()" size="sm">
                  {{ readinessStatusLabel() }}
                </app-badge>
              </div>

              @if (readiness()?.can_start_signup) {
                <app-alert-banner variant="success" icon="check-circle">
                  WhatsApp está disponible para conectar.
                </app-alert-banner>
              } @else {
                <app-alert-banner variant="warning" icon="lock">
                  WhatsApp no está disponible en este momento.
                </app-alert-banner>
              }
            </div>
          </app-card>
        }

        <app-card [responsivePadding]="true">
          <div class="flex flex-col gap-7">
            <div>
              <h2
                class="text-base font-semibold text-[var(--color-text-primary)]"
              >
                Canal conectado
              </h2>
              <p class="mt-3 text-sm text-[var(--color-text-secondary)]">
                Esta información pertenece a la tienda actual.
              </p>
            </div>

            @if (loading()) {
              <div
                class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"
              >
                <app-icon name="loader-2" [size]="18" [spin]="true"></app-icon>
                Cargando estado del canal...
              </div>
            } @else if (channel()?.connected) {
              <div class="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                <div class="rounded-lg border border-[var(--color-border)] p-4">
                  <p class="text-xs text-[var(--color-text-secondary)]">
                    Cuenta
                  </p>
                  <p
                    class="mt-1 truncate text-sm font-medium text-[var(--color-text-primary)]"
                  >
                    WhatsApp Business
                  </p>
                </div>
                <div class="rounded-lg border border-[var(--color-border)] p-4">
                  <p class="text-xs text-[var(--color-text-secondary)]">
                    Estado
                  </p>
                  <p
                    class="mt-1 truncate text-sm font-medium text-[var(--color-text-primary)]"
                  >
                    Conectado
                  </p>
                </div>
                <div class="rounded-lg border border-[var(--color-border)] p-4">
                  <p class="text-xs text-[var(--color-text-secondary)]">
                    Número
                  </p>
                  <p
                    class="mt-1 text-sm font-medium text-[var(--color-text-primary)]"
                  >
                    {{ channel()?.display_phone_number || 'No disponible' }}
                  </p>
                </div>
                <div class="rounded-lg border border-[var(--color-border)] p-4">
                  <p class="text-xs text-[var(--color-text-secondary)]">
                    Conectado
                  </p>
                  <p
                    class="mt-1 text-sm font-medium text-[var(--color-text-primary)]"
                  >
                    {{ formatDate(channel()?.connected_at) }}
                  </p>
                </div>
              </div>
            } @else {
              <div
                class="flex flex-col items-start gap-5 rounded-lg border border-dashed border-[var(--color-border)] p-5 sm:flex-row sm:items-center"
              >
                <div
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-muted)]"
                >
                  <app-icon name="plug" [size]="20"></app-icon>
                </div>
                <div>
                  <p
                    class="text-sm font-medium text-[var(--color-text-primary)]"
                  >
                    WhatsApp todavía no está conectado.
                  </p>
                  <p class="mt-3 text-sm text-[var(--color-text-secondary)]">
                    Cuando esté disponible, podrás iniciar la conexión desde
                    esta pantalla.
                  </p>
                </div>
              </div>
            }
          </div>
        </app-card>
      </div>
    </section>
  `,
})
export class SocialSalesComponent {
  private readonly service = inject(SocialSalesService);
  private readonly toast = inject(ToastService);
  private sdkLoadingPromise: Promise<void> | null = null;

  protected readonly loading = signal(false);
  protected readonly connecting = signal(false);
  protected readonly disconnecting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly readiness = signal<MetaReadiness | null>(null);
  protected readonly channel = signal<WhatsappChannel | null>(null);

  protected readonly headerActions = computed<StickyHeaderActionButton[]>(
    () => [
      {
        id: 'refresh',
        label: 'Actualizar',
        variant: 'outline',
        icon: 'refresh-cw',
        loading: this.loading(),
      },
    ],
  );

  protected readonly canConnectWhatsapp = computed(() => {
    const readiness = this.readiness();
    const channel = this.channel();
    return Boolean(
      readiness?.can_start_signup && !channel?.connected && !this.connecting(),
    );
  });

  protected readonly channelStatusLabel = computed(() => {
    const channel = this.channel();
    if (channel?.connected) return 'Conectado';
    if (channel?.status === 'error') return 'Error';
    return 'No conectado';
  });

  protected readonly channelBadgeVariant = computed<BadgeVariant>(() => {
    if (this.channel()?.connected) return 'success';
    if (this.channel()?.status === 'error') return 'error';
    return 'neutral';
  });

  protected readonly readinessStatusLabel = computed(() => {
    return this.readiness()?.can_start_signup ? 'Disponible' : 'No disponible';
  });

  protected readonly readinessBadgeVariant = computed<BadgeVariant>(() => {
    return this.readiness()?.can_start_signup ? 'success' : 'warning';
  });

  constructor() {
    void this.loadState();
  }

  protected onHeaderAction(actionId: string): void {
    if (actionId === 'refresh') {
      void this.loadState();
    }
  }

  protected async loadState(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const result = await firstValueFrom(
        forkJoin({
          readiness: this.service.getMetaReadiness(),
          channel: this.service.getWhatsappChannel(),
        }),
      );
      this.readiness.set(result.readiness);
      this.channel.set(result.channel);
    } catch (error) {
      this.error.set(this.extractErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected async connectWhatsapp(): Promise<void> {
    const readiness = this.readiness();
    if (!readiness?.can_start_signup) {
      this.toast.warning('WhatsApp no está disponible en este momento.');
      return;
    }

    this.connecting.set(true);
    this.error.set(null);

    try {
      await this.loadFacebookSdk(readiness);
      const signup = await this.startEmbeddedSignupLogin(readiness);
      const channel = await firstValueFrom(
        this.service.completeWhatsappEmbeddedSignup(signup),
      );
      this.channel.set(channel);
      this.toast.success('WhatsApp quedó conectado.');
    } catch (error) {
      this.error.set(this.extractErrorMessage(error));
    } finally {
      this.connecting.set(false);
    }
  }

  protected async disconnectWhatsapp(): Promise<void> {
    this.disconnecting.set(true);
    this.error.set(null);

    try {
      const channel = await firstValueFrom(this.service.disconnectWhatsapp());
      this.channel.set(channel);
      this.toast.success('WhatsApp fue desconectado.');
    } catch (error) {
      this.error.set(this.extractErrorMessage(error));
    } finally {
      this.disconnecting.set(false);
    }
  }

  protected formatDate(value?: string | null): string {
    if (!value) return 'No disponible';
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  private loadFacebookSdk(readiness: MetaReadiness): Promise<void> {
    if (typeof window === 'undefined') {
      return Promise.reject(
        new Error('WhatsApp no está disponible en este momento'),
      );
    }

    if (window.FB) {
      window.FB.init({
        appId: readiness.app_id,
        cookie: true,
        xfbml: true,
        version: readiness.graph_version,
      });
      return Promise.resolve();
    }

    if (this.sdkLoadingPromise) return this.sdkLoadingPromise;

    this.sdkLoadingPromise = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('WhatsApp no respondió a tiempo'));
      }, 15000);

      window.fbAsyncInit = () => {
        window.FB?.init({
          appId: readiness.app_id,
          cookie: true,
          xfbml: true,
          version: readiness.graph_version,
        });
        window.clearTimeout(timeout);
        resolve();
      };

      const existingScript = document.getElementById('facebook-jssdk');
      if (existingScript) return;

      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.async = true;
      script.defer = true;
      script.src = 'https://connect.facebook.net/es_LA/sdk.js';
      script.onerror = () =>
        reject(new Error('No fue posible preparar la conexión de WhatsApp'));
      document.body.appendChild(script);
    });

    return this.sdkLoadingPromise;
  }

  private startEmbeddedSignupLogin(
    readiness: MetaReadiness,
  ): Promise<EmbeddedSignupResult> {
    return new Promise((resolve, reject) => {
      let loginCode: string | null = null;
      let signupData: any = null;
      let settled = false;

      const allowedOrigins = new Set([
        'https://www.facebook.com',
        'https://web.facebook.com',
      ]);

      const cleanup = () => {
        window.clearTimeout(timeout);
        window.removeEventListener('message', handleMessage);
      };

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(message));
      };

      const finishIfReady = () => {
        if (settled || !loginCode) return;
        if (!signupData?.waba_id || !signupData?.phone_number_id) return;

        settled = true;
        cleanup();
        resolve({
          code: loginCode,
          waba_id: signupData.waba_id,
          phone_number_id: signupData.phone_number_id,
          display_phone_number: signupData.display_phone_number,
          business_account_id: signupData.business_id,
        });
      };

      const handleMessage = (event: MessageEvent) => {
        if (!allowedOrigins.has(event.origin)) return;

        const data = this.parseEmbeddedSignupMessage(event.data);
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;

        if (data.event === 'FINISH') {
          signupData = data.data;
          finishIfReady();
        }

        if (data.event === 'ERROR') {
          fail(
            data.data?.error_message ||
              'WhatsApp no pudo completar la conexión',
          );
        }
      };

      const timeout = window.setTimeout(() => {
        fail('WhatsApp no completó la conexión a tiempo');
      }, 45000);

      window.addEventListener('message', handleMessage);

      if (!window.FB) {
        fail('WhatsApp no está listo para conectar');
        return;
      }

      window.FB?.login(
        (response: any) => {
          const code = response?.authResponse?.code;
          if (!code) {
            fail('WhatsApp no autorizó la conexión');
            return;
          }

          loginCode = code;
          finishIfReady();
        },
        {
          config_id: readiness.whatsapp_config_id,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: 'whatsapp_embedded_signup',
          },
        },
      );
    });
  }

  private parseEmbeddedSignupMessage(data: unknown): any {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    }
    return data;
  }

  private extractErrorMessage(error: unknown): string {
    const apiError = error as any;
    const message =
      apiError?.error?.message ||
      apiError?.error?.error?.message ||
      apiError?.message ||
      'No fue posible completar la operación';

    return this.isInternalConnectionMessage(message)
      ? 'WhatsApp no está disponible en este momento.'
      : message;
  }

  private isInternalConnectionMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return [
      'meta',
      'facebook',
      'embedded signup',
      'sdk',
      'config',
      'app review',
      'graph',
      'waba',
      'phone_number_id',
      'social_channel_encryption_key',
      'meta_',
    ].some((term) => normalized.includes(term));
  }
}
