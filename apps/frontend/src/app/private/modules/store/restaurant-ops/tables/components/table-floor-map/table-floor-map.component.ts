import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { Table, TableStatus } from '../../interfaces';
import { TablesService } from '../../services/tables.service';

interface TableCell {
  table: Table;
  displayStatus: TableStatus;
  statusLabel: string;
  statusColor: string;
  isOccupied: boolean;
  guestCount: number | null;
  /** Posición absoluta resuelta (px) usada por el lienzo. */
  x: number;
  y: number;
}

export interface TableMovedEvent {
  id: number;
  pos_x: number;
  pos_y: number;
}

/** Estado interno del puntero activo durante un gesto. */
interface ActivePointer {
  id: number;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
}

/**
 * Geometría base de cada mesa en coordenadas del lienzo (px). El
 * auto-layout y el clamp de drag usan estos valores.
 */
const TABLE_W = 150;
const TABLE_H = 116;
const GRID_GAP = 24;
const AUTO_COLS = 5;
const MOVE_THRESHOLD = 5;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.15;
const WHEEL_ZOOM_FACTOR = 0.0015;

/**
 * Lienzo tipo Canva con todas las mesas del restaurante.
 *
 * Arquitectura:
 *  - Un viewport con `overflow:hidden` recorta el lienzo.
 *  - Una capa interna se transforma con
 *    `translate(panX, panY) scale(zoom)` y `transform-origin: 0 0`.
 *  - Cada mesa se posiciona en ABSOLUTO (`left/top` en px) según
 *    `pos_x`/`pos_y`. Las mesas sin coordenadas se auto-distribuyen
 *    en una grilla inicial.
 *
 * Interacción (pointer events nativos, NO cdk DragDrop porque el
 * `scale` del viewport rompe las coordenadas de cdk):
 *  - Pan: arrastrar el fondo mueve `panX`/`panY`.
 *  - Drag de mesa (solo `editable()`): arrastrar una mesa actualiza su
 *    posición dividiendo el delta del puntero por `zoom`. Al soltar
 *    emite `tableMoved` con enteros.
 *  - Pinch (dos punteros táctiles) y rueda del mouse: zoom centrado en
 *    el cursor (ajustando pan para mantener el punto bajo el cursor).
 *
 * Click vs drag: un umbral de movimiento (`MOVE_THRESHOLD` px)
 * distingue un click real de un arrastre; tras un drag/pan NO se emite
 * `tableClicked`.
 *
 * Contrato público preservado: inputs `tables` / `editable`, outputs
 * `tableClicked` / `tableMoved`. El output `tableMoved` mantiene la
 * forma `{ id, pos_x, pos_y }` con enteros.
 */
@Component({
  selector: 'app-table-floor-map',
  standalone: true,
  imports: [CommonModule, IconComponent, ButtonComponent],
  templateUrl: './table-floor-map.component.html',
  styleUrl: './table-floor-map.component.scss',
})
export class TableFloorMapComponent {
  readonly tables = input.required<Table[]>();
  readonly editable = input<boolean>(false);
  /**
   * When true, the component automatically re-fits the canvas to its
   * cells after each render cycle. Useful for parents that toggle
   * between list view and floor map (a single component instance can
   * be re-mounted or its initial-fit window can be long passed).
   *
   * Default `false` to preserve the original "fit once on first
   * non-empty render" behavior; the parent flips it to `true` when
   * the floor map becomes visible again (e.g. switching from table
   * view to floor view in the manage page).
   */
  readonly autoReset = input<boolean>(false);
  readonly tableClicked = output<Table>();
  readonly tableMoved = output<TableMovedEvent>();

  readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');

  /** Transform del lienzo. */
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly zoom = signal(1);
  readonly zoomPercent = computed(() => Math.round(this.zoom() * 100));

  /**
   * Posiciones locales sobrescribiendo `pos_x`/`pos_y` durante un drag.
   * Se llenan en cada move; persisten hasta que llega un `tables` nuevo.
   */
  readonly localPositions = signal<Map<number, { x: number; y: number }>>(
    new Map(),
  );

  /** Punteros activos (por id) para pan / drag / pinch. */
  private readonly pointers = new Map<number, ActivePointer>();

  /** Id de la mesa en drag (null = se está paneando el fondo o nada). */
  private draggingId: number | null = null;
  /** Origen del drag de mesa (posición de mesa al iniciar, px lienzo). */
  private dragTableOrigin: { x: number; y: number } | null = null;
  /** True una vez que el gesto superó el umbral de movimiento. */
  private gestureMoved = false;
  /** Estado del pinch (distancia base + zoom base). */
  private pinchBaseDistance = 0;
  private pinchBaseZoom = 1;

  /** Evita reencuadrar repetidamente: solo en el primer set con datos. */
  private hasInitialFit = false;

