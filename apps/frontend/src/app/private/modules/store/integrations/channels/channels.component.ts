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
import { ChannelsService } from './channels.service';
import { MessagingChannelCardsComponent } from './messaging-channels/messaging-channel-cards.component';
import { MetaReadiness, WhatsappChannel } from './channels.interface';
import {
  allowsRegistrationRetry,
  channelAlertMessage,
  CONNECT_HELP_MESSAGE,
  connectedOutcome,
  COEXISTENCE_DISCONNECT_NOTE,
  COEXISTENCE_PHONE_LINE,
  isCoexistenceChannel,
  needsRegistrationNotice,
} from './channels-coexistence';
import {
  EmbeddedSignupFlowError,
  EmbeddedSignupFlowResult,
  startEmbeddedSignupFlow,
} from './embedded-signup-flow';
import { FacebookSdkService } from './facebook-sdk.service';
import {
  createSignupBridgeNonce,
  openSignupBridge,
  shouldUseSignupBridge,
  waitForSignupBridgeResult,
  whatsappSignupBridgeOrigin,
} from './whatsapp-signup-bridge';
import { environment } from '../../../../../../environments/environment';

@Component({
  selector: 'app-integrations-channels',
  standalone: true,
  imports: [
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    MessagingChannelCardsComponent,
    StickyHeaderComponent,
  ],
  template: `
    <section class="w-full">
      <app-sticky-header
        title="Canales"
        subtitle="Conecta tus canales de mensajería y administra sus credenciales."
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

        @if (channelAlert(); as alert) {
          <app-alert-banner variant="warning" icon="triangle-alert">
            {{ alert }}
          </app-alert-banner>
        }

        @if (showRegistrationNotice()) {
          <app-alert-banner variant="warning" icon="triangle-alert">
            {{
              channel()?.last_error ||
                'Falta registrar el número de WhatsApp para poder enviar mensajes. Usa "Reintentar registro".'
            }}
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

            <div class="flex flex-col gap-3 pt-1 lg:max-w-sm lg:pt-0">
              <div class="flex flex-wrap gap-3">
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
                  @if (canRetryRegistration()) {
                    <app-button
                      variant="outline"
                      size="md"
                      [loading]="registering()"
                      (clicked)="retryRegistration()"
                    >
                      <app-icon
                        slot="icon"
                        name="refresh-cw"
                        [size]="16"
                      ></app-icon>
                      Reintentar registro
                    </app-button>
                  }
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
              @if (channel()?.connected) {
                @if (isCoexistence()) {
                  <p class="text-xs text-[var(--color-text-secondary)]">
                    {{ coexistenceDisconnectNote }}
                  </p>
                }
              } @else {
                <p class="text-xs text-[var(--color-text-secondary)]">
                  {{ connectHelp }}
                </p>
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
                  @if (isCoexistence()) {
                    <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
                      {{ coexistencePhoneLine }}
                    </p>
                  }
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

        <app-messaging-channel-cards></app-messaging-channel-cards>
      </div>
    </section>
  `,
})
export class ChannelsComponent {
  private readonly service = inject(ChannelsService);
  private readonly toast = inject(ToastService);
  private readonly facebookSdk = inject(FacebookSdkService);

  protected readonly loading = signal(false);
  protected readonly connecting = signal(false);
  protected readonly disconnecting = signal(false);
  protected readonly registering = signal(false);
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

  protected readonly canRetryRegistration = computed(
    // Also covers channels connected before registration existed: status
    // 'connected' with no registration state yet. Never for coexistence.
    () => allowsRegistrationRetry(this.channel()) && !this.registering(),
  );

  protected readonly showRegistrationNotice = computed(() =>
    needsRegistrationNotice(this.channel()),
  );

  protected readonly isCoexistence = computed(() =>
    isCoexistenceChannel(this.channel()),
  );

  protected readonly channelAlert = computed(() =>
    channelAlertMessage(this.channel()),
  );

  protected readonly connectHelp = CONNECT_HELP_MESSAGE;
  protected readonly coexistencePhoneLine = COEXISTENCE_PHONE_LINE;
  protected readonly coexistenceDisconnectNote = COEXISTENCE_DISCONNECT_NOTE;

  protected readonly channelStatusLabel = computed(() => {
    const channel = this.channel();
    if (channel?.connected) return 'Conectado';
    if (channel?.status === 'error') return 'Error';
    if (this.readiness()?.status === 'pending_approval') return 'Pendiente';
    return 'No conectado';
  });

  protected readonly channelBadgeVariant = computed<BadgeVariant>(() => {
    if (this.channel()?.connected) return 'success';
    if (this.channel()?.status === 'error') return 'error';
    if (this.readiness()?.status === 'pending_approval') return 'warning';
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

    this.error.set(null);

    // Meta only answers on the fixed host. Elsewhere the signup runs in the
    // bridge window, which must open synchronously inside this click.
    const bridgeOrigin = whatsappSignupBridgeOrigin(environment.vendixDomain);
    let bridge: { popup: Window; nonce: string } | null = null;
    if (shouldUseSignupBridge(window.location.origin, bridgeOrigin)) {
      const nonce = createSignupBridgeNonce();
      try {
        const popup = openSignupBridge(
          (url, target, features) => window.open(url, target, features),
          bridgeOrigin,
          window.location.origin,
          nonce,
        );
        bridge = { popup, nonce };
      } catch (error) {
        this.error.set(this.extractErrorMessage(error));
        return;
      }
    }

    this.connecting.set(true);

    try {
      const signup: EmbeddedSignupFlowResult = bridge
        ? await waitForSignupBridgeResult(
            bridge.popup,
            bridgeOrigin,
            bridge.nonce,
          )
        : await startEmbeddedSignupFlow(
            await this.facebookSdk.load(readiness),
            readiness,
          );
      const channel = await firstValueFrom(
        this.service.completeWhatsappEmbeddedSignup(signup),
      );
      this.channel.set(channel);
      const outcome = connectedOutcome(channel);
      if (outcome.kind === 'error') {
        this.error.set(outcome.message);
      } else {
        this.toast.success(outcome.message);
      }
    } catch (error) {
      this.error.set(this.extractErrorMessage(error));
    } finally {
      this.connecting.set(false);
    }
  }

  protected async retryRegistration(): Promise<void> {
    this.registering.set(true);
    this.error.set(null);

    try {
      const channel = await firstValueFrom(
        this.service.retryWhatsappRegistration(),
      );
      this.channel.set(channel);
      if (channel.status === 'error') {
        this.error.set(channel.last_error || 'No se pudo registrar el número.');
      } else {
        this.toast.success('El número quedó registrado.');
      }
    } catch (error) {
      this.error.set(this.extractErrorMessage(error));
    } finally {
      this.registering.set(false);
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

  private extractErrorMessage(error: unknown): string {
    // Messages written by the popup flow are already user-facing Spanish.
    if (error instanceof EmbeddedSignupFlowError) return error.message;

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
