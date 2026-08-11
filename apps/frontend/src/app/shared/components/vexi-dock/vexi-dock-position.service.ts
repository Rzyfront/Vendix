import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface DockPosition {
  /** Distance from the viewport left edge, in CSS pixels. */
  x: number;
  /** Distance from the viewport top edge, in CSS pixels. */
  y: number;
}

const STORAGE_KEY = 'vendix_vexi_dock_position';

/**
 * Dock diameter on desktop. Every reduced variant derives from this number, and
 * the painted size derives from `size()` — the styles carry no media query of
 * their own, they read the `--vexi-dock-size` custom property the dock
 * publishes from this service.
 *
 * That indirection is the point: this value is also the geometry that clamps
 * and snaps the position. A CSS-only shrink would leave `snapToEdge()` reserving
 * 94px for a 56px dock, parking it ~38px short of the edge it was flung at.
 * The `94px` fallback in the styles only covers the pre-hydration frame, before
 * `restore()` has measured the viewport.
 */
export const DOCK_SIZE_DESKTOP = 94;

/**
 * How much the dock gives back on smaller screens. The cuts are Tailwind's
 * `md` (768) and `lg` (1024) so the dock changes size on the same boundaries as
 * the layout around it. 94px is a comfortable target on a desktop and a
 * genuine obstruction on a phone, where it covers real content and eats a
 * visible slice of a short viewport.
 */
const MOBILE_MAX_WIDTH = 767;
const TABLET_MAX_WIDTH = 1023;
const MOBILE_SCALE = 0.6;
const TABLET_SCALE = 0.8;

/** Dock diameter for a viewport width, in CSS pixels. */
export function dockSizeFor(viewportWidth: number): number {
  if (viewportWidth <= MOBILE_MAX_WIDTH) {
    return Math.round(DOCK_SIZE_DESKTOP * MOBILE_SCALE);
  }
  if (viewportWidth <= TABLET_MAX_WIDTH) {
    return Math.round(DOCK_SIZE_DESKTOP * TABLET_SCALE);
  }
  return DOCK_SIZE_DESKTOP;
}

/** Keeps the dock clear of the viewport edges and of iOS home indicators. */
const EDGE_MARGIN = 12;

@Injectable({ providedIn: 'root' })
export class VexiDockPositionService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly position = signal<DockPosition>({ x: 0, y: 0 });

  /**
   * Current dock diameter. Desktop until the viewport is measured, which cannot
   * happen before the browser has laid out — same constraint as `position`.
   */
  readonly size = signal(DOCK_SIZE_DESKTOP);

  /**
   * Restores the stored position, or drops the dock at the bottom-right
   * default. Always clamped: a window that shrank since the last visit (phone
   * rotated, browser resized) would otherwise restore the dock off-screen
   * where it can never be dragged back.
   */
  restore(): void {
    if (!this.isBrowser) return;

    // Before the clamp, never after: every bound below is computed from the
    // diameter, so a stale size would clamp against the previous dock's box.
    this.syncSize();

    const stored = this.read();
    this.position.set(this.clamp(stored ?? this.defaultPosition()));
  }

  moveTo(x: number, y: number): void {
    this.position.set(this.clamp({ x, y }));
  }

  /**
   * Snaps to the nearest horizontal edge after a drag. Vertical placement is
   * whatever the user chose — only the horizontal axis snaps, so the dock
   * always parks against a side instead of floating over page content.
   */
  snapToEdge(): void {
    if (!this.isBrowser) return;

    const { x, y } = this.position();
    const size = this.size();
    const centerX = x + size / 2;
    const snappedX =
      centerX < window.innerWidth / 2
        ? EDGE_MARGIN
        : window.innerWidth - size - EDGE_MARGIN;

    const next = this.clamp({ x: snappedX, y });
    this.position.set(next);
    this.persist(next);
  }

  /**
   * Re-clamps after a viewport change without touching stored preference. Also
   * where the dock crosses a breakpoint: a rotation or a window resize is the
   * only way the diameter changes after the first paint, and the new bounds
   * have to be applied in the same pass that publishes the new size.
   */
  reclamp(): void {
    if (!this.isBrowser) return;

    const previous = this.size();
    this.syncSize();
    const next = this.size();

    // Cruzar un breakpoint no es solo recortar: el dock parquea a ras del borde,
    // y una x calculada con el diámetro anterior deja el hueco de la diferencia
    // —hasta 38px— con el dock flotando sobre el contenido. Solo cuando el
    // diámetro cambió, porque re-imantar en cada resize movería un dock que el
    // usuario dejó donde quería. El clamp cubre el caso contrario (la ventana se
    // encoge) empujándolo contra el borde por sí solo.
    if (next !== previous) {
      const { x, y } = this.position();
      const onLeft = x + previous / 2 < window.innerWidth / 2;
      const realignedX = onLeft ? EDGE_MARGIN : window.innerWidth - next - EDGE_MARGIN;
      this.position.set(this.clamp({ x: realignedX, y }));
      return;
    }

    this.position.set(this.clamp(this.position()));
  }

  // ------------------------------------------------------------------

  private syncSize(): void {
    this.size.set(dockSizeFor(window.innerWidth));
  }

  private defaultPosition(): DockPosition {
    const size = this.size();
    return {
      x: window.innerWidth - size - 20,
      y: window.innerHeight - size - 90,
    };
  }

  private clamp({ x, y }: DockPosition): DockPosition {
    const size = this.size();
    const maxX = Math.max(EDGE_MARGIN, window.innerWidth - size - EDGE_MARGIN);
    const maxY = Math.max(EDGE_MARGIN, window.innerHeight - size - EDGE_MARGIN);
    return {
      x: Math.min(Math.max(x, EDGE_MARGIN), maxX),
      y: Math.min(Math.max(y, EDGE_MARGIN), maxY),
    };
  }

  private read(): DockPosition | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<DockPosition>;
      if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number') {
        return null;
      }
      return { x: parsed.x, y: parsed.y };
    } catch {
      return null;
    }
  }

  private persist(pos: DockPosition): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch {
      // Private browsing / quota exceeded — position just won't survive a reload.
    }
  }
}