  /**
   * Scheduled fit (used by `resetView` retries). Holds the rAF id so we
   * can cancel a pending retry when the container finally gets a size.
   */
  private pendingFitFrame: number | null = null;
  /**
   * Retry attempts for `resetView` when the viewport has no size yet.
   * Stops after `MAX_FIT_ATTEMPTS` to avoid hammering rAF on a hidden
   * container that will never get dimensions.
   */
  private fitRetries = 0;
  private static readonly MAX_FIT_ATTEMPTS = 5;

  constructor() {
    // Al cambiar la lista de mesas, limpiar overrides locales obsoletos.
    // Reencuadra la vista la primera vez que llegan mesas.
    effect(() => {
      const list = this.tables();
      untracked(() => {
        this.localPositions.set(new Map());
        if (!this.hasInitialFit && list.length > 0 && this.viewport()) {
          this.hasInitialFit = true;
          this.resetView();
        }
      });
    });

    // El viewChild puede no existir al primer effect; garantizamos el
    // encuadre inicial tras el primer render si ya hay mesas (incluso
    // si el viewport todavía no tiene dimensiones, `resetView` lo
    // reintenta vía rAF).
    afterNextRender(() => {
      if (!this.hasInitialFit && this.cells().length > 0) {
        this.hasInitialFit = true;
        this.resetView();
      }
    });

    // Cuando el padre reactiva `autoReset` (p.ej. al alternar entre
    // vista de tabla y plano en la página de gestión), forzamos un
    // reencuadre ignorando `hasInitialFit`.
    effect(() => {
      const flag = this.autoReset();
      if (!flag) return;
      this.refit();
    });
  }

  readonly cells = computed<TableCell[]>(() => {
    const list = this.tables() ?? [];
    const overrides = this.localPositions();
    let autoIndex = 0;
    return list.map((t) => {
      const status = t.effective_status ?? t.status;
      const override = overrides.get(t.id);
      let x: number;
      let y: number;
      if (override) {
        x = override.x;
        y = override.y;
      } else if (t.pos_x != null && t.pos_y != null) {
        x = t.pos_x;
        y = t.pos_y;
      } else {
        // Auto-distribución en grilla para mesas sin coordenadas.
        const col = autoIndex % AUTO_COLS;
        const row = Math.floor(autoIndex / AUTO_COLS);
        x = col * (TABLE_W + GRID_GAP);
        y = row * (TABLE_H + GRID_GAP);
        autoIndex++;
      }
      return {
        table: t,
        displayStatus: status,
        statusLabel: TablesService.statusLabel(status),
        statusColor: TablesService.statusColorVar(status),
        isOccupied: status === 'occupied',
        guestCount: t.active_session?.guest_count ?? null,
        x,
        y,
      };
    });
  });

  // ----------------------------------------------------------------
  // Pointer handling
  // ----------------------------------------------------------------

  /** Pointerdown sobre el FONDO del lienzo → inicia pan. */
  onCanvasPointerDown(ev: PointerEvent): void {
    // Solo botón principal / touch / pen.
    if (ev.button !== 0) return;
    this.registerPointer(ev);
    this.draggingId = null;
    this.gestureMoved = false;
    if (this.pointers.size === 2) {
      this.beginPinch();
    }
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  }

  /** Pointerdown sobre una MESA → inicia drag (si editable) o prepara click. */
  onTablePointerDown(ev: PointerEvent, cell: TableCell): void {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    this.registerPointer(ev);
    this.gestureMoved = false;
    if (this.pointers.size === 2) {
      // Dos dedos = pinch aunque el primero haya tocado una mesa.
      this.draggingId = null;
      this.beginPinch();
    } else if (this.editable()) {
      this.draggingId = cell.table.id;
      this.dragTableOrigin = { x: cell.x, y: cell.y };
    } else {
      // En solo-lectura no arrastramos: dejamos el id para resolver
      // el click en pointerup si no hubo movimiento.
      this.draggingId = cell.table.id;
      this.dragTableOrigin = null;
    }
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  }

