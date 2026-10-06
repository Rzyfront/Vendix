import {
  Directive,
  ElementRef,
  OnDestroy,
  OnInit,
  inject,
  input,
  output,
} from '@angular/core';

/**
 * Pull-to-refresh táctil dentro de la app.
 *
 * El shell admin usa un scroller interno (`main` con `overflow-y-auto`, body
 * bloqueado), así que el gesto nativo del navegador no siempre se dispara
 * (y nunca en emulación DevTools con mouse). Esta directiva lo implementa a
 * mano sobre el host: sólo intercepta el gesto cuando el host está en
 * `scrollTop <= 0` y el dedo baja; cualquier otro scroll queda intacto.
 *
 * No toca signals por movimiento (manipulación DOM directa): apto para
 * zoneless sin costo de change detection.
 *
 * @example
 * <main appPullToRefresh (pullRefresh)="reloadPage()">…</main>
 * <main appPullToRefresh [ptrDisabled]="isPosRoute()" (pullRefresh)="reloadPage()">…</main>
 */
@Directive({
  selector: '[appPullToRefresh]',
  standalone: true,
})
export class PullToRefreshDirective implements OnInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLElement>);

  /** Distancia (px, post-resistencia) para disparar el refresh. */
  readonly threshold = input(70);
  /** Apaga el gesto (ej. ruta POS con contenedor bloqueado). */
  readonly ptrDisabled = input(false);
  /** Se emite al soltar pasando el umbral. */
  readonly pullRefresh = output<void>();

  private startY = 0;
  private tracking = false;
  private pull = 0;
  private refreshing = false;
  private badge: HTMLElement | null = null;
  private arrow: HTMLElement | null = null;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onStart = (e: TouchEvent): void => {
    if (this.refreshing || this.ptrDisabled() || e.touches.length !== 1) return;
    if (this.el.nativeElement.scrollTop > 0) return;
    this.tracking = true;
    this.startY = e.touches[0].clientY;
    this.pull = 0;
  };

  private readonly onMove = (e: TouchEvent): void => {
    if (!this.tracking || this.refreshing || this.ptrDisabled()) return;
    const host = this.el.nativeElement;
    const dy = e.touches[0].clientY - this.startY;
    if (host.scrollTop > 0 || dy <= 0) {
      this.tracking = false;
      this.setPull(0);
      return;
    }
    // Estamos arriba del todo y el dedo baja: reclamar el gesto.
    e.preventDefault();
    this.setPull(Math.min(dy * 0.5, 110));
  };

  private readonly onEnd = (): void => {
    if (!this.tracking) return;
    this.tracking = false;
    if (this.pull >= this.threshold() && !this.refreshing) {
      this.refreshing = true;
      this.setPull(this.threshold());
      this.pullRefresh.emit();
      // Seguridad: si el consumidor no recarga, liberar el gesto.
      this.resetTimer = setTimeout(() => this.reset(), 4000);
    } else {
      this.setPull(0);
    }
  };

  ngOnInit(): void {
    if (typeof window === 'undefined') return;
    const host = this.el.nativeElement;
    if (getComputedStyle(host).position === 'static') {
      host.style.position = 'relative';
    }
    host.addEventListener('touchstart', this.onStart, { passive: true });
    host.addEventListener('touchmove', this.onMove, { passive: false });
    host.addEventListener('touchend', this.onEnd, { passive: true });
    host.addEventListener('touchcancel', this.onEnd, { passive: true });
  }

  ngOnDestroy(): void {
    const host = this.el.nativeElement;
    host.removeEventListener('touchstart', this.onStart);
    host.removeEventListener('touchmove', this.onMove);
    host.removeEventListener('touchend', this.onEnd);
    host.removeEventListener('touchcancel', this.onEnd);
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.badge?.remove();
    this.badge = null;
  }

  /** Libera el estado de refresco (si el consumidor no recargó la página). */
  reset(): void {
    this.refreshing = false;
    this.tracking = false;
    this.setPull(0);
  }

  private ensureBadge(): void {
    if (this.badge) return;
    const host = this.el.nativeElement;
    const badge = document.createElement('div');
    badge.setAttribute('aria-hidden', 'true');
    badge.style.cssText =
      'position:absolute;top:10px;left:50%;z-index:60;width:38px;height:38px;' +
      'border-radius:9999px;background:var(--color-surface,#fff);' +
      'box-shadow:0 4px 14px rgba(0,0,0,.18);display:flex;align-items:center;' +
      'justify-content:center;opacity:0;pointer-events:none;';
    const arrow = document.createElement('span');
    arrow.textContent = '↓';
    arrow.style.cssText =
      'font-size:20px;line-height:1;color:var(--color-primary,#2f6f4e);display:block;';
    badge.appendChild(arrow);
    host.appendChild(badge);
    this.badge = badge;
    this.arrow = arrow;
  }

  private setPull(px: number): void {
    this.pull = px;
    if (px <= 0) {
      if (this.badge) {
        this.badge.style.opacity = '0';
        this.badge.style.transform = 'translate(-50%,-8px)';
      }
      return;
    }
    this.ensureBadge();
    if (!this.badge || !this.arrow) return;
    this.badge.style.opacity = String(Math.min(1, px / 35));
    this.badge.style.transform = `translate(-50%,${Math.min(px, 90)}px)`;
    this.arrow.style.transform = `rotate(${Math.min(px * 2.2, 180)}deg)`;
  }
}
