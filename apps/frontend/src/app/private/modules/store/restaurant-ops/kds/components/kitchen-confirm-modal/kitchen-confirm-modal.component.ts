import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import {
  FireItemExclusion,
  FirePreview,
  FirePreviewComponent,
  FirePreviewItem,
  FireTreeNode,
} from '../../interfaces';

/**
 * Modal de confirmación de envío a cocina — QUI-655.
 *
 * Es el ÚNICO punto obligatorio del flujo: el lugar donde la exclusión se
 * materializa en consumo de inventario. Los tres caminos de captura
 * (exclusión estructurada al pedir, nota de texto libre, o nada) convergen acá, y
 * el modal NO depende de que alguien haya capturado algo antes.
 *
 * Todos los componentes vienen MARCADOS por defecto. Desmarcar excluye del consumo
 * de insumos.
 *
 * Riesgo de UX que el ticket marcaba: un restaurante con volumen envía a cocina
 * decenas de veces por hora y la mayoría de esas veces no hay nada que excluir. Se
 * mitiga con `hasAnyExclusion`: mientras nadie desmarque nada, el botón dice
 * "Enviar sin cambios" y el árbol arranca colapsado. La obligatoriedad del paso
 * queda como se pidió; lo que no cuesta es el tiempo.
 */
@Component({
  selector: 'app-kitchen-confirm-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  templateUrl: './kitchen-confirm-modal.component.html',
  styleUrl: './kitchen-confirm-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KitchenConfirmModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly preview = input<FirePreview | null>(null);
  readonly isLoading = input<boolean>(false);
  readonly isSubmitting = input<boolean>(false);
  /**
   * QUI-655 — exclusiones YA capturadas por quien tomo el pedido, por
   * `order_item_id`. El modal las arranca desmarcadas (y por lo tanto tachadas),
   * asi el cocinero VE "sin papas" en vez de tener que deducirlo de una nota.
   *
   * El cocinero puede quitar mas o volver a incluirlas: la intencion del mesero es
   * el punto de partida, no una orden.
   */
  readonly initialExclusions = input<Map<number, number[]> | null>(null);
  /**
   * Contexto de uso. El mismo componente sirve dos momentos distintos y la copia
   * NO puede ser la misma: en `fire` el mesero decide que enviar; en `cook` el
   * cocinero VERIFICA lo que va a preparar. Decirle "enviar a cocina" a alguien
   * que ya esta en la cocina lo desorienta.
   */
  readonly mode = input<'fire' | 'cook'>('fire');

  readonly title = computed(() =>
    this.mode() === 'cook'
      ? 'Verificar ticket para cocinar'
      : 'Confirmar envío a cocina',
  );

  readonly hintText = computed(() =>
    this.mode() === 'cook'
      ? 'Verifica los ingredientes de cada plato. Lo que quitó quien tomó el pedido ya viene desmarcado; puedes quitar más antes de empezar.'
      : 'Todos los ingredientes vienen marcados. Desmarca lo que no se va a usar: eso evita su descuento del inventario.',
  );

  readonly confirmLabel = computed(() => {
    if (this.mode() === 'cook') {
      return this.hasAnyExclusion() ? 'Confirmar y cocinar' : 'Cocinar sin cambios';
    }
    return this.hasAnyExclusion() ? 'Confirmar y enviar' : 'Enviar sin cambios';
  });

  readonly confirmed = output<FireItemExclusion[]>();
  readonly cancelled = output<void>();

  /**
   * Componentes DESMARCADOS, por item. Se guarda lo excluido y no lo incluido
   * porque el default es "todo marcado": un Set vacío significa receta completa, y
   * así el estado inicial no depende de haber recorrido el árbol.
   */
  private readonly excluded = signal<Map<number, Set<number>>>(new Map());

  /** Nodos de sub-receta colapsados, por `key`. */
  private readonly collapsed = signal<Set<string>>(new Set());

  /**
   * QUI-655 — a cuántas unidades aplica la exclusión, por item. Solo se pregunta
   * cuando la línea tiene `quantity > 1`: con una sola unidad la pregunta no tiene
   * respuestas distintas.
   *
   * Default = toda la línea, porque es lo que el operador espera si no toca nada.
   */
  private readonly unitsByItem = signal<Map<number, number>>(new Map());

  constructor() {
    // Reset al reabrir: sin esto las exclusiones del envío anterior se filtran al
    // siguiente y se excluye un insumo que nadie desmarcó en ESTE envío.
    effect(() => {
      if (this.isOpen()) {
        // Se siembra con lo capturado al pedir. Sin esto el cocinero abriria el
        // modal con TODO marcado y volveria a descontar las papas que el cliente
        // pidio sin papas.
        const seed = this.initialExclusions();
        const next = new Map<number, Set<number>>();
        if (seed) {
          for (const [itemId, ids] of seed) {
            if (ids.length > 0) next.set(itemId, new Set(ids));
          }
        }
        this.excluded.set(next);
        this.collapsed.set(new Set());
        this.unitsByItem.set(new Map());
      }
    });
  }

  readonly items = computed<FirePreviewItem[]>(
    () => this.preview()?.items ?? [],
  );

  readonly hasItems = computed(() => this.items().length > 0);

  /** ¿Alguien desmarcó algo? Decide el texto del botón y el aviso. */
  readonly hasAnyExclusion = computed(() => {
    for (const set of this.excluded().values()) {
      if (set.size > 0) return true;
    }
    return false;
  });

  readonly excludedCount = computed(() => {
    let total = 0;
    for (const set of this.excluded().values()) total += set.size;
    return total;
  });

  /**
   * Árbol por item, reconstruido desde `path_recipe_ids`.
   *
   * Mostrar solo las hojas obligaría al cocinero a desmarcar tres cosas para decir
   * "sin salsa" — y a saber de memoria qué hojas venían de la salsa. Los nodos de
   * sub-receta son agrupadores reales, no adorno.
   */
  readonly treesByItem = computed<Map<number, FireTreeNode[]>>(() => {
    const out = new Map<number, FireTreeNode[]>();
    for (const item of this.items()) {
      out.set(item.order_item_id, this.buildTree(item.components));
    }
    return out;
  });

  treeFor(itemId: number): FireTreeNode[] {
    return this.treesByItem().get(itemId) ?? [];
  }

  isExcluded(itemId: number, componentId: number): boolean {
    return this.excluded().get(itemId)?.has(componentId) === true;
  }

  /** Un nodo está marcado cuando NINGUNO de sus componentes está excluido. */
  isNodeChecked(itemId: number, node: FireTreeNode): boolean {
    const set = this.excluded().get(itemId);
    if (!set || set.size === 0) return true;
    return !node.componentIds.some((id) => set.has(id));
  }

  /**
   * Parcial: algunos componentes del subárbol excluidos y otros no. Se distingue
   * de "marcado" y de "desmarcado" porque un agrupador a medias tiene que verse
   * distinto: si no, el cocinero cree que la sub-receta entera está dentro.
   */
  isNodePartial(itemId: number, node: FireTreeNode): boolean {
    const set = this.excluded().get(itemId);
    if (!set || set.size === 0) return false;
    const excludedInNode = node.componentIds.filter((id) => set.has(id)).length;
    return excludedInNode > 0 && excludedInNode < node.componentIds.length;
  }

  isCollapsed(key: string): boolean {
    return this.collapsed().has(key);
  }

  toggleCollapse(key: string): void {
    this.collapsed.update((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /**
   * Alterna un nodo COMPLETO. Desmarcar un agrupador de sub-receta desmarca todo su
   * subárbol — es el caso "sin salsa criolla" — y desmarcar una hoja sigue
   * disponible para el caso fino.
   */
  toggleNode(itemId: number, node: FireTreeNode): void {
    const checked = this.isNodeChecked(itemId, node);
    this.excluded.update((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(itemId) ?? []);
      if (checked) {
        // Estaba entero: excluir todo su subárbol.
        for (const id of node.componentIds) set.add(id);
      } else {
        // Estaba desmarcado o parcial: volver a incluir todo el subárbol. Que un
        // parcial vuelva a "todo dentro" es deliberado — es un solo clic para
        // deshacer, en vez de tener que reconstruir a mano lo que se desmarcó.
        for (const id of node.componentIds) set.delete(id);
      }
      if (set.size === 0) next.delete(itemId);
      else next.set(itemId, set);
      return next;
    });
  }

  /** Cuántos componentes están excluidos en ESTE item. Gatea el selector de unidades. */
  excludedCountFor(itemId: number): number {
    return this.excluded().get(itemId)?.size ?? 0;
  }

  /** Unidades a las que aplica la exclusión de este item. Default: todas. */
  unitsFor(item: FirePreviewItem): number {
    return this.unitsByItem().get(item.order_item_id) ?? item.quantity;
  }

  setUnitsFor(item: FirePreviewItem, units: number): void {
    const clamped = Math.max(1, Math.min(item.quantity, Math.floor(units)));
    this.unitsByItem.update((prev) => {
      const next = new Map(prev);
      next.set(item.order_item_id, clamped);
      return next;
    });
  }

  /** Rango de unidades para el selector: 1..quantity. */
  unitOptions(item: FirePreviewItem): number[] {
    return Array.from({ length: item.quantity }, (_, i) => i + 1);
  }

  onConfirm(): void {
    const payload: FireItemExclusion[] = [];
    for (const [orderItemId, set] of this.excluded()) {
      if (set.size > 0) {
        const item = this.items().find((i) => i.order_item_id === orderItemId);
        const units = item ? this.unitsFor(item) : undefined;
        payload.push({
          order_item_id: orderItemId,
          component_product_ids: [...set],
          // Se manda solo cuando es PARCIAL: mandar `applies_to_units === quantity`
          // haria que el backend evalue una particion que no va a ocurrir.
          ...(item && units != null && units < item.quantity && {
            applies_to_units: units,
          }),
        });
      }
    }
    // Se emite el arreglo vacío cuando no hay exclusiones: el backend lo trata
    // como "todos los componentes marcados" y no hay que inventar un caso aparte.
    this.confirmed.emit(payload);
  }

  onCancel(): void {
    // Cancelar no consume inventario ni crea tickets: el modal se abre ANTES de
    // cualquier escritura.
    this.cancelled.emit();
  }

  trackNode(_i: number, node: FireTreeNode): string {
    return node.key;
  }

  trackItem(_i: number, item: FirePreviewItem): number {
    return item.order_item_id;
  }

  /**
   * Reconstruye el árbol desde las rutas planas que devuelve `explodeBom`.
   *
   * `path_recipe_ids` es root-first, así que la ruta de cada línea es el camino de
   * agrupadores bajo el cual cuelga. La receta raíz (primer elemento) se omite: es
   * el plato mismo y ya es el encabezado del bloque, así que mostrarla añadiría un
   * nivel que no informa nada.
   */
  private buildTree(components: FirePreviewComponent[]): FireTreeNode[] {
    const roots: FireTreeNode[] = [];
    const byKey = new Map<string, FireTreeNode>();

    for (const comp of components) {
      // Se salta el primer id (la receta del plato).
      const subPath = (comp.path_recipe_ids ?? []).slice(1);
      let siblings = roots;
      let parent: FireTreeNode | null = null;

      for (const recipeId of subPath) {
        const key = `recipe:${recipeId}`;
        let node = byKey.get(key);
        if (!node) {
          node = {
            key,
            kind: 'recipe',
            // El nombre de la sub-receta no viene en la línea del BOM; se etiqueta
            // por su id hasta que el preview lo exponga. Agrupar ya es la mitad
            // del valor: son 1 clic en vez de N.
            label: `Sub-receta #${recipeId}`,
            children: [],
            componentIds: [],
          };
          byKey.set(key, node);
          siblings.push(node);
        }
        parent = node;
        siblings = node.children;
      }

      const leaf: FireTreeNode = {
        key: `leaf:${comp.component_product_id}`,
        kind: 'leaf',
        label: comp.name,
        component: comp,
        children: [],
        componentIds: [comp.component_product_id],
      };
      siblings.push(leaf);

      // Propagar el id hacia arriba para que desmarcar un agrupador alcance todo
      // su subárbol sin recorrerlo en el momento del clic.
      let walker: FireTreeNode | null = parent;
      const chain: FireTreeNode[] = [];
      for (const recipeId of subPath) {
        const n = byKey.get(`recipe:${recipeId}`);
        if (n) chain.push(n);
      }
      for (const n of chain) n.componentIds.push(comp.component_product_id);
      void walker;
    }

    return roots;
  }
}
