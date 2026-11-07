import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  ButtonComponent,
  DialogService,
  IconComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import {
  WORKFLOW_LIMITS,
  WorkflowConditionGroup,
  WorkflowStageDef,
  WorkflowStageType,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../workflow-editor.store';
import { STAGE_TYPE_ICON, STAGE_TYPE_LABEL, outcomeText, removeAt } from '../../workflow-editor.utils';
import { ConditionBuilderComponent } from '../condition-builder.component';
import { CanvasPaletteComponent, PALETTE_DRAG_TYPE } from './canvas-palette.component';
import {
  CANVAS_NODE_H,
  CANVAS_NODE_W,
  CanvasNode,
  CanvasPoint,
  STAGE_PALETTE,
  STAGE_TONE,
  clampPoint,
  computeCanvas,
  connectStages,
  setTransitionWhen,
  dropPosition,
  edgeId,
  missingPositions,
  nextFreePosition,
  nodeAt,
  outcomesOf,
} from './canvas.utils';

/** Pointer travel (px) under which a press on an output port counts as a tap. */
const TAP_DISTANCE = 6;
/** Pointer travel (px) before a press on a node becomes a drag. */
const DRAG_DISTANCE = 4;
const KEY_STEP = 16;
const POPOVER_W = 240;

interface DragState {
  key: string;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  moved: boolean;
}

interface PendingConnection {
  from: string;
  to: string;
  toName: string;
  outcomes: readonly string[];
  x: number;
  y: number;
}

/**
 * Editable canvas (P5.1): SVG edges plus absolutely positioned step cards.
 * Everything is pointer-event based so it works with mouse, pen and touch; the
 * transitions tab and the stage list stay as the keyboard alternative.
 */
@Component({
  selector: 'app-workflow-canvas',
  standalone: true,
  imports: [ButtonComponent, IconComponent, CanvasPaletteComponent, ConditionBuilderComponent],
  template: `
    <div class="flex flex-col gap-3" data-testid="workflow-canvas" (keydown.escape)="cancel()">
      <app-canvas-palette [disabled]="atLimit()" (add)="addAt($event)" />

      @if (armedName(); as name) {
        <div class="flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 p-2 text-xs text-text-primary" role="status" data-testid="canvas-armed">
          Toca el paso de destino para conectarlo desde «{{ name }}».
          <app-button variant="ghost" size="xsm" (clicked)="cancel()">Cancelar</app-button>
        </div>
      }

      @if (store.selectedStage(); as stage) {
        <div class="flex flex-wrap items-center gap-2" data-testid="canvas-selection">
          <span class="min-w-0 truncate text-xs font-semibold text-text-primary">Paso seleccionado: {{ stage.name }}</span>
          @if (!stage.start) {
            <app-button variant="outline" size="sm" (clicked)="store.setStart(stage.key)">
              <app-icon name="flag" [size]="14" slot="icon" />
              Marcar como inicio
            </app-button>
          }
          <app-button
            variant="outline-danger"
            size="sm"
            [disabled]="stage.start === true"
            [title]="stage.start ? 'Marca otro paso como inicio antes de eliminar este.' : ''"
            (clicked)="removeStage(stage)"
          >
            <app-icon name="trash-2" [size]="14" slot="icon" />
            Eliminar paso
          </app-button>
        </div>
      }

      <div
        class="overflow-auto rounded-xl border border-border bg-surface"
        style="max-height: 70vh"
        (dragover)="onDragOver($event)"
        (drop)="onDrop($event)"
      >
        <div
          #surface
          class="relative"
          [style.width.px]="model().width"
          [style.height.px]="model().height"
          data-testid="canvas-surface"
          (click)="onSurfaceClick($event)"
        >
          <svg
            class="pointer-events-none absolute left-0 top-0"
            role="img"
            [attr.aria-label]="ariaLabel()"
            [attr.width]="model().width"
            [attr.height]="model().height"
          >
            <defs>
              <marker id="wf-canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" class="fill-text-secondary" />
              </marker>
            </defs>

            @for (edge of model().edges; track edge.id) {
              <g class="cursor-pointer" (click)="selectEdge(edge.id, edge.from, $event)">
                <path [attr.d]="edge.path" fill="none" stroke="transparent" stroke-width="16" pointer-events="stroke" />
                <path
                  [attr.d]="edge.path"
                  fill="none"
                  [class]="edge.id === selectedEdge() ? 'stroke-primary' : 'stroke-text-secondary'"
                  [attr.stroke-width]="edge.id === selectedEdge() ? 2.5 : 1.5"
                  [attr.stroke-dasharray]="edge.conditional ? '6 4' : null"
                  marker-end="url(#wf-canvas-arrow)"
                />
                <text
                  [attr.x]="edge.labelX"
                  [attr.y]="edge.labelY"
                  text-anchor="middle"
                  paint-order="stroke"
                  stroke-width="4"
                  pointer-events="all"
                  class="fill-text-primary stroke-surface text-xs"
                >{{ short(edge.label, 38) }}</text>
              </g>
            }

            @if (connectingLine(); as line) {
              <path [attr.d]="line" fill="none" class="stroke-primary" stroke-width="2" stroke-dasharray="5 4" />
            }
          </svg>

          @for (node of model().nodes; track node.key) {
            <div
              class="absolute touch-none select-none rounded-xl border border-l-4 bg-surface shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              [class]="nodeClass(node)"
              [style.left.px]="node.x"
              [style.top.px]="node.y"
              [style.width.px]="nodeW"
              [style.height.px]="nodeH"
              role="button"
              tabindex="0"
              [attr.aria-label]="nodeLabel(node)"
              [attr.aria-pressed]="node.key === store.selectedKey()"
              [attr.data-testid]="'canvas-node-' + node.key"
              (pointerdown)="onNodeDown($event, node)"
              (pointermove)="onNodeMove($event)"
              (pointerup)="onNodeUp()"
              (pointercancel)="onNodeUp()"
              (keydown)="onNodeKey($event, node)"
            >
              <span class="pointer-events-none absolute -left-[7px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-border bg-surface" aria-hidden="true"></span>
              <div class="pointer-events-none flex h-full items-center gap-2 px-2.5">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" [class]="tone(node.type).chip">
                  <app-icon [name]="icon(node.type)" [size]="16" />
                </span>
                <span class="min-w-0">
                  <span class="block truncate text-sm font-semibold text-text-primary">{{ node.name }}</span>
                  <span class="block truncate text-xs text-text-secondary">{{ caption(node) }}</span>
                </span>
              </div>
              @if (hasOutput(node)) {
                <button
                  type="button"
                  class="absolute -right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-crosshair touch-none items-center justify-center rounded-full border border-primary bg-surface text-primary shadow-sm transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  [attr.aria-label]="'Conectar «' + node.name + '» con otro paso: arrastra hasta el destino o toca y luego toca el destino'"
                  [attr.data-testid]="'canvas-port-' + node.key"
                  (pointerdown)="onPortDown($event, node)"
                  (pointermove)="onPortMove($event)"
                  (pointerup)="onPortUp($event, node)"
                  (pointercancel)="onPortCancel()"
                >
                  <app-icon name="plus" [size]="12" />
                </button>
              }
            </div>
          }

          @if (pending(); as choice) {
            <div
              class="absolute z-20 flex flex-col gap-1 rounded-xl border border-border bg-surface p-2 shadow-lg"
              [style.left.px]="popoverLeft(choice)"
              [style.top.px]="choice.y"
              [style.width.px]="popoverW"
              role="dialog"
              aria-label="Elegir resultado de la conexión"
              data-testid="canvas-outcome-picker"
            >
              <p class="px-1 text-xs font-semibold text-text-primary">¿Con qué resultado pasa a «{{ short(choice.toName, 22) }}»?</p>
              @for (outcome of choice.outcomes; track outcome) {
                <button
                  type="button"
                  class="h-9 rounded-lg px-2 text-left text-sm text-text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  (click)="choose(outcome)"
                >{{ outcomeLabel(outcome) }}</button>
              }
              <button
                type="button"
                class="h-9 rounded-lg px-2 text-left text-xs text-text-secondary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                (click)="cancel()"
              >Cancelar</button>
            </div>
          }
        </div>
      </div>

      @if (edgeDetail(); as detail) {
        <section class="flex flex-col gap-3 rounded-xl border border-primary/25 bg-surface p-3" aria-label="Conexión seleccionada" data-testid="canvas-edge-panel">
          <div class="flex flex-wrap items-center gap-2">
            <p class="min-w-0 flex-1 text-sm font-semibold text-text-primary">
              {{ detail.from.name }} → {{ detail.toName }} · {{ outcomeLabel(detail.transition.on) }}
            </p>
            <app-button variant="outline-danger" size="sm" (clicked)="removeEdge(detail.from, detail.index)">
              <app-icon name="trash-2" [size]="14" slot="icon" />
              Quitar conexión
            </app-button>
          </div>
          <app-condition-builder
            [value]="detail.transition.when"
            [fields]="fields()"
            addLabel="Solo si se cumple una condición…"
            (valueChange)="setWhen(detail.from, detail.index, $event)"
          />
        </section>
      } @else {
        <p class="text-xs text-text-secondary">
          Conecta arrastrando desde el punto de la derecha de un paso hasta otro. Toca una flecha para ponerle una condición o quitarla.
        </p>
      }

      <ul class="sr-only" aria-label="Pasos y conexiones del flujo en texto">
        @for (node of model().nodes; track node.key) {
          <li>{{ nodeLabel(node) }}</li>
        }
        @for (edge of model().edges; track edge.id) {
          <li>{{ edge.text }}</li>
        }
      </ul>
    </div>
  `,
})
export class WorkflowCanvasComponent {
  protected readonly store = inject(WorkflowEditorStore);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');

  readonly nodeW = CANVAS_NODE_W;
  readonly nodeH = CANVAS_NODE_H;
  readonly popoverW = POPOVER_W;

  private readonly dragPos = signal<(CanvasPoint & { key: string }) | null>(null);
  private drag: DragState | null = null;
  private portOrigin: CanvasPoint | null = null;
  readonly connecting = signal<{ from: string; x: number; y: number } | null>(null);
  readonly armed = signal<string | null>(null);
  readonly pending = signal<PendingConnection | null>(null);
  readonly selectedEdge = signal<string | null>(null);

  readonly fields = computed(() => this.store.draft()?.fields ?? []);
  readonly atLimit = computed(() => (this.store.draft()?.stages.length ?? 0) >= WORKFLOW_LIMITS.maxStages);
  readonly model = computed(() => {
    const draft = this.store.draft();
    return draft ? computeCanvas(draft, this.dragPos()) : { nodes: [], edges: [], width: 0, height: 0 };
  });
  readonly ariaLabel = computed(
    () => `Lienzo del flujo: ${this.model().nodes.length} pasos y ${this.model().edges.length} conexiones. La lista en texto sigue debajo.`,
  );
  readonly armedName = computed(() => {
    const key = this.armed();
    return key ? (this.store.draft()?.stages.find((s) => s.key === key)?.name ?? null) : null;
  });
  readonly connectingLine = computed(() => {
    const c = this.connecting();
    const from = c ? this.model().nodes.find((n) => n.key === c.from) : undefined;
    if (!c || !from) return null;
    return `M ${from.x + CANVAS_NODE_W} ${from.y + CANVAS_NODE_H / 2} L ${c.x} ${c.y}`;
  });
  readonly edgeDetail = computed(() => {
    const id = this.selectedEdge();
    const edge = id ? this.model().edges.find((e) => e.id === id) : undefined;
    if (!edge) return null;
    const stages = this.store.draft()?.stages ?? [];
    const from = stages.find((s) => s.key === edge.from);
    const transition = from?.transitions?.[edge.index];
    if (!from || !transition) return null;
    const toName = stages.find((s) => s.key === edge.to)?.name ?? edge.to;
    return { from, index: edge.index, transition, toName };
  });

  // ─── Presentation helpers ───────────────────────────────────────────

  icon(type: WorkflowStageType): string {
    return STAGE_TYPE_ICON[type];
  }

  tone(type: WorkflowStageType): { chip: string; bar: string } {
    return STAGE_TONE[type];
  }

  outcomeLabel(outcome: string): string {
    return outcomeText(outcome);
  }

  short(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  caption(node: CanvasNode): string {
    const parts: string[] = [STAGE_TYPE_LABEL[node.type]];
    if (node.start) parts.push('Inicio');
    if (node.unreachable) parts.push('Inalcanzable');
    return parts.join(' · ');
  }

  nodeLabel(node: CanvasNode): string {
    return `${node.name} (${STAGE_TYPE_LABEL[node.type]})${node.start ? ', paso inicial' : ''}${node.unreachable ? ', inalcanzable' : ''}`;
  }

  nodeClass(node: CanvasNode): string {
    const selected = node.key === this.store.selectedKey();
    return [
      STAGE_TONE[node.type].bar,
      selected ? 'border-primary ring-2 ring-primary/20' : 'border-border',
      node.unreachable ? 'border-dashed' : '',
      this.dragPos()?.key === node.key ? 'cursor-grabbing shadow-lg' : 'cursor-grab',
    ].join(' ');
  }

  hasOutput(node: CanvasNode): boolean {
    return outcomesOf(node.type).length > 0;
  }

  popoverLeft(choice: PendingConnection): number {
    return Math.max(0, Math.min(choice.x, this.model().width - POPOVER_W - 8));
  }

  // ─── Adding steps ───────────────────────────────────────────────────

  /** Adds a step: at `point` when dropped, else at the next free grid slot. */
  addAt(type: WorkflowStageType, point?: CanvasPoint): void {
    if (this.atLimit()) {
      this.toast.error(`Un flujo admite hasta ${WORKFLOW_LIMITS.maxStages} etapas.`);
      return;
    }
    const model = this.model();
    const frozen = missingPositions(model);
    const position = clampPoint(point ?? nextFreePosition(model.nodes));
    const key = this.store.addStage(type);
    if (!key) return;
    this.store.setStagePositions({ ...frozen, [key]: position });
    this.selectedEdge.set(null);
    // A tapped step lands in the next free slot, which may be scrolled out of
    // a narrow canvas: bring it into view once it is rendered.
    if (!point) this.revealNode(key);
  }

  private revealNode(key: string): void {
    afterNextRender(
      () => {
        this.surface()
          .nativeElement.querySelector<HTMLElement>(`[data-testid="canvas-node-${key}"]`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      },
      { injector: this.injector },
    );
  }

  onDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes(PALETTE_DRAG_TYPE)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  onDrop(event: DragEvent): void {
    const raw = event.dataTransfer?.getData(PALETTE_DRAG_TYPE);
    const entry = STAGE_PALETTE.find((e) => e.type === raw);
    if (!entry) return;
    event.preventDefault();
    this.addAt(entry.type, dropPosition(this.local(event)));
  }

  // ─── Moving steps ───────────────────────────────────────────────────

  private local(event: { clientX: number; clientY: number }): CanvasPoint {
    const rect = this.surface().nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  onNodeDown(event: PointerEvent, node: CanvasNode): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = this.local(event);
    const from = this.armed();
    this.pending.set(null);
    this.selectedEdge.set(null);
    if (from) {
      this.armed.set(null);
      this.startConnection(from, node.key, point);
      return;
    }
    this.store.selectStage(node.key);
    this.drag = { key: node.key, offsetX: point.x - node.x, offsetY: point.y - node.y, startX: point.x, startY: point.y, moved: false };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  onNodeMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const point = this.local(event);
    if (!drag.moved && Math.hypot(point.x - drag.startX, point.y - drag.startY) < DRAG_DISTANCE) return;
    drag.moved = true;
    this.dragPos.set({ key: drag.key, ...clampPoint({ x: point.x - drag.offsetX, y: point.y - drag.offsetY }) });
  }

  onNodeUp(): void {
    const drag = this.drag;
    const position = this.dragPos();
    this.drag = null;
    this.dragPos.set(null);
    if (drag?.moved && position) this.persistPosition(position.key, { x: position.x, y: position.y });
  }

  onNodeKey(event: KeyboardEvent, node: CanvasNode): void {
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const delta: Record<string, CanvasPoint> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const move = delta[event.key];
    if (move) {
      event.preventDefault();
      this.store.selectStage(node.key);
      this.persistPosition(node.key, clampPoint({ x: node.x + move.x, y: node.y + move.y }));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.store.selectStage(node.key);
    }
  }

  private persistPosition(key: string, position: CanvasPoint): void {
    this.store.setStagePositions({ ...missingPositions(this.model()), [key]: position });
  }

  // ─── Connecting steps ───────────────────────────────────────────────

  onPortDown(event: PointerEvent, node: CanvasNode): void {
    event.stopPropagation();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = this.local(event);
    this.portOrigin = point;
    this.pending.set(null);
    this.armed.set(null);
    this.selectedEdge.set(null);
    this.connecting.set({ from: node.key, ...point });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  onPortMove(event: PointerEvent): void {
    const current = this.connecting();
    if (current) this.connecting.set({ from: current.from, ...this.local(event) });
  }

  onPortUp(event: PointerEvent, node: CanvasNode): void {
    event.stopPropagation();
    const current = this.connecting();
    const origin = this.portOrigin;
    this.connecting.set(null);
    this.portOrigin = null;
    if (!current || !origin) return;
    const point = this.local(event);
    if (Math.hypot(point.x - origin.x, point.y - origin.y) < TAP_DISTANCE) {
      // A tap arms the connection: the next step touched becomes the destination.
      this.store.selectStage(node.key);
      this.armed.set(node.key);
      return;
    }
    const target = nodeAt(this.model().nodes, point);
    if (target) this.startConnection(current.from, target.key, point);
  }

  onPortCancel(): void {
    this.connecting.set(null);
    this.portOrigin = null;
  }

  private startConnection(from: string, to: string, at: CanvasPoint): void {
    const stages = this.store.draft()?.stages ?? [];
    const source = stages.find((s) => s.key === from);
    const target = stages.find((s) => s.key === to);
    if (!source || !target) return;
    const outcomes = outcomesOf(source.type);
    if (outcomes.length === 1) {
      this.connect(source, outcomes[0], to);
    } else if (outcomes.length > 1) {
      this.pending.set({ from, to, toName: target.name, outcomes, x: at.x, y: at.y });
    }
  }

  choose(outcome: string): void {
    const choice = this.pending();
    const source = this.store.draft()?.stages.find((s) => s.key === choice?.from);
    this.pending.set(null);
    if (choice && source) this.connect(source, outcome, choice.to);
  }

  private connect(source: WorkflowStageDef, outcome: string, to: string): void {
    const result = connectStages(source, outcome, to);
    if (!result) {
      this.toast.error('Esa conexión ya existe o el paso llegó al límite de transiciones.');
      return;
    }
    this.store.updateStage(source.key, (s) => ({ ...s, transitions: result.transitions }));
    this.store.selectStage(source.key);
    this.selectedEdge.set(edgeId(source.key, result.index));
  }

  // ─── Selecting and deleting ─────────────────────────────────────────

  selectEdge(id: string, from: string, event: Event): void {
    event.stopPropagation();
    this.armed.set(null);
    this.pending.set(null);
    this.selectedEdge.set(id);
    this.store.selectStage(from);
  }

  onSurfaceClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.selectedEdge.set(null);
      this.pending.set(null);
    }
  }

  cancel(): void {
    this.armed.set(null);
    this.pending.set(null);
    this.selectedEdge.set(null);
  }

  setWhen(stage: WorkflowStageDef, index: number, when: WorkflowConditionGroup | undefined): void {
    const next = setTransitionWhen(stage.transitions ?? [], index, when);
    this.store.updateStage(stage.key, (s) => ({ ...s, transitions: next.transitions }));
    // The conditional branch moves ahead of the default: keep it selected.
    this.selectedEdge.set(edgeId(stage.key, next.index));
  }

  removeEdge(stage: WorkflowStageDef, index: number): void {
    this.store.updateStage(stage.key, (s) => ({ ...s, transitions: removeAt(s.transitions ?? [], index) }));
    this.selectedEdge.set(null);
  }

  async removeStage(stage: WorkflowStageDef): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Eliminar paso',
      message: `¿Eliminar «${stage.name}»? También se quitarán las conexiones que llegan a él.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (confirmed && this.store.deleteStage(stage.key)) this.selectedEdge.set(null);
  }
}
