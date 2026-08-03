import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface DockPosition {
  /** Distance from the viewport left edge, in CSS pixels. */
  x: number;
  /** Distance from the viewport top edge, in CSS pixels. */
  y: number;
}

const STORAGE_KEY = 'vendix_vexi_dock_position';

/** Dock diameter; mirrors `--vexi-dock-size` in the component styles. */
export const DOCK_SIZE = 78;

/** Keeps the dock clear of the viewport edges and of iOS home indicators. */
const EDGE_MARGIN = 12;

@Injectable({ providedIn: 'root' })
export class VexiDockPositionService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly position = signal<DockPosition>({ x: 0, y: 0 });

  /**
   * Restores the stored position, or drops the dock at the bottom-right
   * default. Always clamped: a window that shrank since the last visit (phone
   * rotated, browser resized) would otherwise restore the dock off-screen
   * where it can never be dragged back.
   */
  restore(): void {
    if (!this.isBrowser) return;

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
    const centerX = x + DOCK_SIZE / 2;
    const snappedX =
      centerX < window.innerWidth / 2
        ? EDGE_MARGIN
        : window.innerWidth - DOCK_SIZE - EDGE_MARGIN;

    const next = this.clamp({ x: snappedX, y });
    this.position.set(next);
    this.persist(next);
  }

  /** Re-clamps after a viewport change without touching stored preference. */
  reclamp(): void {
    if (!this.isBrowser) return;
    this.position.set(this.clamp(this.position()));
  }

  // ------------------------------------------------------------------

  private defaultPosition(): DockPosition {
    return {
      x: window.innerWidth - DOCK_SIZE - 20,
      y: window.innerHeight - DOCK_SIZE - 90,
    };
  }

  private clamp({ x, y }: DockPosition): DockPosition {
    const maxX = Math.max(EDGE_MARGIN, window.innerWidth - DOCK_SIZE - EDGE_MARGIN);
    const maxY = Math.max(EDGE_MARGIN, window.innerHeight - DOCK_SIZE - EDGE_MARGIN);
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
