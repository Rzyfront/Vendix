import { Injectable, computed, signal } from '@angular/core';
import { KDS_COLUMNS, KdsColumn } from '../interfaces';

/** Tamaño del contenido de los tickets en el tablero. */
export type KdsTicketSize = 'normal' | 'grande' | 'muy-grande';

export const KDS_TICKET_SIZES: ReadonlyArray<{
  id: KdsTicketSize;
  label: string;
  zoom: number;
}> = [
  { id: 'normal', label: 'Normal', zoom: 1 },
  { id: 'grande', label: 'Grande', zoom: 1.15 },
  { id: 'muy-grande', label: 'Muy grande', zoom: 1.3 },
];

/**
 * Preferencias de VISTA del tablero KDS (qué columnas se ven y a qué tamaño
 * los tickets). Es display por dispositivo —la pantalla colgada en cocina—,
 * no configuración de negocio: vive en `localStorage` y se aplica al
 * instante vía signals, sin backend ni migraciones.
 *
 * Si a futuro debe sincronizarse entre dispositivos, mover estas dos
 * preferencias a `store_settings.restaurant.kds` (ver `vendix-settings-system`
 * y `vendix-store-settings`) y mantener esta misma API de signals.
 */
@Injectable({ providedIn: 'root' })
export class KdsDisplayService {
  private static readonly STORAGE_KEY = 'vendix:kds-display/v1';

  /** Columnas ocultas. Por defecto se ven las 5. */
  private readonly hidden = signal<Set<KdsColumn>>(new Set());
  readonly ticketSize = signal<KdsTicketSize>('normal');

  /** Zoom CSS aplicado al cuerpo de las columnas según el tamaño elegido. */
  readonly ticketZoom = computed(() => {
    const found = KDS_TICKET_SIZES.find((s) => s.id === this.ticketSize());
    return found?.zoom ?? 1;
  });

  constructor() {
    this.restore();
  }

  /** Columnas visibles en el orden canónico de `KDS_COLUMNS`. */
  visibleColumns(): KdsColumn[] {
    const hidden = this.hidden();
    return KDS_COLUMNS.filter((c) => !hidden.has(c));
  }

  isColumnVisible(column: KdsColumn): boolean {
    return !this.hidden().has(column);
  }

  /**
   * Muestra u oculta una columna. Devuelve `false` (sin cambiar nada) cuando
   * se intenta ocultar la ÚLTIMA visible: un tablero sin columnas no sirve.
   */
  toggleColumn(column: KdsColumn): boolean {
    const next = new Set(this.hidden());
    if (next.has(column)) {
      next.delete(column);
    } else {
      if (KDS_COLUMNS.length - next.size <= 1) return false;
      next.add(column);
    }
    this.hidden.set(next);
    this.persist();
    return true;
  }

  setTicketSize(size: KdsTicketSize): void {
    if (this.ticketSize() === size) return;
    this.ticketSize.set(size);
    this.persist();
  }

  private restore(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(KdsDisplayService.STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        hidden?: unknown;
        ticketSize?: unknown;
      };
      if (Array.isArray(parsed.hidden)) {
        const valid = parsed.hidden.filter((c): c is KdsColumn =>
          (KDS_COLUMNS as readonly string[]).includes(c as string),
        );
        // Nunca restaurar un estado sin columnas visibles.
        if (valid.length < KDS_COLUMNS.length) this.hidden.set(new Set(valid));
      }
      if (
        typeof parsed.ticketSize === 'string' &&
        KDS_TICKET_SIZES.some((s) => s.id === parsed.ticketSize)
      ) {
        this.ticketSize.set(parsed.ticketSize as KdsTicketSize);
      }
    } catch {
      // Preferencias corruptas o storage bloqueado: se queda el default.
    }
  }

  private persist(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(
        KdsDisplayService.STORAGE_KEY,
        JSON.stringify({
          hidden: [...this.hidden()],
          ticketSize: this.ticketSize(),
        }),
      );
    } catch {
      // Storage lleno o bloqueado: la vista sigue funcionando en memoria.
    }
  }
}