  onPointerMove(ev: PointerEvent): void {
    const ptr = this.pointers.get(ev.pointerId);
    if (!ptr) return;

    const prevX = ptr.lastClientX;
    const prevY = ptr.lastClientY;
    ptr.lastClientX = ev.clientX;
    ptr.lastClientY = ev.clientY;

    // Pinch-zoom con dos punteros.
    if (this.pointers.size === 2) {
      this.updatePinch();
      this.gestureMoved = true;
      ev.preventDefault();
      return;
    }

    const totalDx = ev.clientX - ptr.startClientX;
    const totalDy = ev.clientY - ptr.startClientY;
    if (
      !this.gestureMoved &&
      Math.hypot(totalDx, totalDy) > MOVE_THRESHOLD
    ) {
      this.gestureMoved = true;
    }

    const z = this.zoom();

    if (this.draggingId != null && this.dragTableOrigin && this.editable()) {
      // Drag de mesa (solo editable): delta de puntero / zoom para precisión.
      const newX = Math.round(
        this.dragTableOrigin.x + totalDx / z,
      );
      const newY = Math.round(
        this.dragTableOrigin.y + totalDy / z,
      );
      const clampedX = Math.max(0, newX);
      const clampedY = Math.max(0, newY);
      const id = this.draggingId;
      this.localPositions.update((m) => {
        const next = new Map(m);
        next.set(id, { x: clampedX, y: clampedY });
        return next;
      });
    } else {
      // Pan del fondo (o de una mesa en solo-lectura): delta crudo de
      // puntero — el lienzo ya está escalado, así que el pan es 1:1 en
      // píxeles de pantalla.
      const dx = ev.clientX - prevX;
      const dy = ev.clientY - prevY;
      this.panX.update((p) => p + dx);
      this.panY.update((p) => p + dy);
    }
    ev.preventDefault();
  }

  onPointerUp(ev: PointerEvent): void {
    const ptr = this.pointers.get(ev.pointerId);
    if (!ptr) return;
    this.pointers.delete(ev.pointerId);
    (ev.target as HTMLElement).releasePointerCapture?.(ev.pointerId);

    // Si soltó un dedo del pinch, no convertir el remanente en click/drag.
    if (this.pointers.size === 1) {
      this.gestureMoved = true;
      this.pinchBaseDistance = 0;
    }

    const wasDragging = this.draggingId;
    const moved = this.gestureMoved;

    // Persistir movimiento de mesa al soltar.
    if (
      this.pointers.size === 0 &&
      wasDragging != null &&
      this.editable() &&
      moved &&
      this.dragTableOrigin
    ) {
      const pos = this.localPositions().get(wasDragging);
      if (pos) {
        this.tableMoved.emit({
          id: wasDragging,
          pos_x: Math.round(pos.x),
          pos_y: Math.round(pos.y),
        });
      }
    }

    // Click real (sin movimiento) sobre una mesa. Aplica en ambos modos:
    // en solo-lectura abre la cuenta; en edición abre el formulario
    // (la página de gestión enlaza `tableClicked` a `openEdit`). Es
    // mutuamente excluyente con el drag-persist de arriba (que exige
    // `moved`).
    if (this.pointers.size === 0 && wasDragging != null && !moved) {
      const cell = this.cells().find((c) => c.table.id === wasDragging);
      if (cell) this.tableClicked.emit(cell.table);
    }

    if (this.pointers.size === 0) {
      this.draggingId = null;
      this.dragTableOrigin = null;
      this.gestureMoved = false;
      this.pinchBaseDistance = 0;
    }
    ev.preventDefault();
  }

  onPointerCancel(ev: PointerEvent): void {
    this.pointers.delete(ev.pointerId);
    (ev.target as HTMLElement).releasePointerCapture?.(ev.pointerId);
    if (this.pointers.size === 0) {
      this.draggingId = null;
      this.dragTableOrigin = null;
      this.gestureMoved = false;
      this.pinchBaseDistance = 0;
    }
  }

