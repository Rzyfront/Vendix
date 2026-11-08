import { Component, input, output } from '@angular/core';
import { IconComponent } from '../../../../../../../shared/components/index';
import { WorkflowStageType } from '../../../../../../../shared/workflows/contract/workflow-contract';
import { STAGE_PALETTE, STAGE_TONE } from './canvas.utils';

/** MIME type of a palette item being dragged onto the canvas. */
export const PALETTE_DRAG_TYPE = 'application/x-vendix-stage-type';

/**
 * Palette of every stage type. Items can be dragged onto the canvas (mouse) or
 * clicked/tapped to add the step at the next free spot (touch, keyboard).
 */
@Component({
  selector: 'app-canvas-palette',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="flex flex-col gap-1.5" data-testid="canvas-palette">
      <p class="text-xs text-text-secondary">Arrastra un paso al lienzo, o tócalo para agregarlo.</p>
      <ul class="flex flex-wrap gap-2" aria-label="Tipos de paso">
        @for (entry of entries; track entry.type) {
          <li>
            <button
              type="button"
              draggable="true"
              class="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              [title]="entry.hint"
              [disabled]="disabled()"
              [attr.aria-label]="'Agregar paso: ' + entry.label + '. ' + entry.hint"
              (click)="add.emit(entry.type)"
              (dragstart)="onDragStart($event, entry.type)"
            >
              <span class="flex h-6 w-6 items-center justify-center rounded-lg" [class]="tone(entry.type)">
                <app-icon [name]="entry.icon" [size]="14" />
              </span>
              {{ entry.label }}
            </button>
          </li>
        }
      </ul>
    </div>
  `,
})
export class CanvasPaletteComponent {
  readonly disabled = input(false);
  readonly add = output<WorkflowStageType>();
  readonly entries = STAGE_PALETTE;

  tone(type: WorkflowStageType): string {
    return STAGE_TONE[type].chip;
  }

  onDragStart(event: DragEvent, type: WorkflowStageType): void {
    event.dataTransfer?.setData(PALETTE_DRAG_TYPE, type);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }
}
