import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import {
  Observable,
  concat,
  filter,
  isObservable,
  map,
  switchMap,
  tap,
  toArray,
} from 'rxjs';
import { TenantFacade } from '../../core/store/tenant/tenant.facade';
import { AuthFacade } from '../../core/store/auth/auth.facade';
import { AppType } from '../../core/models/environment.enum';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../shared/pipes/currency/currency.pipe';
import { PqrService } from '../../shared/services/pqr.service';
import { CartService } from '../../private/modules/ecommerce/services/cart.service';
import { CheckoutService } from '../../private/modules/ecommerce/services/checkout.service';
import { StoreUiService } from '../../private/modules/ecommerce/services/store-ui.service';
import {
  VexiPublicApi,
  VexiPublicCard,
  VexiPublicConfig,
  VexiPublicContext,
  VexiPublicErrorState,
  VexiPublicSession,
  vexiPublicErrorState,
} from './vexi-public.api';
import { VexiPublicPresenceService } from './vexi-public-presence.service';
import { vexiOrderHandoffUrl } from './vexi-public.handoff';

/** Apps where Vexi público appears (F2). */
export const VEXI_PUBLIC_APPS: readonly AppType[] = [
  AppType.STORE_ECOMMERCE,
  AppType.STORE_PRODUCT_PAGE,
  AppType.STORE_SERVICE_PAGE,
];

/** Routes where the bubble never shows (payment steps). */
const HIDDEN_ROUTES = [/^\/pagar(\/|$)/, /^\/checkout(\/|\?|$)/];

const CONSENT_KEY = 'vexi_public_consent';
const SESSION_KEY = 'vexi_public_session';
const HANDOFF_KEY = 'vexi_public_handoff';

type ChatLine = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  cards?: VexiPublicCard[];
  action?: 'login';
  handoffUrl?: string | null;
};

type RequestFormState = {
  name: string;
  email: string;
  phone: string;
  status: 'idle' | 'sending' | 'done' | 'error';
  ticket?: string;
};

const ERROR_TEXT: Record<VexiPublicErrorState, string> = {
  rate_limited: 'Vas muy rápido. Espera un momento y vuelve a escribirme.',
  daily_cap:
    'Hoy ya atendí muchas conversaciones y no puedo seguir. Escríbele a la tienda directamente.',
  disabled: 'Vexi no está disponible en esta tienda en este momento.',
  unavailable: 'Vexi no está disponible en este momento. Intenta más tarde.',
  session_expired: 'Tu conversación expiró. Escríbeme de nuevo.',
};

function readStorage<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode without storage: the chat still works for this page.
  }
}

/**
 * Vexi público F2 — the customer-facing chat on the store's public apps.
 *
 * The bubble is Vexi dressed as the store's WhatsApp button (same shape and
 * green, conversation icon). Text only (D1): no listen button, no TTS, no
 * audio. Vexi proposes; this widget executes with the visitor's identity
 * through the existing cart/checkout, booking page and PQR endpoint, so every
 * store rule (prices, stock, `require_registration`, `allow_guest_booking`)
 * still applies. After an order placed from Vexi it hands the visitor off to
 * the store's real WhatsApp asking about that order.
 */