  /** Rueda del mouse → zoom centrado en el cursor. */
  onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const rect = this.viewport()?.nativeElement.getBoundingClientRect();
    if (!rect) return;
    const cursorX = ev.clientX - rect.left;
    const cursorY = ev.clientY - rect.top;
    const factor = Math.exp(-ev.deltaY * WHEEL_ZOOM_FACTOR);
    this.applyZoomAtPoint(this.zoom() * factor, cursorX, cursorY);
  }

  // ----------------------------------------------------------------
  // Zoom controls
  // ----------------------------------------------------------------

  zoomIn(): void {
    this.zoomAtCenter(this.zoom() + ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoomAtCenter(this.zoom() - ZOOM_STEP);
  }

  /**
   * Reset / fit: encuadra todas las mesas en el viewport.
   *
   * Si el contenedor todavía no tiene dimensiones (display:none
   * todavía, layout aún no midió), agenda un reintento vía rAF en lugar
   * de fallar silenciosamente. Tras `MAX_FIT_ATTEMPTS` intentos sin
   * éxito, abandona — el lienzo permanecerá en su estado actual y la
   * siguiente interacción (o un `refit()` explícito) lo reagenda.
   */
  resetView(): void {
    const rect = this.viewport()?.nativeElement.getBoundingClientRect();
    const cells = this.cells();
    if (!rect || cells.length === 0) {
      this.zoom.set(1);
      this.panX.set(0);
      this.panY.set(0);
      return;
    }

    // El contenedor aún no tiene tamaño: reintentar en el siguiente
    // frame. Esto cubre el caso del toggle "Tabla/Plano" en
    // `tables-manage-page`: el `<app-table-floor-map>` se desmonta del
    // DOM al cambiar a tabla y, al volver, su contenedor mide 0 hasta
    // el siguiente reflow.
    if (rect.width === 0 || rect.height === 0) {
      if (this.fitRetries < TableFloorMapComponent.MAX_FIT_ATTEMPTS) {
        if (this.pendingFitFrame != null) return;
        this.pendingFitFrame = requestAnimationFrame(() => {
          this.pendingFitFrame = null;
          this.fitRetries++;
          this.resetView();
        });
      }
      return;
    }
    this.fitRetries = 0;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of cells) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + TABLE_W);
      maxY = Math.max(maxY, c.y + TABLE_H);
    }

    const contentW = Math.max(maxX - minX, TABLE_W);
    const contentH = Math.max(maxY - minY, TABLE_H);
    const padding = 40;
    const scaleX = (rect.width - padding * 2) / contentW;
    const scaleY = (rect.height - padding * 2) / contentH;
    const fit = this.clampZoom(Math.min(scaleX, scaleY, 1));

    // Centrar el contenido en el viewport.
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;
    this.zoom.set(fit);
    this.panX.set(rect.width / 2 - contentCenterX * fit);
    this.panY.set(rect.height / 2 - contentCenterY * fit);
  }

  /**
   * Imperative fit: borra `hasInitialFit` y reencuadra en el siguiente
   * ciclo de render. Usado por:
   *  - el effect que observa `autoReset()` (cuando el padre alterna a
   *    la vista de plano), y
   *  - el padre directo via `[ref]` o `viewChild` cuando necesita
   *    forzar un reencuadre sin esperar al effect.
   *
   * Hace queue en microtask + 1 frame de rAF para garantizar que el
   * navegador ya pintó el viewport con sus dimensiones reales.
   */
  refit(): void {
    this.hasInitialFit = false;
    this.fitRetries = 0;
    if (this.pendingFitFrame != null) {
      cancelAnimationFrame(this.pendingFitFrame);
      this.pendingFitFrame = null;
    }
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        this.hasInitialFit = true;
        this.resetView();
      });
    });
  }

  private zoomAtCenter(target: number): void {
    const rect = this.viewport()?.nativeElement.getBoundingClientRect();
    if (!rect) {
      this.zoom.set(this.clampZoom(target));
      return;
    }
    this.applyZoomAtPoint(target, rect.width / 2, rect.height / 2);
  }

  /**
   * Aplica un nuevo zoom manteniendo el punto (viewportX, viewportY)
   * —relativo al viewport— fijo bajo el cursor.
   */
  private applyZoomAtPoint(
    target: number,
    viewportX: number,
    viewportY: number,
  ): void {
    const newZoom = this.clampZoom(target);
    const oldZoom = this.zoom();
    if (newZoom === oldZoom) return;
    const px = this.panX();
    const py = this.panY();
    // Punto del lienzo bajo el cursor antes del zoom.
    const canvasX = (viewportX - px) / oldZoom;
    const canvasY = (viewportY - py) / oldZoom;
    // Ajustar pan para que ese punto siga bajo el cursor.
    this.panX.set(viewportX - canvasX * newZoom);
    this.panY.set(viewportY - canvasY * newZoom);
    this.zoom.set(newZoom);
  }

  private clampZoom(z: number): number {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  }

  // ----------------------------------------------------------------
  // Pinch helpers
  // ----------------------------------------------------------------

  private beginPinch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    this.pinchBaseDistance = this.distance(pts[0], pts[1]);
    this.pinchBaseZoom = this.zoom();
  }

  private updatePinch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2 || this.pinchBaseDistance === 0) return;
    const dist = this.distance(pts[0], pts[1]);
    const rect = this.viewport()?.nativeElement.getBoundingClientRect();
    if (!rect) return;
    const midX = (pts[0].lastClientX + pts[1].lastClientX) / 2 - rect.left;
    const midY = (pts[0].lastClientY + pts[1].lastClientY) / 2 - rect.top;
    const target = this.pinchBaseZoom * (dist / this.pinchBaseDistance);
    this.applyZoomAtPoint(target, midX, midY);
  }

  private distance(a: ActivePointer, b: ActivePointer): number {
    return Math.hypot(
      a.lastClientX - b.lastClientX,
      a.lastClientY - b.lastClientY,
    );
  }

  private registerPointer(ev: PointerEvent): void {
    this.pointers.set(ev.pointerId, {
      id: ev.pointerId,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      lastClientX: ev.clientX,
      lastClientY: ev.clientY,
    });
  }

  trackByTableId(_i: number, cell: TableCell): number {
    return cell.table.id;
  }
}
