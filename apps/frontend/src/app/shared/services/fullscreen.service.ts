import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, fromEvent, Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class FullscreenService implements OnDestroy {
  private isFullscreen$ = new BehaviorSubject<boolean>(false);
  private fullscreenElement: Element | null = null;
  private eventListeners: (() => void)[] = [];

  constructor(private ngZone: NgZone) {
    this.initializeFullscreenDetection();
  }

  /**
   * Obtiene el estado actual de fullscreen como Observable
   */
  get isFullscreen(): Observable<boolean> {
    return this.isFullscreen$.asObservable();
  }

  /**
   * Obtiene el estado actual de fullscreen como valor booleano
   */
  get isFullscreenActive(): boolean {
    return this.isFullscreen$.value;
  }

  /**
   * Activa el modo pantalla completa
   */
  async enterFullscreen(element?: Element): Promise<void> {
    try {
      const targetElement = element || document.documentElement;

      // Verificar si ya está en fullscreen
      if (this.isFullscreenActive) {
        return;
      }

      // Detectar el método correcto según el navegador
      const requestFullscreen = this.getRequestFullscreenMethod(targetElement);

      if (requestFullscreen) {
        await this.ngZone.runOutsideAngular(() => {
          return (requestFullscreen as any).call(targetElement);
        });

        this.fullscreenElement = targetElement;
        this.isFullscreen$.next(true);
      }
    } catch (error) {
      console.warn('Error entering fullscreen:', error);
      throw error;
    }
  }

  /**
   * Sale del modo pantalla completa
   */
  async exitFullscreen(): Promise<void> {
    try {
      if (!this.isFullscreenActive) {
        return;
      }

      const exitFullscreen = this.getExitFullscreenMethod();

      if (exitFullscreen) {
        await this.ngZone.runOutsideAngular(() => {
          return (exitFullscreen as any).call(document);
        });

        this.fullscreenElement = null;
        this.isFullscreen$.next(false);
      }
    } catch (error) {
      console.warn('Error exiting fullscreen:', error);
      throw error;
    }
  }

  /**
   * Alterna el modo pantalla completa
   */
  async toggleFullscreen(element?: Element): Promise<void> {
    if (this.isFullscreenActive) {
      await this.exitFullscreen();
    } else {
      await this.enterFullscreen(element);
    }
  }

  /**
   * Verifica si el navegador soporta fullscreen
   */
  isFullscreenSupported(): boolean {
    return !!(
      document.fullscreenEnabled ||
      (document as any).webkitFullscreenEnabled ||
      (document as any).mozFullScreenEnabled ||
      (document as any).msFullscreenEnabled
    );
  }

  /**
   * Obtiene el elemento actualmente en fullscreen
   */
  getFullscreenElement(): Element | null {
    return (
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement ||
      null
    );
  }

  /**
   * Inicializa la detección de cambios de fullscreen
   */
  private initializeFullscreenDetection(): void {
    // Detectar estado inicial
    this.updateFullscreenState();

    // Configurar event listeners para diferentes navegadores
    const events = [
      'fullscreenchange',
      'webkitfullscreenchange',
      'mozfullscreenchange',
      'MSFullscreenChange',
    ];

    events.forEach((eventName) => {
      const cleanup = this.ngZone.runOutsideAngular(() => {
        return fromEvent(document, eventName).subscribe(() => {
          this.ngZone.run(() => {
            this.updateFullscreenState();
          });
        });
      });

      this.eventListeners.push(() => cleanup.unsubscribe());
    });

    // Detectar cambios con Visibility API para mayor robustez
    const visibilityCleanup = this.ngZone.runOutsideAngular(() => {
      return fromEvent(document, 'visibilitychange').subscribe(() => {
        this.ngZone.run(() => {
          if (document.visibilityState === 'visible') {
            this.updateFullscreenState();
          }
        });
      });
    });

    this.eventListeners.push(() => visibilityCleanup.unsubscribe());
  }

  /**
   * Actualiza el estado de fullscreen basado en el DOM
   */
  private updateFullscreenState(): void {
    const isCurrentlyFullscreen = !!this.getFullscreenElement();
    if (isCurrentlyFullscreen !== this.isFullscreen$.value) {
      this.isFullscreen$.next(isCurrentlyFullscreen);
    }
  }

  /**
   * Obtiene el método correcto para requestFullscreen según el navegador
   */
  private getRequestFullscreenMethod(
    element: Element,
  ): ((element: Element) => Promise<void>) | null {
    return (
      (element as any).requestFullscreen ||
      (element as any).webkitRequestFullscreen ||
      (element as any).webkitRequestFullScreen ||
      (element as any).mozRequestFullScreen ||
      (element as any).msRequestFullscreen ||
      null
    );
  }

  /**
   * Obtiene el método correcto para exitFullscreen según el navegador
   */
  private getExitFullscreenMethod(): (() => Promise<void>) | null {
    return (
      (document as any).exitFullscreen ||
      (document as any).webkitExitFullscreen ||
      (document as any).webkitCancelFullScreen ||
      (document as any).mozCancelFullScreen ||
      (document as any).msExitFullscreen ||
      null
    );
  }

  /**
   * Limpia los event listeners al destruir el servicio
   */
  ngOnDestroy(): void {
    this.eventListeners.forEach((cleanup) => cleanup());
    this.eventListeners = [];
  }
}
