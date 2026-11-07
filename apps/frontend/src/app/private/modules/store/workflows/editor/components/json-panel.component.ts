import { Component, computed, effect, inject, model, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonComponent, ModalComponent, ToastService } from '../../../../../../shared/components/index';
import { WorkflowDefinitionV1 } from '../../../../../../shared/workflows/contract/workflow-contract';
import { validateWorkflowDefinition } from '../../../../../../shared/workflows/contract/workflow-validator';
import { WorkflowEditorStore } from '../workflow-editor.store';

const BLOCKING = new Set(['SHAPE_INVALID', 'SCHEMA_MISMATCH']);

/** Advanced JSON panel: edit the whole draft as text; applied after a structural pass. */
@Component({
  selector: 'app-json-panel',
  standalone: true,
  imports: [FormsModule, ButtonComponent, ModalComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      title="JSON avanzado"
      subtitle="Edita la definición completa. Los cambios se aplican al borrador al pulsar Aplicar."
      size="xl"
    >
      <div class="flex flex-col gap-2">
        <label class="text-xs font-semibold text-text-primary" for="wf-json">Definición del flujo (JSON)</label>
        <textarea
          id="wf-json"
          class="h-96 w-full rounded-xl border border-border bg-surface p-3 font-mono text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          spellcheck="false"
          [ngModel]="text()"
          (ngModelChange)="text.set($event); error.set(null)"
        ></textarea>
        @if (error(); as message) {
          <p class="text-xs text-error" role="alert" data-testid="json-error">{{ message }}</p>
        }
      </div>
      <div slot="footer" class="flex w-full justify-end gap-2">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cancelar</app-button>
        <app-button variant="primary" [disabled]="!canApply()" (clicked)="apply()">Aplicar</app-button>
      </div>
    </app-modal>
  `,
})
export class JsonPanelComponent {
  private readonly store = inject(WorkflowEditorStore);
  private readonly toast = inject(ToastService);

  readonly isOpen = model<boolean>(false);
  readonly text = signal('');
  readonly error = signal<string | null>(null);
  readonly canApply = computed(() => this.text().trim().length > 0 && !this.error());

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.text.set(JSON.stringify(this.store.draft(), null, 2));
          this.error.set(null);
        });
      }
    });
  }

  apply(): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.text());
    } catch (e) {
      this.error.set(`JSON no válido: ${(e as Error).message}`);
      return;
    }
    const result = validateWorkflowDefinition(parsed);
    const blocking = result.errors.filter((i) => BLOCKING.has(i.code));
    if (blocking.length > 0) {
      this.error.set(blocking.map((i) => i.message).join(' '));
      return;
    }
    const current = this.store.draft();
    this.store.replaceDraft({ ...(parsed as WorkflowDefinitionV1), key: current?.key ?? (parsed as WorkflowDefinitionV1).key });
    this.isOpen.set(false);
    this.toast.success(
      result.errors.length > 0
        ? `Definición aplicada con ${result.errors.length} observaciones por corregir`
        : 'Definición aplicada al borrador',
    );
  }
}
