import { Component, computed, inject } from '@angular/core';
import { WorkflowEditorStore } from '../workflow-editor.store';
import { MapNode, NODE_H, NODE_W, STAGE_TYPE_LABEL, computeLayout } from '../workflow-editor.utils';

/**
 * Read-only route map: SVG laid out by BFS levels from the start stage.
 * `role="img"` with a label plus a visually hidden textual list of the edges;
 * keyboard selection happens in the stage list. Clicking a node selects it.
 */
@Component({
  selector: 'app-route-map',
  standalone: true,
  template: `
    <div class="overflow-auto rounded-xl border border-border bg-surface" data-testid="route-map">
      <svg
        role="img"
        [attr.aria-label]="ariaLabel()"
        [attr.viewBox]="'0 0 ' + layout().width + ' ' + layout().height"
        [attr.width]="layout().width"
        [attr.height]="layout().height"
        class="block max-w-none"
      >
        <defs>
          <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" class="fill-text-secondary" />
          </marker>
        </defs>

        @for (edge of layout().edges; track edge.id) {
          <path
            [attr.d]="edge.path"
            fill="none"
            class="stroke-text-secondary"
            stroke-width="1.5"
            [attr.stroke-dasharray]="edge.conditional ? '6 4' : null"
            marker-end="url(#wf-arrow)"
          />
          <text
            [attr.x]="edge.labelX"
            [attr.y]="edge.labelY"
            text-anchor="middle"
            paint-order="stroke"
            stroke-width="4"
            class="fill-text-primary stroke-surface text-xs"
          >{{ short(edge.label, 34) }}</text>
        }

        @for (node of layout().nodes; track node.key) {
          <g class="cursor-pointer" (click)="store.selectStage(node.key)">
            <rect
              [attr.x]="node.x"
              [attr.y]="node.y"
              [attr.width]="nodeW"
              [attr.height]="nodeH"
              rx="12"
              class="fill-surface"
              [class]="node.key === store.selectedKey() ? 'stroke-primary' : 'stroke-border'"
              [attr.stroke-width]="node.key === store.selectedKey() ? 3 : 1"
              [attr.stroke-dasharray]="node.unreachable ? '5 4' : null"
            />
            <text [attr.x]="node.x + 12" [attr.y]="node.y + 24" class="fill-text-primary text-sm font-semibold">{{ short(node.name, 22) }}</text>
            <text [attr.x]="node.x + 12" [attr.y]="node.y + 44" class="fill-text-secondary text-xs">{{ caption(node) }}</text>
          </g>
        }
      </svg>
    </div>
    <ul class="sr-only" aria-label="Rutas del flujo en texto">
      @for (node of layout().nodes; track node.key) {
        <li>{{ node.name }} ({{ typeLabel(node) }}){{ node.start ? ', etapa inicial' : '' }}{{ node.unreachable ? ', inalcanzable' : '' }}</li>
      }
      @for (edge of layout().edges; track edge.id) {
        <li>{{ edge.text }}</li>
      }
    </ul>
  `,
})
export class RouteMapComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly nodeW = NODE_W;
  readonly nodeH = NODE_H;

  readonly layout = computed(() => {
    const draft = this.store.draft();
    return draft ? computeLayout(draft) : { nodes: [], edges: [], width: 0, height: 0 };
  });

  readonly ariaLabel = computed(
    () => `Mapa de la ruta: ${this.layout().nodes.length} etapas y ${this.layout().edges.length} transiciones. La lista de rutas sigue en texto.`,
  );

  short(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  typeLabel(node: MapNode): string {
    return STAGE_TYPE_LABEL[node.type];
  }

  caption(node: MapNode): string {
    const parts = [STAGE_TYPE_LABEL[node.type]];
    if (node.start) parts.push('Inicio');
    if (node.unreachable) parts.push('Inalcanzable');
    return parts.join(' · ');
  }
}
