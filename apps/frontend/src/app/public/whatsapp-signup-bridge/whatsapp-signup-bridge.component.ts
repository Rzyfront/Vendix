import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Meta } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ButtonComponent } from '../../shared/components/button/button.component';
import {
  EMBEDDED_SIGNUP_ERROR_MESSAGE,
  EmbeddedSignupFacebookApi,
  EmbeddedSignupFlowError,
  EmbeddedSignupFlowResult,
  startEmbeddedSignupFlow,
} from '../../private/modules/store/integrations/channels/embedded-signup-flow';
import { FacebookSdkService } from '../../private/modules/store/integrations/channels/facebook-sdk.service';
import {
  WHATSAPP_SIGNUP_UNVERIFIED_ORIGIN_MESSAGE,
  buildSignupBridgeMessage,
  isSignupBridgeNonce,
  parseSignupBridgeOrigin,
  signupBridgeLookupHostname,
  whatsappSignupBridgeOrigin,
} from '../../private/modules/store/integrations/channels/whatsapp-signup-bridge';

type BridgeState =
  | 'checking'
  | 'ready'
  | 'connecting'
  | 'done'
  | 'invalid'
  | 'unavailable';

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface PublicSignupConfig {
  can_start_signup: boolean;
  app_id: string | null;
  whatsapp_config_id: string | null;
  graph_version: string | null;
}

interface ResolvedDomain {
  store_name?: string | null;
  organization_name?: string | null;
}

const UNAVAILABLE_MESSAGE = 'WhatsApp no está disponible en este momento.';

/**
 * Public page on the fixed host (vendix.online) that runs Meta's Embedded
 * Signup for a store panel opened on any other host. It has no session: it
 * validates who opened it, shows which store the connection goes to, runs
 * the signup and posts the result to that exact origin only.
 */
@Component({
  selector: 'app-whatsapp-signup-bridge',
  standalone: true,
  imports: [ButtonComponent],
  template: `
    <main
      class="min-h-screen flex items-center justify-center bg-[var(--color-background)] p-4"
    >
      <section
        class="w-full max-w-md rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] p-6 text-center space-y-4"
      >
        <h1 class="text-lg font-semibold text-[var(--color-text-primary)]">
          Conectar WhatsApp
        </h1>

        @switch (state()) {
          @case ('checking') {
            <p class="text-sm text-[var(--color-text-secondary)]">
              Verificando la conexión…
            </p>
          }
          @case ('ready') {
            <p class="text-sm text-[var(--color-text-primary)]">
              @if (storeName()) {
                Vas a conectar WhatsApp a la tienda
                <strong>{{ storeName() }}</strong> ({{ targetHost() }})
              } @else {
                Vas a conectar WhatsApp desde
                <strong>{{ targetHost() }}</strong>
              }
            </p>
            <p class="text-sm text-[var(--color-text-secondary)]">
              Se abrirá el asistente de Meta para elegir tu cuenta de WhatsApp
              Business y tu número.
            </p>
            <app-button
              variant="primary"
              size="md"
              [fullWidth]="true"
              (clicked)="continueSignup()"
            >
              Continuar
            </app-button>
          }
          @case ('connecting') {
            <p class="text-sm text-[var(--color-text-secondary)]">
              Completa la conexión en la ventana de Meta.
            </p>
          }
          @case ('done') {
            <p class="text-sm text-[var(--color-text-secondary)]">
              Listo. Puedes cerrar esta ventana.
            </p>
          }
          @default {
            <p class="text-sm text-[var(--color-text-primary)]" role="alert">
              {{ message() }}
            </p>
          }
        }
      </section>
    </main>
  `,
})
export class WhatsappSignupBridgeComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly facebookSdk = inject(FacebookSdkService);
  private readonly meta = inject(Meta);
  private readonly bridgeOrigin = whatsappSignupBridgeOrigin(
    environment.vendixDomain,
  );

  protected readonly state = signal<BridgeState>('checking');
  protected readonly message = signal<string | null>(null);
  protected readonly storeName = signal<string | null>(null);
  protected readonly targetHost = signal('');

  /** Set only after the opener origin was verified. */
  private target: { origin: string; nonce: string } | null = null;
  private config: PublicSignupConfig | null = null;
  private fb: EmbeddedSignupFacebookApi | null = null;

  async ngOnInit(): Promise<void> {
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });

    const params = this.route.snapshot.queryParamMap;
    const origin = parseSignupBridgeOrigin(params.get('origin'));
    const nonce = params.get('nonce');
    if (!origin || !isSignupBridgeNonce(nonce) || !window.opener) {
      this.showProblem('invalid', WHATSAPP_SIGNUP_UNVERIFIED_ORIGIN_MESSAGE);
      return;
    }

    let storeName: string | null;
    try {
      storeName = await this.verifyOrigin(origin);
    } catch {
      this.showProblem('invalid', WHATSAPP_SIGNUP_UNVERIFIED_ORIGIN_MESSAGE);
      return;
    }
    this.target = { origin: origin.origin, nonce };
    this.targetHost.set(origin.host);
    this.storeName.set(storeName);

    try {
      const config = await this.loadSignupConfig();
      if (!config.can_start_signup) {
        this.finish({ error: UNAVAILABLE_MESSAGE }, 'unavailable');
        return;
      }
      // Load the SDK now, so "Continuar" calls FB.login inside the click.
      this.fb = await this.facebookSdk.load(config);
      this.config = config;
      this.state.set('ready');
    } catch (error) {
      this.finish(
        {
          error:
            error instanceof EmbeddedSignupFlowError
              ? error.message
              : UNAVAILABLE_MESSAGE,
        },
        'unavailable',
      );
    }
  }

  protected continueSignup(): void {
    if (!this.fb || !this.config || !this.target) return;
    this.state.set('connecting');
    startEmbeddedSignupFlow(this.fb, this.config).then(
      (result) => this.finish({ result }, 'done'),
      (error: unknown) =>
        this.finish(
          {
            error:
              error instanceof EmbeddedSignupFlowError
                ? error.message
                : EMBEDDED_SIGNUP_ERROR_MESSAGE,
          },
          'unavailable',
        ),
    );
  }

  /** The fixed host is always accepted; any other must be an active Vendix domain. */
  private async verifyOrigin(origin: URL): Promise<string | null> {
    if (origin.origin === this.bridgeOrigin) return null;
    const hostname = encodeURIComponent(signupBridgeLookupHostname(origin));
    const response = await firstValueFrom(
      this.http.get<ApiResponse<ResolvedDomain>>(
        `${environment.apiUrl}/public/domains/resolve/${hostname}`,
      ),
    );
    return (
      response.data?.store_name || response.data?.organization_name || null
    );
  }

  private async loadSignupConfig(): Promise<PublicSignupConfig> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<PublicSignupConfig>>(
        `${environment.apiUrl}/public/meta/whatsapp/signup-config`,
      ),
    );
    return response.data;
  }

  private showProblem(state: 'invalid' | 'unavailable', message: string) {
    this.message.set(message);
    this.state.set(state);
  }

  /** Answers the verified opener only, then closes the bridge. */
  private finish(
    outcome: { result: EmbeddedSignupFlowResult } | { error: string },
    state: 'done' | 'unavailable',
  ): void {
    if (state === 'unavailable' && 'error' in outcome) {
      this.showProblem('unavailable', outcome.error);
    } else {
      this.state.set(state);
    }
    if (!this.target) return;
    window.opener?.postMessage(
      buildSignupBridgeMessage(this.target.nonce, outcome),
      this.target.origin,
    );
    window.close();
  }
}