@Component({
  selector: 'app-vexi-public-widget',
  standalone: true,
  imports: [IconComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      @if (open()) {
        <section
          class="fixed bottom-24 right-4 z-[60] flex h-[min(560px,calc(100vh-8rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10"
          role="dialog"
          aria-label="Chat con Vexi"
          data-testid="vexi-public-panel"
        >
          <header class="flex items-center gap-3 bg-[#075E54] px-4 py-3 text-white">
            <img
              src="assets/vexi/vexi-idle.webp"
              alt=""
              class="h-9 w-9 rounded-full bg-[#25D366]/30 object-contain"
              (error)="avatarFailed.set(true)"
              [class.hidden]="avatarFailed()"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold leading-tight">Vexi</p>
              <p class="truncate text-xs text-white/80">
                {{ config()?.store_name || 'Asistente de la tienda' }} · en línea
              </p>
            </div>
            <button
              type="button"
              class="rounded-full p-1 hover:bg-white/10"
              aria-label="Cerrar chat"
              (click)="open.set(false)"
            >
              <app-icon name="x" [size]="18" />
            </button>
          </header>

          @if (!consented()) {
            <div class="flex flex-1 flex-col justify-end gap-3 bg-[#ECE5DD] p-4" data-testid="vexi-public-consent">
              <div class="rounded-xl bg-white p-3 text-sm text-gray-700 shadow-sm">
                <p class="mb-2 font-semibold text-gray-900">Antes de empezar</p>
                <p>
                  Vexi es un asistente virtual de {{ config()?.store_name || 'la tienda' }}. Lo que
                  escribas se guarda y la tienda puede leerlo para atenderte, según su política de
                  tratamiento de datos personales (Ley 1581 de 2012). No compartas datos de tarjetas
                  ni contraseñas.
                </p>
              </div>
              <button
                type="button"
                class="rounded-full bg-[#25D366] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1ebe5a]"
                data-testid="vexi-public-accept"
                (click)="acceptConsent()"
              >
                Acepto y empiezo
              </button>
            </div>
          } @else {
            <div class="flex-1 space-y-2 overflow-y-auto bg-[#ECE5DD] p-3" data-testid="vexi-public-messages">
              @for (line of lines(); track line.id) {
                <div class="flex" [class.justify-end]="line.role === 'user'">
                  <div
                    class="max-w-[85%] whitespace-pre-line rounded-xl px-3 py-2 text-sm shadow-sm"
                    [class]="line.role === 'user' ? 'bg-[#DCF8C6] text-gray-900' : 'bg-white text-gray-800'"
                  >
                    {{ line.text }}
                    @if (line.action === 'login') {
                      <button
                        type="button"
                        class="mt-2 flex items-center gap-1 rounded-full bg-[#25D366] px-3 py-1 text-xs font-semibold text-white"
                        (click)="openLogin()"
                      >
                        <app-icon name="log-in" [size]="14" /> Iniciar sesión
                      </button>
                    }
                    @if (line.handoffUrl) {
                      <a
                        class="mt-2 flex w-fit items-center gap-1 rounded-full bg-[#25D366] px-3 py-1 text-xs font-semibold text-white"
                        [href]="line.handoffUrl"
                        target="_blank"
                        rel="noopener"
                        data-testid="vexi-public-handoff"
                      >
                        <app-icon name="message-circle" [size]="14" /> Preguntar por WhatsApp
                      </a>
                    }
                    @for (card of line.cards ?? []; track $index) {
                      <div class="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs">
                        @switch (card.kind) {
                          @case ('order') {
                            <p class="mb-1 flex items-center gap-1 font-semibold">
                              <app-icon name="shopping-cart" [size]="14" /> Tu pedido
                            </p>
                            @if (card.kind === 'order') {
                              @for (item of card.items; track $index) {
                                <p>
                                  {{ item.quantity }} × {{ item.name }}
                                  @if (item.variant_name) { ({{ item.variant_name }}) }
                                  · {{ item.unit_price | currency }}
                                </p>
                              }
                            }
                            <p class="mt-1 text-gray-500">El total, el envío y el pago los ves en la página de pago.</p>
                            <button
                              type="button"
                              class="mt-2 w-full rounded-full bg-[#25D366] px-3 py-1.5 font-semibold text-white disabled:opacity-60"
                              [disabled]="busy()"
                              data-testid="vexi-public-order"
                              (click)="goToCheckout(card)"
                            >
                              Agregar al carrito e ir a pagar
                            </button>
                          }
                          @case ('booking') {
                            <p class="mb-1 flex items-center gap-1 font-semibold">
                              <app-icon name="calendar" [size]="14" /> {{ card.kind === 'booking' ? card.name : '' }}
                            </p>
                            <button
                              type="button"
                              class="mt-1 w-full rounded-full bg-[#25D366] px-3 py-1.5 font-semibold text-white"
                              (click)="goToBooking(card)"
                            >
                              Elegir fecha y hora
                            </button>
                          }
                          @case ('request') {
                            @if (card.kind === 'request') {
                              <p class="mb-1 flex items-center gap-1 font-semibold">
                                <app-icon name="file-text" [size]="14" /> {{ card.subject }}
                              </p>
                              <p class="mb-2 text-gray-600">{{ card.description }}</p>
                              @let form = requestForm(line.id);
                              @if (form.status === 'done') {
                                <p class="font-semibold text-[#075E54]">Radicado: {{ form.ticket }}</p>
                              } @else {
                                <input
                                  class="mb-1 w-full rounded border border-gray-300 px-2 py-1"
                                  placeholder="Tu nombre"
                                  [value]="form.name"
                                  (input)="patchRequest(line.id, 'name', $any($event.target).value)"
                                />
                                <input
                                  class="mb-1 w-full rounded border border-gray-300 px-2 py-1"
                                  type="email"
                                  placeholder="Tu correo"
                                  [value]="form.email"
                                  (input)="patchRequest(line.id, 'email', $any($event.target).value)"
                                />
                                <input
                                  class="mb-1 w-full rounded border border-gray-300 px-2 py-1"
                                  type="tel"
                                  placeholder="Tu teléfono (opcional)"
                                  [value]="form.phone"
                                  (input)="patchRequest(line.id, 'phone', $any($event.target).value)"
                                />
                                @if (form.status === 'error') {
                                  <p class="mb-1 text-red-600">No se pudo enviar. Revisa tus datos.</p>
                                }
                                <button
                                  type="button"
                                  class="w-full rounded-full bg-[#25D366] px-3 py-1.5 font-semibold text-white disabled:opacity-60"
                                  [disabled]="form.status === 'sending' || !form.name.trim() || !form.email.includes('@')"
                                  (click)="submitRequest(line.id, card)"
                                >
                                  Enviar petición
                                </button>
                              }
                            }
                          }
                        }
                      </div>
                    }
                  </div>
                </div>
              }
              @if (sending()) {
                <div class="w-fit rounded-xl bg-white px-3 py-2 text-sm text-gray-500 shadow-sm">Vexi está escribiendo…</div>
              }
            </div>

            @if (errorState(); as err) {
              <div class="bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="vexi-public-error" [attr.data-state]="err">
                {{ errorText(err) }}
                @if (err === 'daily_cap' && plainWhatsappUrl()) {
                  <a class="ml-1 font-semibold underline" [href]="plainWhatsappUrl()" target="_blank" rel="noopener">Abrir WhatsApp</a>
                }
              </div>
            }

            <form class="flex items-center gap-2 border-t border-gray-200 bg-white p-2" (submit)="$event.preventDefault(); send()">
              <input
                class="flex-1 rounded-full border border-gray-300 px-3 py-2 text-sm focus:border-[#25D366] focus:outline-none"
                placeholder="Escribe un mensaje"
                maxlength="1000"
                aria-label="Mensaje para Vexi"
                [value]="draft()"
                [disabled]="blocked()"
                (input)="draft.set($any($event.target).value)"
              />
              <button
                type="submit"
                class="rounded-full bg-[#25D366] p-2 text-white disabled:opacity-50"
                aria-label="Enviar"
                [disabled]="sending() || blocked() || !draft().trim()"
              >
                <app-icon name="send" [size]="18" />
              </button>
            </form>
          }
        </section>
      }

      <button
        type="button"
        class="fixed bottom-5 right-5 z-[60] flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-[#1ebe5a]"
        data-testid="vexi-public-bubble"
        [attr.aria-label]="open() ? 'Cerrar chat' : 'Abrir chat con la tienda'"
        (click)="toggle()"
      >
        <app-icon [name]="open() ? 'x' : 'message-circle'" [size]="20" />
        @if (!open()) {
          <span>¿Dudas? Escríbenos</span>
        }
      </button>
    }
  `,
})
export class VexiPublicWidgetComponent {
  private readonly api = inject(VexiPublicApi);
  private readonly tenant = inject(TenantFacade);
  private readonly auth = inject(AuthFacade);
  private readonly router = inject(Router);
  private readonly cart = inject(CartService);
  private readonly checkout = inject(CheckoutService);
  private readonly storeUi = inject(StoreUiService);
  private readonly pqr = inject(PqrService);
  private readonly presence = inject(VexiPublicPresenceService);
  private readonly destroyRef = inject(DestroyRef);

  readonly config = signal<VexiPublicConfig | null>(null);
  readonly open = signal(false);
  readonly consented = signal(readStorage<boolean>(CONSENT_KEY) === true);
  readonly lines = signal<ChatLine[]>([]);
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly busy = signal(false);
  readonly errorState = signal<VexiPublicErrorState | null>(null);
  readonly avatarFailed = signal(false);
  private readonly requestForms = signal<Record<number, RequestFormState>>({});
  private nextId = 1;
  private lastHandoffOrderId: number | null = null;

  private readonly appType = computed(
    () => this.tenant.domainConfig()?.environment ?? null,
  );
  private readonly checkoutSettings = computed(
    () => this.tenant.domainConfig()?.customConfig?.ecommerce?.checkout ?? null,
  );
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  readonly eligible = computed(() => {
    const app = this.appType();
    return !!app && VEXI_PUBLIC_APPS.includes(app);
  });
  readonly visible = computed(
    () =>
      this.eligible() &&
      this.config()?.enabled === true &&
      !HIDDEN_ROUTES.some((re) => re.test(this.url() ?? '')),
  );
  /** The chat input is locked for states the visitor cannot fix by waiting a bit. */
  readonly blocked = computed(() => {
    const err = this.errorState();
    return err === 'daily_cap' || err === 'disabled' || err === 'unavailable';
  });
  readonly plainWhatsappUrl = computed(() => {
    const digits = this.config()?.whatsapp_number;
    return digits ? `https://wa.me/${digits}` : null;
  });

  constructor() {
    // Load the public config once the app is known to be a public store app.
    let requested = false;
    effect(() => {
      if (!this.eligible() || requested) return;
      requested = true;
      untracked(() =>
        this.api
          .getConfig()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (config) => this.config.set(config),
            error: () => this.config.set(null),
          }),
      );
    });

    // Vexi replaces the floating WhatsApp button where it is showing.
    effect(() => this.presence.setActive(this.visible()));
    this.destroyRef.onDestroy(() => this.presence.setActive(false));

    // Handoff (D5): an order placed after Vexi sent the visitor to checkout.
    effect(() => {
      const order = this.checkout.lastPlacedOrder();
      if (!order || order.order_id === this.lastHandoffOrderId) return;
      if (readStorage<boolean>(HANDOFF_KEY) !== true) return;
      untracked(() => this.handOff(order));
    });

    effect(() => {
      if (this.consented() && this.config()?.enabled && this.lines().length === 0)
        untracked(() => this.push('assistant', this.config()!.greeting));
    });
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  acceptConsent(): void {
    writeStorage(CONSENT_KEY, true);
    this.consented.set(true);
  }

  errorText(state: VexiPublicErrorState): string {
    return ERROR_TEXT[state];
  }

  openLogin(): void {
    this.storeUi.openLoginModal();
  }

  send(): void {
    const text = this.draft().trim();
    if (!text || this.sending() || this.blocked() || !this.consented()) return;
    this.draft.set('');
    this.push('user', text);
    this.sending.set(true);
    this.errorState.set(null);
    this.withSession((session) =>
      this.api.sendMessage(session, text, this.context()),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (reply) => {
        this.sending.set(false);
        this.push('assistant', reply.reply, { cards: reply.cards });
      },
      error: (error) => {
        this.sending.set(false);
        const state = vexiPublicErrorState(error) ?? 'unavailable';
        if (state === 'session_expired') writeStorage(SESSION_KEY, null);
        this.errorState.set(state);
      },
    });
  }

  goToCheckout(card: VexiPublicCard): void {
    if (card.kind !== 'order') return;
    if (this.checkoutSettings()?.require_registration === true && !this.auth.isAuthenticated()) {
      this.push(
        'assistant',
        'Esta tienda pide iniciar sesión para comprar. Inicia sesión y te espero aquí con tu pedido.',
        { action: 'login' },
      );
      return;
    }
    this.busy.set(true);
    const calls = card.items
      .map((item) =>
        this.cart.addToCart(item.product_id, item.quantity, {
          ...(item.variant_id ? { variantId: item.variant_id } : {}),
          variantInfo: {
            name: item.variant_name ? `${item.name} (${item.variant_name})` : item.name,
            sku: item.sku ?? '',
            price: item.unit_price,
          },
        }),
      )
      .filter((call): call is Observable<unknown> => isObservable(call));
    const proceed = () => {
      this.busy.set(false);
      writeStorage(HANDOFF_KEY, true);
      this.open.set(false);
      void this.router.navigate(['/checkout']);
    };
    if (!calls.length) {
      proceed();
      return;
    }
    concat(...calls)
      .pipe(toArray(), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: proceed,
        error: () => {
          this.busy.set(false);
          this.push('assistant', 'No pude agregar los productos al carrito. Intenta de nuevo en un momento.');
        },
      });
  }

  goToBooking(card: VexiPublicCard): void {
    if (card.kind !== 'booking') return;
    if (this.checkoutSettings()?.allow_guest_booking !== true && !this.auth.isAuthenticated()) {
      this.push(
        'assistant',
        'Para agendar en esta tienda debes iniciar sesión. Inicia sesión y te ayudo con tu cita.',
        { action: 'login' },
      );
      return;
    }
    this.open.set(false);
    if (this.appType() === AppType.STORE_PRODUCT_PAGE && card.slug)
      void this.router.navigate(['/products', card.slug]);
    else void this.router.navigate(['/book', card.product_id]);
  }

  requestForm(lineId: number): RequestFormState {
    return this.requestForms()[lineId] ?? { name: '', email: '', phone: '', status: 'idle' };
  }

  patchRequest(lineId: number, field: 'name' | 'email' | 'phone', value: string): void {
    this.requestForms.update((forms) => ({
      ...forms,
      [lineId]: { ...this.requestForm(lineId), [field]: value, status: 'idle' },
    }));
  }

  submitRequest(lineId: number, card: VexiPublicCard): void {
    if (card.kind !== 'request') return;
    const form = this.requestForm(lineId);
    this.setRequest(lineId, { ...form, status: 'sending' });
    this.pqr
      .createPublic({
        pqr_type: card.pqr_type,
        name: form.name.trim(),
        email: form.email.trim(),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        subject: card.subject,
        description: card.description,
        ...(this.tenant.domainConfig()?.store_id
          ? { store_id: this.tenant.domainConfig()!.store_id }
          : {}),
      } as Parameters<PqrService['createPublic']>[0])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const ticket = res?.data?.ticket_number ?? '';
          this.setRequest(lineId, { ...form, status: 'done', ticket });
          this.push(
            'assistant',
            `Listo, la tienda recibió tu petición. Tu número de radicado es ${ticket}. Guárdalo para hacerle seguimiento.`,
          );
        },
        error: () => this.setRequest(lineId, { ...form, status: 'error' }),
      });
  }

  private setRequest(lineId: number, state: RequestFormState): void {
    this.requestForms.update((forms) => ({ ...forms, [lineId]: state }));
  }

  private handOff(order: { order_id: number; order_number: string; public_order_token?: string | null }): void {
    this.lastHandoffOrderId = order.order_id;
    writeStorage(HANDOFF_KEY, null);
    const url = vexiOrderHandoffUrl(
      this.config()?.whatsapp_number,
      this.config()?.store_name || 'la tienda',
      order,
      window.location.origin,
    );
    this.push(
      'assistant',
      url
        ? `¡Listo! Tu pedido #${order.order_number} quedó registrado. Si quieres preguntar por él, te llevo al WhatsApp de la tienda.`
        : `¡Listo! Tu pedido #${order.order_number} quedó registrado.`,
      { handoffUrl: url },
    );
    this.open.set(true);
  }

  private push(role: ChatLine['role'], text: string, extra: Partial<ChatLine> = {}): void {
    this.lines.update((lines) => [...lines, { id: this.nextId++, role, text, ...extra }]);
  }

  /** Reuses the session of this tab, or opens one (consent already given). */
  private withSession<T>(work: (s: VexiPublicSession) => Observable<T>): Observable<T> {
    const stored = readStorage<VexiPublicSession>(SESSION_KEY);
    if (stored && new Date(stored.expires_at).getTime() > Date.now()) return work(stored);
    return this.api.createSession(this.appType() ?? '').pipe(
      tap((session) => writeStorage(SESSION_KEY, session)),
      switchMap((session) => work(session)),
    );
  }

  /** Where the visitor is: a hint the server re-verifies against its catalog. */
  private context(): VexiPublicContext {
    const items = (this.cart.cart()?.items ?? []).slice(0, 20);
    return {
      app_type: this.appType() ?? undefined,
      route: (this.url() ?? '').split('?')[0].slice(0, 200),
      ...(items.length
        ? {
            cart: items.map((i) => ({
              product_id: i.product_id,
              ...(i.product_variant_id ? { variant_id: i.product_variant_id } : {}),
              quantity: i.quantity,
            })),
          }
        : {}),
    };
  }
}
