import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IconComponent } from '../icon/icon.component';
import { ButtonComponent } from '../button/button.component';
import {
  MapViewComponent,
  MapMarker,
  LatLng,
} from '../map-view/map-view.component';
import { DispatchNoteAddressEditorComponent } from '../dispatch-note-address-editor/dispatch-note-address-editor.component';
import type { AddressPayload } from '../address-form-fields/address-form-fields.component';
// Reuse (no duplication): the live GPS watch degradation checks and the pure
// nearest-neighbor optimizer already live in the app. They are `providedIn:
// 'root'` singletons, so importing them here is a token/type import only —
// the same reuse the planilla map modal has always done.
import { GeolocationService } from '../../../private/modules/ecommerce/services/geolocation.service';
import {
  GeoStop,
  OptimizedRoute,
  RouteOptimizerService,
} from '../../../private/modules/store/planillas-rutas/services/route-optimizer.service';
import { RoutingService } from '../../../private/modules/ecommerce/services/routing.service';

/** Highlight color for the NEXT stop pin (distinct from map-view STATE_COLORS). */
const NEXT_STOP_COLOR = '#7c3aed';

/** Color de la próxima parada cuando el conductor está CERCA (verde entrega). */
const NEAR_STOP_COLOR = '#16a34a';

/**
 * Distancia (metros) bajo la cual la próxima parada se considera «al alcance»:
 * la tarjeta flotante se pone verde y el CTA de gestión se resalta. ~120 m cubre
 * el error típico del GPS urbano + la última cuadra sin marcar «llegaste» de más
 * lejos. El host puede ajustarlo vía `proximityThresholdM`.
 */
const NEAR_STOP_THRESHOLD_M = 120;

/**
 * Umbral (metros) para re-anclar el ruteo por calles en la posición del
 * conductor. El punto vivo del GPS se mueve suave en cada tick, pero el trazo
 * OSRM solo se recalcula cuando el conductor se aleja > este umbral del último
 * ancla — así el primer tramo sale «desde mí» sin re-llamar al proxy por tick.
 */
const ROUTE_ANCHOR_THRESHOLD_M = 40;

/**
 * A located stop the map can paint. Structurally compatible with the planilla
 * `MapStop` (so the admin modal can pass its backend `MapStop[]` as-is) and
 * with the shape the carrier page builds from `dispatch_note.customer_address`.
 */
export interface RouteMapStop {
  stopId: number;
  sequence: number;
  /** `pending` / `in_progress` for pending stops; `delivered` for the done leg. */
  status: string;
  customerName: string | null;
  addressText: string | null;
  lat: number;
  lng: number;
}

/**
 * A stop WITHOUT resolvable coordinates — listed under the map, never painted.
 *
 * `dispatchNoteId` y `customerAddress` son opcionales: el backend los emite
 * cuando quiere habilitar el flujo "Fijar en mapa" (PATCH
 * `/store/dispatch-notes/:id/address`). Cuando no vienen, el botón "Fijar en
 * mapa" se oculta — no hay nada que editar sin el id de la remisión.
 */
export interface RouteMapUnlocatedStop {
  stopId: number;
  sequence: number;
  customerName: string | null;
  addressText: string | null;
  /** Id de la remisión (`dispatch_notes.id`) — requerido para editar la dirección. */
  dispatchNoteId?: number | null;
  /** Snapshot `customer_address` de la remisión (JSON blob). */
  customerAddress?: AddressPayload | null;
}

/** One entry of the reorder payload emitted by `(applyOrder)`. */
export interface RouteMapReorderEntry {
  stopId: number;
  sequence: number;
}

/**
 * Presentational route map — the shared engine behind BOTH the admin
 * `PlanillaMapModalComponent` and the carrier `MapaPageComponent`.
 *
 * It owns the reusable, non-trivial parts that used to live in the modal:
 * building numbered markers, running {@link RouteOptimizerService} to suggest a
 * shortest-first visiting order, highlighting the NEXT stop, tracking the
 * driver's live position via `navigator.geolocation.watchPosition`, drawing the
 * route **por calles** (geometría OSRM vía el backend proxy) with an elegant
 * fallback to a straight polyline when the proxy is unavailable, and drawing
 * everything through {@link MapViewComponent} (reused as-is).
 *
 * It is fully data-driven: the host supplies the located pending `stops`, the
 * `delivered` leg, the `unlocated` list and an optional `origin`; this component
 * never fetches (except the OSRM directions proxy, which is presentation-only
 * route geometry). The optimizer anchors on the live driver location when
 * available (so "next stop" is relative to the driver) and degrades to `origin`
 * — or to nothing — when GPS is denied / unsupported / on an insecure context,
 * surfacing an animated GPS panel with a retry button instead of a static
 * notice.
 *
 * The optional "Aplicar orden óptimo" action is enabled with `showApplyOrder`;
 * the component emits the optimized 1-based order through `(applyOrder)` and the
 * HOST persists it (the admin modal → `reorderStops`). This keeps the component
 * presentation-only (no HTTP persistence of its own beyond route geometry).
 *
 * `fullscreen` mode drops the top summary bar and the unlocated list so the map
 * owns the whole viewport (carrier inmersivo), keeping only a compact floating
 * overlay with the next stop + ETA.
 *
 * Zoneless-clean: signal inputs/outputs, computed derived state, GPS readings
 * mirrored into signals (writes schedule change detection with no NgZone), the
 * OSRM fetch driven from an `effect` (dependencias estables: stops + origin, NO
 * `userLocation`, para no re-llamar al proxy en cada tick del GPS), and
 * `clearWatch` on destroy so switching tabs / closing the modal never leaks the
 * watch.
 */
