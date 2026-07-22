import {
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { ModalComponent } from '../modal/modal.component';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';

/**
 * RateLimitLockModalComponent
 *
 * Shared modal shown when a login attempt is rejected by the server rate limit
 * (HTTP 429). Renders a real countdown until the account/IP is unlocked plus a
 * "Contactar a soporte" mailto action.
 *
 * Zoneless-safe: countdown lives in a signal updated from a `setInterval`; each
 * `signal.set/update` triggers change detection without NgZone. The interval is
 * cleaned up via the effect `onCleanup` and backed by `DestroyRef`.
 *
 * Consumed (by direct path import) from the admin panel login and the ecommerce
 * auth modal.
 */
@Component({
  selector: 'app-rate-limit-lock-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  templateUrl: './rate-limit-lock-modal.component.html',
  styleUrl: './rate-limit-lock-modal.component.scss',
})
export class RateLimitLockModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Model-based visibility, bindable with `[(isOpen)]`. */
  readonly isOpen = model<boolean>(false);

  /** Seconds until unlock (from the 429 `retryAfter`). */
  readonly retrySeconds = input<number>(0);

  /** Email the user attempted to sign in with (prefills the mailto body). */
  readonly attemptedEmail = input<string | null>(null);

  /** Consumer surface — only nuances the copy. */
  readonly context = input<'admin' | 'ecommerce'>('admin');

  /** Emitted whenever the modal is dismissed (button, backdrop, escape, X). */
  readonly closed = output<void>();

  /** Live countdown, driven by the effect below. */
  readonly secondsLeft = signal<number>(0);

  private intervalId?: ReturnType<typeof setInterval>;

  constructor() {
    // Re-runs when the modal opens/closes or the retry window changes. Reads
    // isOpen()/retrySeconds() only (never secondsLeft) so there is no cycle.
    effect((onCleanup) => {
      const open = this.isOpen();
      const total = Math.max(0, Math.floor(this.retrySeconds()));

      this.clearTimer();

      if (!open) {
        this.secondsLeft.set(0);
        return;
      }

      this.secondsLeft.set(total);

      if (total > 0 && this.isBrowser) {
        this.intervalId = setInterval(() => {
          this.secondsLeft.update((s) => {
            if (s <= 1) {
              this.clearTimer();
              return 0;
            }
            return s - 1;
          });
        }, 1000);
      }

      onCleanup(() => this.clearTimer());
    });

    // Safety net: guarantee the timer is stopped on teardown.
    this.destroyRef.onDestroy(() => this.clearTimer());
  }

  /** `mm:ss` representation of the remaining time, zero-padded. */
  readonly formatted = computed(() => {
    const total = this.secondsLeft();
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  });

  /** True once the countdown reaches zero. */
  readonly canRetry = computed(() => this.secondsLeft() === 0);

  /** Body copy, slightly adapted per consumer surface. */
  readonly bodyMessage = computed(() =>
    this.context() === 'ecommerce'
      ? 'Por seguridad bloqueamos temporalmente el acceso a tu cuenta tras varios intentos fallidos de inicio de sesión.'
      : 'Por seguridad bloqueamos temporalmente el acceso al panel tras varios intentos fallidos de inicio de sesión.',
  );

  /** Prebuilt `mailto:` link for the support action. */
  readonly mailtoHref = computed(() => {
    const email = this.attemptedEmail()?.trim();
    const remaining = this.secondsLeft();
    const minutes = Math.ceil(remaining / 60);

    const subject = 'Cuenta bloqueada por intentos de inicio de sesión';
    const bodyLines = [
      'Hola equipo de soporte,',
      '',
      'No puedo iniciar sesión porque mi cuenta/IP fue bloqueada temporalmente por exceso de intentos de inicio de sesión.',
      email
        ? `Correo con el que intenté ingresar: ${email}`
        : 'No recuerdo con exactitud el correo con el que intenté ingresar.',
      remaining > 0
        ? `Tiempo aproximado restante de bloqueo: ${minutes} minuto(s).`
        : 'El bloqueo ya debería haber expirado, pero sigo con problemas para ingresar.',
      '',
      'Agradezco su ayuda para restablecer el acceso.',
    ];
    const body = bodyLines.join('\n');

    return `mailto:soporte@vendix.online?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
  });

  /** Closes the modal and notifies consumers. */
  onClose(): void {
    this.isOpen.set(false);
    this.closed.emit();
  }

  private clearTimer(): void {
    if (this.intervalId != null) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
}
