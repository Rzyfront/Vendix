import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { IconName } from '../../../../../shared/components/icon/icons.registry';
import {
  PosFiscalService,
  PosFiscalState,
  PosFiscalStatus,
} from '../services/pos-fiscal.service';

/**
 * Indicador fiscal del POS. **No es un modal y nunca lo será.**
 *
 * La venta ya está cobrada cuando este componente aparece. Todo lo que puede
 * pasar aquí —que la DIAN acepte, que la cola reintente, que el documento salga
 * bajo contingencia, o que le falte un dato— ocurre DESPUÉS del cobro, así que
 * ninguno de esos desenlaces tiene derecho a tapar la pantalla del cajero ni a
 * pedirle una confirmación. Informa; no interrumpe.
 *
 * Se pinta solo. El backend ya disparó la emisión al cerrar la venta
 * (`pos.sale.completed`), así que este componente sólo consulta el estado y
 * repregunta mientras siga en camino. El botón de emitir/reintentar existe para
 * los casos en que la tienda tiene la emisión automática apagada o el documento
 * quedó fallido y alguien corrigió el dato que faltaba.
 */
@Component({
  selector: 'app-pos-fiscal-status',
  standalone: true,
  imports: [IconComponent, DatePipe],
  template: `
    @if (visible()) {
      <div
        class="rounded-xl border px-3 py-2.5 transition-colors"
        [class]="containerClass()"
        role="status"
        aria-live="polite"
      >
        <div class="flex items-start gap-2.5">
          <span class="flex-shrink-0 mt-0.5" [class]="iconClass()">
            <app-icon
              [name]="iconName()"
              [size]="18"
              [spin]="spinning()"
            ></app-icon>
          </span>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-sm" [class]="titleClass()">{{
                title()
              }}</span>

              @if (invoiceNumber()) {
                <span
                  class="text-xs font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10"
                  >{{ invoiceNumber() }}</span
                >
              }
            </div>

            <p class="text-xs mt-0.5 leading-snug" [class]="messageClass()">
              {{ message() }}
            </p>

            @if (state() === 'contingency' && deadline()) {
              <p class="text-xs mt-1 leading-snug" [class]="messageClass()">
                Transmitir antes de {{ deadline() | date: 'short' }}.
              </p>
            }

            @if (cufeShort()) {
              <p class="text-[11px] mt-1 font-mono opacity-70 break-all">
                CUFE {{ cufeShort() }}
              </p>
            }

            <!-- Lo que le falta al documento, con dónde se corrige. Inline: el
                 cajero lo lee o lo ignora, pero no tiene que cerrar nada. -->
            @if (blockers().length > 0) {
              <ul class="mt-2 space-y-1.5">
                @for (blocker of blockers(); track $index) {
                  <li class="text-xs leading-snug">
                    <span class="font-medium">{{ blocker.problem }}</span>
                    @if (blocker.fix) {
                      <span class="block opacity-80">{{ blocker.fix }}</span>
                    }
                  </li>
                }
              </ul>
            }
          </div>

          @if (showAction()) {
            <button
              type="button"
              (click)="emitNow()"
              [disabled]="working()"
              class="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              [class]="actionClass()"
              [attr.aria-label]="actionLabel()"
            >
              <app-icon
                name="refresh-cw"
                [size]="14"
                [spin]="working()"
              ></app-icon>
              <span class="hidden sm:inline">{{ actionLabel() }}</span>
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class PosFiscalStatusComponent {
  private readonly fiscal = inject(PosFiscalService);
  private readonly destroyRef = inject(DestroyRef);

  /** Venta ya cobrada cuyo estado fiscal se muestra. */
  readonly orderId = input<number | null>(null);

  /** Consultar el estado apenas llega el pedido. Apagarlo deja el indicador
   *  mudo hasta que alguien pulse el botón. */
  readonly autoLoad = input<boolean>(true);

  /** Cada lectura del estado, para que el ticket pueda pintar el CUFE. */
  readonly statusChanged = output<PosFiscalStatus>();

  readonly status = signal<PosFiscalStatus | null>(null);
  readonly working = signal(false);

  /**
   * Reconsulta acotada mientras el documento sigue en camino.
   *
   * 12 intentos cada 5 s ≈ 1 min. No es un temporizador de la transmisión: la
   * cola de reintentos del backend trabaja cada 2 min durante 48 h y no
   * necesita que nadie la mire. Es sólo el tiempo que tiene sentido que el
   * cajero se quede esperando frente a la pantalla de venta cerrada; pasado
   * eso, el estado queda como «en cola» con su botón de reconsultar y el cajero
   * sigue vendiendo.
   */
  private static readonly MAX_POLLS = 12;
  private static readonly POLL_MS = 5000;

  private poll_timer: ReturnType<typeof setTimeout> | null = null;
  private poll_attempts = 0;

  constructor() {
    effect(() => {
      const order_id = this.orderId();
      untracked(() => {
        this.stopPolling();
        this.poll_attempts = 0;
        this.status.set(null);
        if (order_id && this.autoLoad()) {
          this.load(order_id, false);
        }
      });
    });

    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  // ── Estado derivado ───────────────────────────────────────

  readonly state = computed<PosFiscalState | null>(
    () => this.status()?.state ?? null,
  );

  /**
   * `not_applicable` NO se pinta. Una tienda que no factura electrónicamente no
   * tiene por qué ver un cartel gris en cada venta explicándole algo que no le
   * incumbe; el indicador simplemente no existe para ella.
   */
  readonly visible = computed(() => {
    const state = this.state();
    return state !== null && state !== 'not_applicable';
  });

  readonly message = computed(() => this.status()?.message ?? '');
  readonly invoiceNumber = computed(() => this.status()?.invoice_number ?? '');
  readonly deadline = computed(() => this.status()?.contingency_deadline ?? null);
  readonly blockers = computed(() => this.status()?.blockers ?? []);

  readonly cufeShort = computed(() => {
    const cufe = this.status()?.cufe;
    if (!cufe) return '';
    return cufe.length > 24 ? cufe.slice(0, 12) + '…' + cufe.slice(-8) : cufe;
  });

  readonly spinning = computed(
    () => this.working() || this.state() === 'pending',
  );

  readonly title = computed(() => {
    switch (this.state()) {
      case 'issued':
        return 'Factura electrónica emitida';
      case 'pending':
        return 'Enviando a la DIAN';
      case 'contingency':
        return 'Emitida en contingencia';
      case 'failed':
        return 'Documento no emitido';
      default:
        return '';
    }
  });

  readonly iconName = computed<IconName>(() => {
    switch (this.state()) {
      case 'issued':
        return 'check-circle';
      case 'pending':
        return 'loader-2';
      case 'contingency':
        return 'clock';
      case 'failed':
        return 'alert-triangle';
      default:
        return 'file-text';
    }
  });

  /**
   * Emitir cuando todavía no hay documento; reintentar cuando falló o quedó en
   * cola. Nunca sobre uno aceptado: retransmitir una factura ya aceptada por la
   * DIAN no es un reintento, es un documento distinto.
   */
  readonly showAction = computed(() => {
    const state = this.state();
    return state === 'failed' || state === 'pending';
  });

  readonly actionLabel = computed(() =>
    this.state() === 'failed' ? 'Reintentar' : 'Consultar',
  );

  // ── Clases por estado ─────────────────────────────────────

  readonly containerClass = computed(() => {
    switch (this.state()) {
      case 'issued':
        return 'bg-green-50 border-green-200 dark:bg-green-500/10 dark:border-green-500/30';
      case 'pending':
        return 'bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30';
      case 'contingency':
        return 'bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/30';
      case 'failed':
        return 'bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/30';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  });

  readonly iconClass = computed(() => {
    switch (this.state()) {
      case 'issued':
        return 'text-green-600 dark:text-green-400';
      case 'pending':
        return 'text-amber-600 dark:text-amber-400';
      case 'contingency':
        return 'text-blue-600 dark:text-blue-400';
      case 'failed':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-500';
    }
  });

  readonly titleClass = computed(() => this.iconClass());

  readonly messageClass = computed(() => {
    switch (this.state()) {
      case 'issued':
        return 'text-green-700/90 dark:text-green-300/90';
      case 'pending':
        return 'text-amber-700/90 dark:text-amber-300/90';
      case 'contingency':
        return 'text-blue-700/90 dark:text-blue-300/90';
      case 'failed':
        return 'text-red-700/90 dark:text-red-300/90';
      default:
        return 'text-gray-600';
    }
  });

  readonly actionClass = computed(() => {
    switch (this.state()) {
      case 'failed':
        return 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-300';
      default:
        return 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-300';
    }
  });

  // ── Acciones ──────────────────────────────────────────────

  /**
   * Pide la emisión (o el reintento) sin bloquear nada. El backend responde 200
   * con el estado incluso cuando la DIAN falla, así que aquí no hay rama de
   * error que atender: lo que vuelve siempre es el estado real del documento.
   */
  emitNow(): void {
    const order_id = this.orderId();
    if (!order_id || this.working()) return;
    this.stopPolling();
    this.poll_attempts = 0;
    this.load(order_id, true);
  }

  /** Reconsulta el estado sin emitir. */
  refresh(): void {
    const order_id = this.orderId();
    if (!order_id || this.working()) return;
    this.stopPolling();
    this.load(order_id, false);
  }

  private load(order_id: number, emit: boolean): void {
    this.working.set(true);
    const request = emit
      ? this.fiscal.emit(order_id)
      : this.fiscal.getFiscalStatus(order_id);

    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => {
      this.working.set(false);
      this.status.set(status);
      this.statusChanged.emit(status);
      this.schedulePoll(order_id, status);
    });
  }

  private schedulePoll(order_id: number, status: PosFiscalStatus): void {
    if (status.state !== 'pending') return;
    if (this.poll_attempts >= PosFiscalStatusComponent.MAX_POLLS) return;
    this.poll_attempts += 1;
    this.poll_timer = setTimeout(() => {
      this.poll_timer = null;
      // Reconsulta, nunca reemite: un segundo POST podría transmitir dos veces.
      this.load(order_id, false);
    }, PosFiscalStatusComponent.POLL_MS);
  }

  private stopPolling(): void {
    if (this.poll_timer !== null) {
      clearTimeout(this.poll_timer);
      this.poll_timer = null;
    }
  }
}
