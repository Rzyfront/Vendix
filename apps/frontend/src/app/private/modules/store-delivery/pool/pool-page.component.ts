import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * PLACEHOLDER (Fase F2) — Pool de reparto (`/repartos/pool`).
 *
 * La Fase F3 REEMPLAZA este componente por la lista real del pool
 * (RepartosService.getPool + takeToMyRoute). Se crea mínimo para que el árbol
 * de rutas de la cáscara `/repartos` compile en AOT antes de F3.
 */
@Component({
  selector: 'app-pool-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="p-4 text-sm text-[var(--color-text-secondary)]">Pool</div>`,
})
export class PoolPageComponent {}