@Component({
  selector: 'app-route-map-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    ButtonComponent,
    MapViewComponent,
    NgTemplateOutlet,
    DispatchNoteAddressEditorComponent,
  ],
  template: `
    <!-- Flex column: summary bar (shrink) + map (grow) + unlocated (shrink).
         Fills the host's height so the map is the protagonist.
         In fullscreen mode the map owns everything; the summary/unlocated blocks
         are replaced by a compact floating overlay on top of the map. -->
    <div class="flex h-full flex-col gap-3 relative">
      @if (fullscreen()) {
        <!-- Fullscreen: solo mapa + overlay flotante -->
        <div class="min-h-0 flex-1">
          <app-map-view
            class="block h-full"
            [markers]="markers()"
            [route]="drawnRoute()"
            [completedRoute]="completedRoute()"
            [origin]="mapOrigin()"
            [userLocation]="userLocation()"
            [fill]="true"
            [readonly]="readonly()"
            [bearing]="headingToNext()"
            [(followUser)]="followUser"
            [showRecenterControl]="autoOrient()"
          ></app-map-view>
        </div>

        <!-- Contenido de la tarjeta flotante (compartido botón/tarjeta).
             Declarado ANTES de su uso para que la referencia sea visible desde
             los bloques @if hermanos del overlay. -->
        <ng-template #overlayInner let-next>
          <div class="fs-overlay-row">
            <span
              class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold uppercase tracking-wide text-white text-[11px]"
              [style.background]="isNearNextStop() ? nearStopColor : nextStopColor"
            >
              <app-icon
                [name]="isNearNextStop() ? 'navigation' : 'map-pin'"
                [size]="12"
              ></app-icon>
              {{ isNearNextStop() ? 'Estás cerca' : 'Próxima' }}
            </span>
            <span class="min-w-0 truncate text-text-primary text-sm font-semibold">
              #{{ next.sequence }} · {{ next.customerName || '(Cliente)' }}
            </span>
            @if (manageableNext()) {
              <app-icon
                name="chevron-right"
                [size]="18"
                class="fs-overlay-chevron"
              ></app-icon>
            }
          </div>
          @if (streetLoading()) {
            <div class="fs-overlay-meta">
              <app-icon name="loader-2" [size]="13" [spin]="true" class="text-primary-600"></app-icon>
              <span class="text-xs text-text-secondary">Calculando ruta…</span>
            </div>
          } @else if (etaLabel(); as eta) {
            <div class="fs-overlay-meta">
              <app-icon name="navigation" [size]="13" class="text-primary-600"></app-icon>
              <span class="text-xs text-text-secondary">{{ eta }}</span>
            </div>
          } @else if (showApproxRouteBadge()) {
            <div class="fs-overlay-meta">
              <app-icon name="git-branch" [size]="13" class="text-text-muted"></app-icon>
              <span class="text-xs text-text-secondary">Ruta aproximada</span>
            </div>
          }
          @if (manageableNext() && isNearNextStop()) {
            <div class="fs-overlay-cta">
              <app-icon name="hand-coins" [size]="13"></app-icon>
              <span>Toca para gestionar la entrega</span>
            </div>
          }
        </ng-template>

        <!-- Overlay flotante: próxima parada + ETA. En el lado carrier
             (manageableNext) es un botón accionable que abre la gestión de
             entrega; se pone verde cuando el conductor está cerca. En el modal
             admin (default) queda como tarjeta informativa (no interactiva). -->
        @if (nextStop(); as next) {
          @if (manageableNext()) {
            <button
              type="button"
              class="fs-overlay fs-overlay--btn"
              [class.fs-overlay--near]="isNearNextStop()"
              (click)="onManageNextClick()"
              [attr.aria-label]="
                'Gestionar entrega de la parada ' +
                next.sequence +
                (isNearNextStop() ? ' — estás cerca' : '')
              "
            >
              <ng-container
                [ngTemplateOutlet]="overlayInner"
                [ngTemplateOutletContext]="{ $implicit: next }"
              ></ng-container>
            </button>
          } @else {
            <div class="fs-overlay">
              <ng-container
                [ngTemplateOutlet]="overlayInner"
                [ngTemplateOutletContext]="{ $implicit: next }"
              ></ng-container>
            </div>
          }
        }

        <!-- Panel GPS (fullscreen) -->
        @if (showGpsPanel()) {
          <div class="gps-panel">
            <div class="gps-halo">
              <app-icon name="map-pin" [size]="28" class="gps-pin-icon"></app-icon>
            </div>
            <p class="gps-title">Necesitamos tu ubicación</p>
            <p class="gps-desc">{{ gpsHelpText() }}</p>
            <div class="gps-actions">
              <app-button variant="primary" size="sm" (clicked)="retry()">{{ retryLabel() }}</app-button>
            </div>
          </div>
        }
      } @else {
        <!-- Modo normal: summary bar + mapa + unlocated -->

        <!-- Suggested-route summary (top bar) -->
        <div class="shrink-0 space-y-2 rounded-xl border border-border bg-surface p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-sm">
              <app-icon name="navigation" [size]="16" class="text-primary-600"></app-icon>
              <span class="font-semibold text-text-primary">
                Recorrido sugerido: {{ distanceLabel() }}
              </span>
            </div>
            <span class="text-xs text-text-secondary">
              {{ stopCount() }}
              {{ stopCount() === 1 ? 'parada pendiente' : 'paradas pendientes' }}
            </span>
            @if (streetLoading()) {
              <span class="inline-flex items-center gap-1 text-xs font-medium text-primary-700">
                <app-icon name="loader-2" [size]="12" [spin]="true"></app-icon>
                Calculando ruta…
              </span>
            } @else if (etaLabel(); as eta) {
              <span class="inline-flex items-center gap-1 text-xs font-medium text-primary-700">
                <app-icon name="clock" [size]="12"></app-icon>
                {{ eta }}
              </span>
            } @else if (showApproxRouteBadge()) {
              <span class="inline-flex items-center gap-1 text-xs font-medium text-text-secondary">
                <app-icon name="git-branch" [size]="12"></app-icon>
                Ruta aproximada
              </span>
            }
            @if (deliveredStops().length > 0) {
              <span class="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                <app-icon name="check-circle" [size]="12" class="text-green-600"></app-icon>
                {{ deliveredStops().length }}
                {{ deliveredStops().length === 1 ? 'entregada' : 'entregadas' }}
              </span>
            }
          </div>

          <!-- Next stop (first in the optimized order) -->
          @if (nextStop(); as next) {
            <div class="flex items-center gap-2 text-xs">
              <span
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold uppercase tracking-wide text-white"
                [style.background]="nextStopColor"
              >
                <app-icon name="map-pin" [size]="12"></app-icon>
                Próxima
              </span>
              <span class="min-w-0 truncate text-text-primary">
                #{{ next.sequence }} · {{ next.customerName || '(Cliente)' }}
                @if (next.addressText) {
                  <span class="text-text-secondary"> · {{ next.addressText }}</span>
                }
              </span>
            </div>
          }

          <!-- Panel GPS animado + reintentar (reemplaza el aviso ámbar estático) -->
          @if (showGpsPanel()) {
            <div class="gps-panel gps-panel--inline">
              <div class="gps-halo">
                <app-icon name="map-pin" [size]="24" class="gps-pin-icon"></app-icon>
              </div>
              <div class="gps-body">
                <p class="gps-title">Necesitamos tu ubicación</p>
                <p class="gps-desc">{{ gpsHelpText() }}</p>
              </div>
              <div class="gps-actions">
                <app-button variant="primary" size="sm" (clicked)="retry()">{{ retryLabel() }}</app-button>
              </div>
            </div>
          }
        </div>

        <!-- Map: fills the remaining height. min-h-0 is REQUIRED so this flex-1
             child can shrink instead of overflowing. -->
        <div class="min-h-0 flex-1">
          <app-map-view
            class="block h-full"
            [markers]="markers()"
            [route]="drawnRoute()"
            [completedRoute]="completedRoute()"
            [origin]="mapOrigin()"
            [userLocation]="userLocation()"
            [fill]="fill()"
            [readonly]="readonly()"
          ></app-map-view>
        </div>

        <!-- Optional "apply optimal order" action (host persists on (applyOrder)). -->
        @if (showApplyOrder()) {
          <div class="shrink-0 flex flex-col gap-2">
            @if (confirming()) {
              <div
                class="rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-secondary"
              >
                ¿Aplicar el orden sugerido a
                {{ stopCount() }}
                {{ stopCount() === 1 ? 'parada' : 'paradas' }}? Esto reordenará las
                paradas pendientes.
              </div>
              <div class="flex items-center justify-end gap-2">
                <app-button
                  variant="outline"
                  size="sm"
                  [disabled]="applying()"
                  (clicked)="confirming.set(false)"
                >
                  Cancelar
                </app-button>
                <app-button
                  variant="primary"
                  size="sm"
                  [loading]="applying()"
                  (clicked)="apply()"
                >
                  Confirmar orden
                </app-button>
              </div>
            } @else {
              <div class="flex items-center justify-end">
                <app-button
                  variant="primary"
                  size="sm"
                  [loading]="applying()"
                  [disabled]="!canApply()"
                  (clicked)="confirming.set(true)"
                >
                  <app-icon slot="icon" name="navigation" [size]="16"></app-icon>
                  Aplicar orden óptimo
                </app-button>
              </div>
            }
          </div>
        }

        <!-- Stops without coordinates (capped so it never steals the map height). -->
        @if (unlocated().length > 0) {
          <div
            class="shrink-0 max-h-[40vh] overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-3"
          >
            <div class="flex items-center gap-1.5 mb-2">
              <app-icon name="map-pin" [size]="14" class="text-amber-600"></app-icon>
              <span class="text-[11px] font-bold uppercase tracking-wide text-amber-800">
                Sin ubicación ({{ unlocated().length }})
              </span>
            </div>
            <ul class="space-y-1">
              @for (u of unlocated(); track u.stopId) {
                <li class="space-y-1.5">
                  <div class="flex items-start gap-2 text-xs text-amber-900">
                    <span class="font-mono font-semibold shrink-0">#{{ u.sequence }}</span>
                    <span class="min-w-0 flex-1">
                      {{ u.customerName || '(Cliente)' }}
                      @if (u.addressText) {
                        <span class="text-amber-700"> · {{ u.addressText }}</span>
                      }
                    </span>
                    @if (u.dispatchNoteId != null) {
                      <button
                        type="button"
                        class="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-500"
                        (click)="onFijarEnMapaClick(u)"
                        [attr.aria-label]="'Fijar en mapa la parada ' + u.sequence"
                      >
                        <app-icon name="map-pin" [size]="12"></app-icon>
                        @if (editingNoteId() === u.stopId) {
                          Cerrar
                        } @else {
                          Fijar en mapa
                        }
                      </button>
                    }
                  </div>
                  @if (editingNoteId() === u.stopId && u.dispatchNoteId != null) {
                    <div class="rounded-lg border border-amber-200 bg-white p-2">
                      <app-dispatch-note-address-editor
                        [noteId]="u.dispatchNoteId"
                        [address]="u.customerAddress ?? null"
                        (saved)="onAddressSaved(u)"
                      ></app-dispatch-note-address-editor>
                    </div>
                  }
                </li>
              }
            </ul>
            <p class="mt-2 text-[11px] text-amber-700">
              Estas paradas no tienen coordenadas y no se pueden dibujar en el mapa
              ni incluir en el recorrido sugerido.
            </p>
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      /* ── Fullscreen overlay (próxima parada + ETA flotante) ──
         Glass: flota sobre el mapa (siempre claro), translúcido con blur. */
      .fs-overlay {
        position: absolute;
        top: 12px;
        left: 12px;
        /* Tarjeta compacta anclada a la izquierda: NO se extiende hasta el borde
           derecho para no tapar la columna de controles del mapa (zoom +/- y
           fullscreen viven en top-right). El tope deja ~76px libres a la derecha. */
        right: auto;
        max-width: min(460px, calc(100% - 50px));
        z-index: 5;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 11px 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.6);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        box-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.22);
        pointer-events: none;
      }
      .fs-overlay-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .fs-overlay-meta {
        display: flex;
        align-items: center;
        gap: 4px;
        padding-left: 28px;
      }

      /* ── Variante accionable (carrier): la tarjeta es un botón ──
         Recupera pointer-events (la base los apaga para dejar pasar el gesto al
         mapa) y añade affordances de toque: hover/active/focus. */
      .fs-overlay--btn {
        pointer-events: auto;
        cursor: pointer;
        width: auto;
        text-align: left;
        font: inherit;
        -webkit-appearance: none;
        appearance: none;
        transition:
          transform 140ms ease,
          box-shadow 140ms ease,
          background 140ms ease,
          border-color 140ms ease;
      }
      .fs-overlay--btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 14px 34px -8px rgba(0, 0, 0, 0.28);
      }
      .fs-overlay--btn:active {
        transform: translateY(0);
      }
      .fs-overlay--btn:focus-visible {
        outline: 2px solid var(--color-ring, #2563eb);
        outline-offset: 2px;
      }
      /* Verde «entrega» cuando el conductor está cerca de la próxima parada. */
      .fs-overlay--near {
        background: rgba(240, 253, 244, 0.94);
        border-color: rgba(22, 163, 74, 0.55);
        box-shadow: 0 12px 32px -8px rgba(22, 163, 74, 0.42);
      }
      .fs-overlay-chevron {
        margin-left: auto;
        flex-shrink: 0;
        color: var(--color-text-muted, #9ca3af);
      }
      .fs-overlay--near .fs-overlay-chevron {
        color: #16a34a;
      }
      .fs-overlay-cta {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-top: 2px;
        font-size: 12px;
        font-weight: 600;
        color: #15803d;
      }

      /* ── Panel GPS animado (permiso denegado / prompt) ── */
      .gps-panel {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        padding: 26px 20px;
        border-radius: 18px;
        background: var(--color-surface, #ffffff);
        border: 1px solid var(--color-border, #e5e7eb);
        box-shadow: 0 14px 34px -12px rgba(0, 0, 0, 0.2);
        text-align: center;
      }
      .gps-panel--inline {
        flex-direction: row;
        align-items: center;
        text-align: left;
        gap: 14px;
      }
      .gps-panel--inline .gps-body {
        flex: 1;
        min-width: 0;
      }
      /* Halo animado: anillo que pulsa alrededor del icono (respeto prefers-reduced-motion
         vía la regla global de styles.scss, que reduce la duración a ~0). */
      .gps-halo {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 64px;
        height: 64px;
        flex-shrink: 0;
        border-radius: 9999px;
        color: #ffffff;
        background: linear-gradient(
          135deg,
          rgb(var(--color-primary-rgb, 126, 215, 165)) 0%,
          rgb(var(--color-secondary-rgb, 47, 111, 78)) 100%
        );
        box-shadow: 0 10px 24px -8px rgba(var(--color-secondary-rgb, 47, 111, 78), 0.55);
      }
      .gps-halo::before,
      .gps-halo::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 9999px;
        background: rgb(var(--color-primary-rgb, 126, 215, 165));
        opacity: 0.25;
        animation: gps-halo-pulse 2.2s ease-out infinite;
        z-index: 0;
      }
      .gps-halo::after {
        animation-delay: 1.1s;
      }
      .gps-pin-icon {
        position: relative;
        z-index: 1;
      }
      .gps-title {
        font-size: 14px;
        font-weight: 700;
        color: var(--color-text-primary, #111827);
      }
      .gps-desc {
        font-size: 12px;
        line-height: 1.4;
        color: var(--color-text-secondary, #6b7280);
        max-width: 320px;
      }
      .gps-actions {
        display: flex;
        justify-content: center;
      }
      .gps-panel--inline .gps-actions {
        justify-content: flex-end;
      }
      @keyframes gps-halo-pulse {
        0% {
          transform: scale(0.6);
          opacity: 0.45;
        }
        70% {
          transform: scale(1.6);
          opacity: 0;
        }
        100% {
          transform: scale(1.6);
          opacity: 0;
        }
      }
    `,
  ],
})
export class RouteMapViewComponent implements OnInit, OnDestroy {
  private readonly optimizer = inject(RouteOptimizerService);
  private readonly geo = inject(GeolocationService);
  private readonly routing = inject(RoutingService);
  private readonly destroyRef = inject(DestroyRef);

