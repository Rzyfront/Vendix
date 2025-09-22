import { OverlayRef } from '@angular/cdk/overlay';
import { Subject } from 'rxjs';

export class DialogRef<T = unknown, R = unknown> {
  private readonly closed$ = new Subject<R | undefined>();
  readonly afterClosed$ = this.closed$.asObservable();

  constructor(private overlayRef: OverlayRef, public data?: T) {}

  close(result?: R) {
    if ((this.closed$ as any).isStopped) {
      this.overlayRef.dispose();
      return;
    }
    this.closed$.next(result);
    this.closed$.complete();

    // Add 'closing' class to enable CSS exit animations before dispose
  const backdrop = (this.overlayRef as any)._backdropElement as HTMLElement | undefined;
  const panel = this.overlayRef.hostElement as HTMLElement;
    backdrop?.classList.add('closing');
  panel.classList.add('closing');

    // Dispose after animation durations (~150-180ms)
    setTimeout(() => this.overlayRef.dispose(), 200);
  }
}
