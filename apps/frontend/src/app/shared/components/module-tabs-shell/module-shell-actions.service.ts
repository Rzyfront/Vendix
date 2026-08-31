import { Injectable, computed, signal } from '@angular/core';

import type { StickyHeaderActionButton } from '../sticky-header/sticky-header.component';

/**
 * Accion publicada por una pagina ruteada hacia el sticky-header del shell.
 *
 * Es un `StickyHeaderActionButton` mas el callback que hay que ejecutar. El
 * shell nunca sabe que hace el boton: solo lo pinta y devuelve el `id`.
 */
export interface ModuleShellAction extends StickyHeaderActionButton {
  run: () => void;
}

/**
 * Canal por el que una pagina dentro de `<router-outlet>` publica sus botones
 * de accion en el sticky-header de `ModuleTabsShellComponent`.
 *
 * El motivo por el que hace falta un servicio y no basta content projection:
 * el shell renderiza a sus hijos a traves de `<router-outlet />`, y el
 * contenido de un outlet NO se puede proyectar hacia arriba dentro del
 * template del shell. Sin este canal, cada pagina tenia que dibujar su propia
 * barra de acciones debajo del header — que es exactamente la barra duplicada
 * que Rafael pidio eliminar: dos cabeceras pegadas, una encima de la otra,
 * ambas sticky, comiendose la pantalla en movil.
 *
 * Contrato de uso en la pagina:
 *   ngOnInit  -> shellActions.set([...])
 *   ngOnDestroy -> shellActions.clear()
 *
 * `clear()` en el destroy es obligatorio: sin el, los botones de la pagina
 * anterior sobreviven al cambio de pestaña y quedan disparando callbacks de
 * un componente ya destruido.
 */
@Injectable({ providedIn: 'root' })
export class ModuleShellActionsService {
  private readonly _actions = signal<ModuleShellAction[]>([]);

  /** Lo que consume el `[actions]` del sticky-header (sin los callbacks). */
  readonly buttons = computed<StickyHeaderActionButton[]>(() =>
    this._actions().map(({ run: _run, ...button }) => button),
  );

  set(actions: ModuleShellAction[]): void {
    this._actions.set(actions);
  }

  /**
   * Reemplaza una accion ya publicada conservando su posicion. Sirve para
   * mover un boton a `loading` sin volver a declarar toda la barra.
   */
  patch(id: string, patch: Partial<ModuleShellAction>): void {
    this._actions.update((list) =>
      list.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    );
  }

  clear(): void {
    this._actions.set([]);
  }

  /** Invocado por el shell cuando el sticky-header emite `actionClicked`. */
  run(id: string): void {
    this._actions().find((a) => a.id === id)?.run();
  }
}