  /** Active `watchPosition` id, cleared on destroy. `null` when not watching. */
  private watchId: number | null = null;
  /** In-flight OSRM subscription, cancelled on re-fetch + destroy. */
  private routeSub: Subscription | null = null;

  /** Located pending stops — the optimizer input (numbered, next highlighted). */
  readonly stops = input<RouteMapStop[]>([]);
  /** Located delivered stops — kept green on the map so a settled stop stays. */
  readonly delivered = input<RouteMapStop[]>([]);
  /** Pending stops without coordinates — listed under the map. */
  readonly unlocated = input<RouteMapUnlocatedStop[]>([]);
  /** Route origin (warehouse). `null` → the map anchors on the driver only. */
  readonly origin = input<LatLng | null>(null);
  /** Passthrough to map-view: `true` (default) keeps pins read-only. */
  readonly readonly = input<boolean>(true);
  /** Passthrough to map-view: `true` fills the host height (immersive hosts). */
  readonly fill = input<boolean>(false);
  /** Fullscreen inmersivo: oculta summary/unlocated, el mapa llena todo + overlay. */
  readonly fullscreen = input<boolean>(false);
  /**
   * Auto-orientación (solo lado carrier inmersivo): cuando `true`, el mapa gira
   * para que la próxima parada quede «hacia arriba» (bearing = azimut
   * conductor→próxima) y expone el control flotante de recentrado. El modal admin
   * NO lo pasa → `false` → norte-arriba + fitBounds, sin control (comportamiento
   * idéntico al actual).
   */
  readonly autoOrient = input<boolean>(false);
  /** Renders the "Aplicar orden óptimo" action (host persists on emit). */
  readonly showApplyOrder = input<boolean>(false);
  /** Host-driven loading of the persist call — spins/disables the apply button. */
  readonly applying = input<boolean>(false);
  /** Minimum located stops required before "apply order" is available. */
  readonly minStopsToApply = input<number>(2);

