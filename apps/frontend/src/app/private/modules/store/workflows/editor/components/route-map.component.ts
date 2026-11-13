import { Component, computed, inject } from '@angular/core';
import { WorkflowEditorStore } from '../workflow-editor.store';
import { MapNode, NODE_H, NODE_W, STAGE_TYPE_LABEL, computeLayout } from '../workflow-editor.utils';
import { WORKFLOW_BOARD_STYLES } from './canvas/workflow-board.styles';
import { StageNodeCardComponent } from './stage-node-card.component';

/**
 * Read-only route map: SVG laid out by BFS levels from the start stage.
 * `role="img"` with a label plus a visually hidden textual list of the edges;
 * keyboard selection happens in the stage list. Clicking a node selects it.
 */
@Component({
  selector: 'app-route-map',
  standalone: true,
  imports: [StageNodeCardComponent],
  styles: [WORKFLOW_BOARD_STYLES],
  template: `
    <div class="wf-board overflow-auto rounded-2xl border border-border" data-testid="route-map">
      <svg
        role="img"
        [attr.aria-label]="ariaLabel()"
        [attr.viewBox]="'0 0 ' + layout().width + ' ' + layout().height"
        [attr.width]="layout().width"
        [attr.height]="layout().height"
        class="block max-w-none"
      >
        <defs>
          <marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 1 1 L 9 5 L 1 9 z" stroke-linejoin="round" class="wf-arrow" />
          </marker>
        </defs>

        @for (edge of layout().edges; track edge.id) {
          <path
            [attr.d]="edge.path"
            fill="none"
            stroke-linecap="round"
            class="wf-edge"
            stroke-width="1.75"
            [attr.stroke-dasharray]="edge.conditional ? '5 5' : null"
            marker-end="url(#wf-arrow)"
          />
          <text
            [attr.x]="edge.labelX"
            [attr.y]="edge.labelY"
            text-anchor="middle"
            paint-order="stroke"
            stroke-width="6"
            stroke-linejoin="round"
            class="wf-edge-label"
          >{{ short(edge.label, 34) }}</text>
        }

        @for (node of layout().nodes; track node.key) {
          <!-- Same HTML card as the canvas; a few px of room so the selection halo is not clipped. -->
          <foreignObject
            [attr.x]="node.x - 6"
            [attr.y]="node.y - 6"
            [attr.width]="nodeW + 12"
            [attr.height]="nodeH + 12"
            class="cursor-pointer overflow-visible"
            (click)="store.selectStage(node.key)"
          >
            <div class="h-full w-full p-1.5">
              <app-stage-node-card
                [name]="node.name"
                [type]="node.type"
                [start]="!!node.start"
                [unreachable]="!!node.unreachable"
                [selected]="node.key === store.selectedKey()"
              />
            </div>
          </foreignObject>
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
}
