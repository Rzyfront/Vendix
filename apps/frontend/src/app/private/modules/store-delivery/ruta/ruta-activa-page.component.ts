import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * PLACEHOLDER (Fase F2) — Mi ruta activa (`/repartos/ruta`).
 *
 * La Fase F4 REEMPLAZA este componente por la vista real de la ruta activa
 * (ActiveRouteStore + start/settle/release/dispatch/close). Mínimo para que el
 * árbol de rutas de la cáscara `/repartos` compile en AOT antes de F4.
 */
@Component({
  selector: 'app-ruta-activa-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="p-4 text-sm text-[var(--color-text-secondary)]">Mi Ruta</div>`,
})
export class RutaActivaPageComponent {}