  /**
   * Habilita que la tarjeta flotante "Próxima" del modo fullscreen sea un botón
   * accionable (lado carrier). El modal admin la deja en `false` → sigue siendo
   * una tarjeta puramente informativa (sin clic, sin verde de proximidad).
   */
  readonly manageableNext = input<boolean>(false);
  /**
   * Distancia (m) bajo la cual la próxima parada se considera «al alcance»: la
   * tarjeta se pone verde y aparece el CTA de gestión. Default
   * {@link NEAR_STOP_THRESHOLD_M}.
   */
  readonly proximityThresholdM = input<number>(NEAR_STOP_THRESHOLD_M);

  /** Emitted (1-based order) when the user confirms "apply optimal order". */
  readonly applyOrder = output<RouteMapReorderEntry[]>();

  /**
   * Emite el `stopId` de la próxima parada cuando el conductor toca la tarjeta
   * flotante (solo con `manageableNext`). El host abre el flujo de gestión de
   * entrega — mismo que la vista de rutas — con el `DispatchRouteStop` completo.
   */
  readonly manageNext = output<number>();

  /**
   * Emite el `dispatchNoteId` de la remisión cuya dirección fue corregida vía
   * el editor "Fijar en mapa" en un stop `unlocated`. El host debe refrescar
   * `getMapStops` para que el stop deje de ser `unlocated` y aparezca como
   * marcador pintado. Solo se emite cuando el stop trae `dispatchNoteId`.
   */
  readonly addressFixed = output<number>();

