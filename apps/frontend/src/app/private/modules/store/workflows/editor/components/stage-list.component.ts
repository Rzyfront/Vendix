import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { Component, computed, inject, signal } from '@angular/core';
import {
  BadgeComponent,
  ButtonComponent,
  DialogService,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import {
  WORKFLOW_LIMITS,
  WORKFLOW_STAGE_TYPES,
  WorkflowStageDef,
  WorkflowStageType,
} from '../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../workflow-editor.store';
import { STAGE_TYPE_ICON, STAGE_TYPE_LABEL } from '../workflow-editor.utils';

/** Left panel: ordered stages with drag-and-drop and keyboard/menu alternatives. */
@Component({
  selector: 'app-stage-list',
  standalone: true,
  imports: [CdkDropList, CdkDrag, CdkDragHandle, BadgeComponent, ButtonComponent, IconComponent],
  template: `
    <section class="flex flex-col gap-3" aria-label="Etapas del flujo">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-bold text-text-primary">Etapas ({{ stages().length }})</h2>
        <app-button variant="primary" size="sm" [disabled]="atLimit()" [ariaPressed]="picking()" (clicked)="picking.set(!picking())">
          <app-icon name="plus" [size]="14" slot="icon" />
          Agregar etapa
        </app-button>
      </div>

      @if (picking()) {
        <div class="grid grid-cols-2 gap-2 rounded-xl border border-primary/25 bg-primary/5 p-2" role="group" aria-label="Tipo de etapa nueva">
          @for (type of types; track type) {
            <button
              type="button"
              class="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-2 text-xs font-semibold text-text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              (click)="add(type)"
            >
              <app-icon [name]="icon(type)" [size]="14" />
              {{ label(type) }}
            </button>
          }
        </div>
      }

      <ul
        cdkDropList
        class="flex flex-col gap-2"
        aria-label="Lista ordenable de etapas. Usa los botones Subir y Bajar para reordenar con el teclado."
        (cdkDropListDropped)="drop($event)"
      >
        @for (stage of stages(); track stage.key; let i = $index) {
          <li cdkDrag [cdkDragData]="stage" class="rounded-xl border bg-surface" [class]="rowClass(stage)">
            <div class="flex items-center gap-1 p-1.5">
              <span cdkDragHandle class="flex h-8 w-6 cursor-grab items-center justify-center text-text-secondary" aria-hidden="true">
                <app-icon name="grip-vertical" [size]="14" />
              </span>
              <button
                type="button"
                class="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                [attr.aria-current]="selectedKey() === stage.key ? 'true' : null"
                (click)="store.selectStage(stage.key)"
              >
                <app-icon [name]="icon(stage.type)" [size]="16" class="shrink-0 text-primary" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-text-primary">{{ stage.name }}</span>
                  <span class="block truncate text-xs text-text-secondary">{{ label(stage.type) }}</span>
                </span>
              </button>
              @if (stage.start) {
                <app-badge variant="primary" size="xsm">Inicio</app-badge>
              }
              @if (errorCount(stage.key) > 0) {
                <app-badge variant="error" size="xsm">
                  <app-icon name="alert-circle" [size]="10" class="mr-0.5 inline" />
                  {{ errorCount(stage.key) }} {{ errorCount(stage.key) === 1 ? 'error' : 'errores' }}
                </app-badge>
              }
            </div>
            @if (selectedKey() === stage.key) {
              <div class="flex flex-wrap items-center gap-1 border-t border-border p-1.5">
                <app-button variant="ghost" size="xsm" [disabled]="i === 0" (clicked)="move(i, i - 1)">
                  <app-icon name="arrow-up" [size]="12" slot="icon" />Mover arriba
                </app-button>
                <app-button variant="ghost" size="xsm" [disabled]="i === stages().length - 1" (clicked)="move(i, i + 1)">
                  <app-icon name="arrow-down" [size]="12" slot="icon" />Mover abajo
                </app-button>
                <app-button variant="ghost" size="xsm" [disabled]="atLimit()" (clicked)="store.duplicateStage(stage.key)">
                  <app-icon name="copy" [size]="12" slot="icon" />Duplicar
                </app-button>
                <app-button variant="outline-danger" size="xsm" (clicked)="remove(stage)">
                  <app-icon name="trash-2" [size]="12" slot="icon" />Eliminar
                </app-button>
              </div>
            }
          </li>
        }
      </ul>
    </section>
  `,
})
export class StageListComponent {
  protected readonly store = inject(WorkflowEditorStore);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);

  readonly types = WORKFLOW_STAGE_TYPES;
  readonly picking = signal(false);
  readonly stages = computed(() => this.store.draft()?.stages ?? []);
  readonly selectedKey = this.store.selectedKey;
  readonly atLimit = computed(() => this.stages().length >= WORKFLOW_LIMITS.maxStages);

  icon(type: WorkflowStageType): string {
    return STAGE_TYPE_ICON[type];
  }
  label(type: WorkflowStageType): string {
    return STAGE_TYPE_LABEL[type];
  }
  errorCount(key: string): number {
    return this.store.issuesByStage().get(key)?.length ?? 0;
  }
  rowClass(stage: WorkflowStageDef): string {
    return this.selectedKey() === stage.key ? 'border-primary/25 ring-2 ring-primary/20' : 'border-border';
  }

  add(type: WorkflowStageType): void {
    this.store.addStage(type);
    this.picking.set(false);
  }

  move(from: number, to: number): void {
    this.store.moveStage(from, to);
  }

  drop(event: CdkDragDrop<unknown>): void {
    this.store.moveStage(event.previousIndex, event.currentIndex);
  }

  async remove(stage: WorkflowStageDef): Promise<void> {
    if (stage.start) {
      this.toast.error('No se puede eliminar la etapa inicial. Marca otra etapa como inicial primero.');
      return;
    }
    const confirmed = await this.dialog.confirm({
      title: 'Eliminar etapa',
      message: `¿Eliminar «${stage.name}»? También se quitarán las transiciones que llegan a ella.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (confirmed) this.store.deleteStage(stage.key);
  }
}
