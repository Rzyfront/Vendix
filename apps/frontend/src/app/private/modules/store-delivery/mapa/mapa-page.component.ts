import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * PLACEHOLDER (Fase F2) — Mapa de ruta (`/repartos/mapa`).
 *
 * La Fase F5 REEMPLAZA este componente por el mapa real de paradas
 * (MapLibre + map-stops). Mínimo para que el árbol de rutas de la cáscara
 * `/repartos` compile en AOT antes de F5.
 */
@Component({
  selector: 'app-mapa-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="p-4 text-sm text-[var(--color-text-secondary)]">Mapa</div>`,
})
export class MapaPageComponent {}