  /** Highlight color for the "Próxima" badge (kept in sync with the map pin). */
  readonly nextStopColor = NEXT_STOP_COLOR;
  /** Color de la tarjeta/badge cuando el conductor está cerca (verde entrega). */
  readonly nearStopColor = NEAR_STOP_COLOR;

  /** Live driver position (updated on every GPS reading). `null` until a fix. */
  readonly userLocation = signal<LatLng | null>(null);
  /**
   * "Seguirme" en el mapa (two-way con map-view). Arranca en `false`: el mapa
   * encuadra todas las paradas orientado hacia la próxima. Al tocar el control de
   * recentrado pasa a `true` y la cámara sigue al conductor; un gesto manual de
   * pan/rotación lo apaga de nuevo (map-view lo escribe de vuelta por el binding).
   */
  readonly followUser = signal<boolean>(false);
  /** True once GPS is known to be unavailable (denied / unsupported / insecure). */
  readonly locationUnavailable = signal(false);
  /** Inline confirm state for the "apply order" action (no separate dialog). */
  readonly confirming = signal(false);

  /**
   * Id del stop unlocated cuyo editor "Fijar en mapa" está abierto. `null`
   * cuando ningún editor está visible. Se togglear con {@link onFijarEnMapaClick}
   * y se limpia al guardar ({@link onAddressSaved}). Es un signal (no un
   * boolean) porque solo un editor puede estar abierto a la vez — abrir otro
   * cierra el anterior implcitamente.
   */
  readonly editingNoteId = signal<number | null>(null);

  /** Estado del permiso de geolocalización (granted/denied/prompt/unsupported). */
  readonly permissionState = signal<
    PermissionState | 'unsupported' | 'unknown'
  >('unknown');
  /** Muestra las instrucciones para habilitar el permiso (hard-denied / HTTPS). */
  readonly deniedHelp = signal(false);

  /** Geometría por calles (OSRM) mapeada a LatLng[]. Vacía → fallback a recto. */
  readonly streetRoute = signal<LatLng[]>([]);
  /** ETA en segundos desde la geometría OSRM. `null` si no hay trazo por calles. */
  readonly streetEta = signal<number | null>(null);
  /** `true` mientras se espera la geometría OSRM. */
  readonly streetLoading = signal(false);

  /**
   * Ancla de ruteo por calles: la posición del conductor «congelada» hasta que
   * se aleja > {@link ROUTE_ANCHOR_THRESHOLD_M}. Es lo que usa el effect de OSRM
   * como PRIMER waypoint (el trazo arranca desde el conductor, no desde la
   * parada 1), sin re-llamar al proxy en cada tick del GPS. `null` hasta el
   * primer fix; entonces el effect cae a `origin`.
   */
  private readonly routedFrom = signal<LatLng | null>(null);

