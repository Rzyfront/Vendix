import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * PLACEHOLDER (Fase F2) — Sesión del carrier (`/repartos/sesion`).
 *
 * La Fase F6 REEMPLAZA este componente por la vista real de sesión (perfil del
 * repartidor, payout acumulado, cerrar sesión). Mínimo para que el árbol de
 * rutas de la cáscara `/repartos` compile en AOT antes de F6.
 */
@Component({
  selector: 'app-sesion-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="p-4 text-sm text-[var(--color-text-secondary)]">Sesión</div>`,
})
export class SesionPageComponent {}
