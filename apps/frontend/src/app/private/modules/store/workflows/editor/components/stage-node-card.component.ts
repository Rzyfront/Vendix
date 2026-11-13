import { Component, computed, input } from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/index';
import { WorkflowStageType } from '../../../../../../shared/workflows/contract/workflow-contract';
import { STAGE_TYPE_ICON, STAGE_TYPE_LABEL } from '../workflow-editor.utils';
import { STAGE_TONE } from './canvas/canvas.utils';

/**
 * Visual card of a workflow step, shared by the canvas and the route map so
 * both views draw the same node. Purely presentational: the host positions it
 * and owns pointer, keyboard and selection behaviour.
 */
@Component({
  selector: 'app-stage-node-card',
  standalone: true,
  imports: [IconComponent],
  host: { class: 'block h-full w-full' },
  styles: `
    .node {
      position: relative;
      display: flex;
      height: 100%;
      align-items: center;
      gap: 0.625rem;
      padding: 0 0.75rem 0 0.625rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-xl);
      background: var(--color-surface);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--color-text-primary) 6%, transparent);
      transition: border-color 150ms, box-shadow 150ms;
      overflow: hidden;
    }
    .node::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: currentColor;
      opacity: 0.85;
    }
    .node:hover {
      border-color: color-mix(in srgb, var(--color-primary) 25%, var(--color-border));
      box-shadow: 0 4px 12px color-mix(in srgb, var(--color-text-primary) 8%, transparent);
    }
    .node.is-selected {
      border-color: var(--color-primary);
      box-shadow:
        0 0 0 4px color-mix(in srgb, var(--color-primary) 15%, transparent),
        0 4px 12px color-mix(in srgb, var(--color-text-primary) 8%, transparent);
    }
    .node.is-unreachable {
      border-style: dashed;
      opacity: 0.75;
    }
    .chip {
      display: flex;
      height: 2.25rem;
      width: 2.25rem;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-lg);
    }
    .name {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.875rem;
      font-weight: 600;
      line-height: 1.25rem;
      color: var(--color-text-primary);
    }
    .meta {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.75rem;
      line-height: 1rem;
      color: var(--color-text-secondary);
    }
    .meta-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badge {
      position: absolute;
      top: 0.375rem;
      right: 0.375rem;
      display: flex;
      height: 1.125rem;
      width: 1.125rem;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-pill);
    }
    .badge-start {
      background: color-mix(in srgb, var(--color-primary) 14%, transparent);
      color: var(--color-primary);
    }
    .badge-warn {
      background: color-mix(in srgb, var(--color-warning) 14%, transparent);
      color: var(--color-warning);
    }
  `,
  template: `
    <div
      class="node"
      [class]="tone().text"
      [class.is-selected]="selected()"
      [class.is-unreachable]="unreachable()"
    >
      <span class="chip" [class]="tone().chip" aria-hidden="true">
        <app-icon [name]="icon()" [size]="18" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="name">{{ name() }}</span>
        <span class="meta">
          <span class="meta-text">{{ typeLabel() }}</span>
        </span>
      </span>
      @if (unreachable()) {
        <span class="badge badge-warn" title="Ningún paso llega aquí" aria-label="Inalcanzable">
          <app-icon name="alert-triangle" [size]="11" />
        </span>
      } @else if (start()) {
        <span class="badge badge-start" title="Paso inicial" aria-label="Paso inicial">
          <app-icon name="play" [size]="10" />
        </span>
      }
    </div>
  `,
})
export class StageNodeCardComponent {
  readonly name = input.required<string>();
  readonly type = input.required<WorkflowStageType>();
  readonly start = input(false);
  readonly unreachable = input(false);
  readonly selected = input(false);

  readonly icon = computed(() => STAGE_TYPE_ICON[this.type()]);
  readonly typeLabel = computed(() => STAGE_TYPE_LABEL[this.type()]);
  readonly tone = computed(() => STAGE_TONE[this.type()]);
}