  /**
   * Start of the route: the live driver location when available, otherwise the
   * route's own origin. This is what the optimizer anchors on and where the
   * polyline begins.
   */
  private readonly startPoint = computed<LatLng | null>(
    () => this.userLocation() ?? this.origin(),
  );

  /**
   * Origin (home) pin shown on the map. Only when there is NO live location —
   * once the driver's live dot is the start, a second "home" start pin would be
   * confusing, so it is hidden.
   */
  readonly mapOrigin = computed<LatLng | null>(() =>
    this.userLocation() ? null : this.origin(),
  );

  /** Located pending stops as optimizer input. */
  private readonly geoStops = computed<GeoStop[]>(() =>
    this.stops().map((s) => ({
      stopId: s.stopId,
      sequence: s.sequence,
      lat: s.lat,
      lng: s.lng,
    })),
  );

  /**
   * Suggested visiting order + total distance (pure haversine nearest-neighbor),
   * anchored on {@link startPoint} so the "next" stop is relative to the driver.
   */
  private readonly optimized = computed<OptimizedRoute>(() =>
    this.optimizer.optimize(this.startPoint(), this.geoStops()),
  );

  /** Located pending stops keyed by id, for status/customer lookup on render. */
  private readonly stopsById = computed<Map<number, RouteMapStop>>(
    () => new Map(this.stops().map((s) => [s.stopId, s])),
  );

  /** Delivered located stops (kept green on the map). */
  readonly deliveredStops = computed<RouteMapStop[]>(() => this.delivered());

  /**
   * Pins: the SUGGESTED (pending) order first — labelled by position, next stop
   * highlighted — followed by delivered stops as green ✓ pins.
   */
  readonly markers = computed<MapMarker[]>(() => {
    const byId = this.stopsById();
    const pending = this.optimized().orderedStops.map((s, i) => {
      const isNext = i === 0;
      return {
        lat: s.lat,
        lng: s.lng,
        label: String(i + 1),
        // `color` wins over `state` in map-view, so the next stop stands out.
        color: isNext ? NEXT_STOP_COLOR : undefined,
        state: isNext ? undefined : byId.get(s.stopId)?.status,
      } satisfies MapMarker;
    });
    const delivered = this.deliveredStops().map(
      (s) =>
        ({
          lat: s.lat,
          lng: s.lng,
          label: '✓',
          state: 'delivered',
        }) satisfies MapMarker,
    );
    return [...pending, ...delivered];
  });

  /** The next stop to visit (first in the optimized order), for the badge. */
  readonly nextStop = computed<RouteMapStop | null>(() => {
    const first = this.optimized().orderedStops[0];
    return first ? (this.stopsById().get(first.stopId) ?? null) : null;
  });

  /**
   * ¿El conductor está «al alcance» de la próxima parada? True solo en modo
   * accionable (`manageableNext`) cuando hay GPS + próxima parada y la distancia
   * haversine es ≤ `proximityThresholdM`. Dispara el verde + el CTA de gestión.
   */
  readonly isNearNextStop = computed<boolean>(() => {
    if (!this.manageableNext()) return false;
    const u = this.userLocation();
    const next = this.nextStop();
    if (!u || !next) return false;
    return (
      this.haversineMeters(u, { lat: next.lat, lng: next.lng }) <=
      this.proximityThresholdM()
    );
  });

  /**
   * Azimut (grados, horario desde el norte) del conductor hacia la próxima
   * parada, para orientar el mapa «hacia adelante». `null` cuando `autoOrient`
   * está apagado o falta GPS/próxima parada → map-view cae a norte-arriba. Solo
   * el lado carrier (autoOrient) lo consume; el modal admin recibe siempre null.
   */
  readonly headingToNext = computed<number | null>(() => {
    if (!this.autoOrient()) return null;
    const u = this.userLocation();
    const next = this.nextStop();
    if (!u || !next) return null;
    return this.bearingTo(u, { lat: next.lat, lng: next.lng });
  });

  /** Polyline points: the start (driver or route origin) then the ordered stops. */
  readonly routeLine = computed<LatLng[]>(() => {
    const points: LatLng[] = [];
    const start = this.startPoint();
    if (start) points.push(start);
    for (const s of this.optimized().orderedStops) {
      points.push({ lat: s.lat, lng: s.lng });
    }
    return points;
  });

  /**
   * Ruta dibujada: geometría por calles (OSRM) si está disponible, si no cae a la
   * línea recta {@link routeLine}. Nunca vacía cuando hay paradas (degradación
   * elegante: si el proxy OSRM falla, el mapa sigue mostrando la ruta recta).
   */
  readonly drawnRoute = computed<LatLng[]>(() => {
    const street = this.streetRoute();
    return street.length >= 2 ? street : this.routeLine();
  });

  /** Green completed-route polyline: the delivered stops in their given order. */
  readonly completedRoute = computed<LatLng[]>(() =>
    this.deliveredStops().map((s) => ({ lat: s.lat, lng: s.lng })),
  );

  /** Number of mappable (located) pending stops. */
  readonly stopCount = computed<number>(() => this.stops().length);

  /** Human-readable total distance of the suggested route. */
  readonly distanceLabel = computed<string>(
    () => `${this.optimized().totalDistanceKm.toFixed(1)} km`,
  );

  /**
   * ETA legible desde la geometría OSRM. `null` cuando no hay trazo por calles
   * (fallback a recto, sin ETA confiable).
   */
  readonly etaLabel = computed<string | null>(() => {
    const s = this.streetEta();
    if (s == null || s <= 0) return null;
    if (s < 60) return `${Math.round(s)} seg`;
    const min = Math.round(s / 60);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const rest = min % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  });

  /**
   * ¿Mostrar el badge "Ruta aproximada"? True cuando hay una ruta dibujada pero
   * NO se obtuvo geometría por calles (OSRM falló → se cayó a la línea recta),
   * y no está en curso el cálculo. Da feedback visible en vez del silencio actual.
   */
  readonly showApproxRouteBadge = computed<boolean>(
    () =>
      !this.streetLoading() &&
      this.streetRoute().length < 2 &&
      this.drawnRoute().length >= 2,
  );

  /** "Apply" is available only with enough located stops and no in-flight work. */
  readonly canApply = computed<boolean>(
    () =>
      this.showApplyOrder() &&
      !this.applying() &&
      this.stopCount() >= this.minStopsToApply(),
  );

  /** GPS fallback copy — adapts a si hay origen de la ruta. */
  readonly locationNotice = computed<string>(() =>
    this.origin()
      ? 'Ubicación no disponible — usando origen de la ruta.'
      : 'Ubicación no disponible — mostrando solo las paradas.',
  );

  /** ¿Mostrar el panel GPS animado? Solo si GPS no está disponible y no concedido. */
  readonly showGpsPanel = computed<boolean>(
    () =>
      this.locationUnavailable() &&
      this.permissionState() !== 'granted' &&
      this.permissionState() !== 'unknown',
  );

  /** Copy del panel GPS según el estado del permiso. */
  readonly gpsHelpText = computed<string>(() => {
    const state = this.permissionState();
    if (this.deniedHelp()) {
      return 'El navegador bloqueó la ubicación. Habilítala en los permisos del sitio (icono de candado en la barra de direcciones) y vuelve a intentar.';
    }
    if (state === 'denied') {
      return 'El navegador bloqueó la ubicación. Toca «Reintentar» para ver cómo habilitarla.';
    }
    if (state === 'unsupported') {
      return 'Tu navegador no soporta geolocalización. Usa un navegador moderno para trazar la ruta.';
    }
    return 'Toca «Reintentar» para permitir el acceso a tu ubicación y trazar la ruta por calles.';
  });

  /** Label del botón según el estado. */
  readonly retryLabel = computed<string>(() => {
    const state = this.permissionState();
    if (this.deniedHelp() || state === 'denied' || state === 'unsupported') {
      return 'Cómo habilitar';
    }
    return 'Reintentar';
  });

  constructor() {
    // Re-ancla el ruteo en la posición del conductor con HISTÉRESIS: sigue a
    // `userLocation` pero solo mueve `routedFrom` cuando el conductor se aleja
    // > UMBRAL. Así el trazo por calles arranca «desde mí» y se recalcula al
    // avanzar, pero NO en cada tick del GPS (que dispararía cache-miss constante
    // en el proxy OSRM). `untracked` evita que leer `routedFrom` re-dispare
    // este mismo effect.
    effect(() => {
      const u = this.userLocation();
      if (!u) return;
      const prev = untracked(this.routedFrom);
      if (!prev || this.haversineMeters(prev, u) > ROUTE_ANCHOR_THRESHOLD_M) {
        this.routedFrom.set(u);
      }
    });

    // Fetch de la geometría por calles (OSRM). Dependencias ESTABLES: stops +
    // ancla de ruteo (`routedFrom`, con histéresis) u `origin`. NO lee
    // `userLocation` crudo → no re-llama al proxy en cada tick del GPS. El
    // conductor se ve como punto vivo; la ruta por calles va conductor → paradas
    // y se recalcula solo cuando las paradas cambian o el conductor avanza.
    effect(() => {
      const stopsInput = this.stops();
      const anchor = this.routedFrom() ?? this.origin();
      const geo = stopsInput.map((s) => ({
        stopId: s.stopId,
        sequence: s.sequence,
        lat: s.lat,
        lng: s.lng,
      }));
      // Orden optimizado anclado en la posición del conductor (o el origen si aún
      // no hay GPS), consistente con el primer waypoint del trazo.
      const ordered = this.optimizer.optimize(anchor, geo).orderedStops;
      const waypoints: LatLng[] = [];
      if (anchor) waypoints.push(anchor);
      for (const s of ordered) waypoints.push({ lat: s.lat, lng: s.lng });
      this.fetchStreetRoute(waypoints);
    });
  }

  /**
   * Azimut inicial (grados 0–360, horario desde el norte) del punto `from` al
   * punto `to`. Fórmula de rumbo en gran círculo — suficiente y estable para
   * orientar la cámara hacia la próxima parada.
   */
  private bearingTo(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const φ1 = toRad(from.lat);
    const φ2 = toRad(to.lat);
    const Δλ = toRad(to.lng - from.lng);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x =
      Math.cos(φ1) * Math.sin(φ2) -
      Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  /** Distancia haversine en metros entre dos coordenadas. */
  private haversineMeters(a: LatLng, b: LatLng): number {
    const R = 6_371_000; // radio terrestre (m)
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  ngOnInit(): void {
    this.startLocationWatch();
    this.refreshPermissionState();
  }

  ngOnDestroy(): void {
    this.stopLocationWatch();
    this.routeSub?.unsubscribe();
  }

  /**
   * Reintenta el permiso de GPS. Si el estado es `prompt` dispara la solicitud
   * nativa (getCurrentPosition); al conceder, reanuda el watch. Si está `denied`
   * (hard-denied — el navegador NO re-dispara el prompt nativo) muestra las
   * instrucciones para habilitarlo en ajustes del sitio. Nunca deja al conductor
   * en un estado muerto.
   */
  async retry(): Promise<void> {
    const state = await this.geo.getPermissionState();
    this.permissionState.set(state);

    if (state === 'unsupported') {
      this.deniedHelp.set(true);
      return;
    }
    if (state === 'denied') {
      // Hard-denied: el navegador no re-dispara el prompt. Solo podemos guiar.
      this.deniedHelp.set(true);
      return;
    }
    // state === 'prompt' (o desconocido): dispara la solicitud nativa.
    this.deniedHelp.set(false);
    try {
      const coords = await this.geo.getCurrentPosition();
      this.userLocation.set({ lat: coords.lat, lng: coords.lng });
      this.locationUnavailable.set(false);
      // Reanuda el watch continuo ahora que el permiso está concedido.
      this.stopLocationWatch();
      this.startLocationWatch();
    } catch (err) {
      // Si el usuario niega en el prompt, el estado pasa a denied.
      this.permissionState.set('denied');
      this.deniedHelp.set(true);
    }
  }

  /** Consulta el estado del permiso async y lo refleja en el signal. */
  private async refreshPermissionState(): Promise<void> {
    const state = await this.geo.getPermissionState();
    this.permissionState.set(state);
  }

  /**
   * Traza la ruta por calles (OSRM) para los waypoints dados. Cancela la
   * suscripción previa (evita acumularlas al re-correr el effect). Si hay <2 pts
   * o el proxy falla, limpia la geometría → el template cae a la línea recta.
   */
  private fetchStreetRoute(waypoints: LatLng[]): void {
    this.routeSub?.unsubscribe();
    if (waypoints.length < 2) {
      this.streetRoute.set([]);
      this.streetEta.set(null);
      this.streetLoading.set(false);
      return;
    }
    this.streetLoading.set(true);
    this.routeSub = this.routing
      .getDirections(waypoints)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.streetLoading.set(false);
          if (r.geometry && r.geometry.coordinates.length >= 2) {
            this.streetRoute.set(
              r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
            );
            this.streetEta.set(r.duration_s);
          } else {
            this.streetRoute.set([]);
            this.streetEta.set(null);
          }
        },
        error: () => {
          // Degradación elegante: el template cae a la línea recta.
          this.streetLoading.set(false);
          this.streetRoute.set([]);
          this.streetEta.set(null);
        },
      });
  }

  /**
   * Emits the optimized order (1-based `sequence` re-derived from position) for
   * the host to persist. Closes the inline confirm; the host owns the loading
   * feedback via `applying` and re-feeds fresh stops on success.
   */
  apply(): void {
    if (!this.canApply()) return;
    const order: RouteMapReorderEntry[] = this.optimized().orderedStops.map(
      (s, i) => ({ stopId: s.stopId, sequence: i + 1 }),
    );
    this.applyOrder.emit(order);
    this.confirming.set(false);
  }

  /**
   * Toca la tarjeta flotante "Próxima" (solo con `manageableNext`) → emite el
   * `stopId` para que el host abra la gestión de entrega de esa parada. No-op si
   * no hay próxima parada o el modo no es accionable.
   */
  onManageNextClick(): void {
    if (!this.manageableNext()) return;
    const next = this.nextStop();
    if (next) this.manageNext.emit(next.stopId);
  }

  /**
   * Togglea el editor "Fijar en mapa" para un stop unlocated. Solo procede si el
   * stop trae `dispatchNoteId` (sin l no hay nada que PATCHear). Abrir un editor
   * cierra cualquier otro que estuviera abierto (estado singleton vía signal).
   */
  onFijarEnMapaClick(stop: RouteMapUnlocatedStop): void {
    if (stop.dispatchNoteId == null) return;
    const current = this.editingNoteId();
    if (current === stop.stopId) {
      this.editingNoteId.set(null);
    } else {
      this.editingNoteId.set(stop.stopId);
    }
  }

  /**
   * Tras guardar exitosamente la dirección de la remisión (el editor emite
   * `saved`): cierra el editor, emite `addressFixed` con el `dispatchNoteId` para
   * que el host refresque `getMapStops` (el stop deja de ser `unlocated` y se
   * convierte en marcador pintado).
   */
  onAddressSaved(stop: RouteMapUnlocatedStop): void {
    this.editingNoteId.set(null);
    const noteId = stop.dispatchNoteId;
    if (noteId != null) this.addressFixed.emit(noteId);
  }

  /**
   * Starts a continuous GPS watch. The shared `GeolocationService` only offers
   * one-shot reads, so we drive `navigator.geolocation.watchPosition` directly
   * and mirror each reading into `userLocation`. On error (denied / unavailable
   * / timeout) we degrade to the route origin and flag the notice.
   */
  private startLocationWatch(): void {
    if (
      !this.geo.isSupported() ||
      typeof navigator === 'undefined' ||
      !navigator.geolocation
    ) {
      this.locationUnavailable.set(true);
      return;
    }
    if (
      typeof window !== 'undefined' &&
      (window as Window).isSecureContext === false
    ) {
      this.locationUnavailable.set(true);
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        // Signal writes schedule change detection in the zoneless runtime; no
        // NgZone needed even though this callback fires outside Angular.
        this.userLocation.set({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        this.locationUnavailable.set(false);
      },
      () => {
        // Only surface the fallback notice while we have no fix at all; a
        // transient error after a good fix keeps the last known position.
        if (!this.userLocation()) this.locationUnavailable.set(true);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }

  /** Clears the active GPS watch, if any. Idempotent. */
  private stopLocationWatch(): void {
    if (
      this.watchId != null &&
      typeof navigator !== 'undefined' &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
  }
}