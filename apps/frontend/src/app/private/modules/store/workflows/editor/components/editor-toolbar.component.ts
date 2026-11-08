import { Component, computed, inject, output } from '@angular/core';
import { BadgeComponent, ButtonComponent, IconComponent } from '../../../../../../shared/components/index';
import { WorkflowEditorStore } from '../workflow-editor.store';

/** Status chip, save state and the Validar/Simular/Publicar/Exportar/Historial/JSON bar. */
@Component({
  selector: 'app-editor-toolbar',
  standalone: true,
  imports: [BadgeComponent, ButtonComponent, IconComponent],
  template: `
    <div class="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Acciones del editor">
      <app-badge [variant]="statusVariant()" data-testid="status-chip">{{ store.statusText() }}</app-badge>
      @if (errorCount() > 0) {
        <app-badge variant="error" size="sm">
          <app-icon name="alert-circle" [size]="12" class="mr-1 inline" />
          {{ errorCount() }} {{ errorCount() === 1 ? 'problema' : 'problemas' }}
        </app-badge>
      } @else {
        <app-badge variant="success" size="sm">
          <app-icon name="check-circle" [size]="12" class="mr-1 inline" />
          Sin problemas
        </app-badge>
      }
      <span class="text-xs text-text-secondary" aria-live="polite" data-testid="save-state">{{ saveText() }}</span>
      <span class="flex-1"></span>
      <app-button variant="outline" size="sm" (clicked)="validate.emit()">
        <app-icon name="shield-check" [size]="14" slot="icon" />Validar
      </app-button>
      <app-button variant="outline" size="sm" (clicked)="simulate.emit()">
        <app-icon name="play" [size]="14" slot="icon" />Simular
      </app-button>
      <app-button variant="outline" size="sm" (clicked)="exportJson.emit()">
        <app-icon name="download" [size]="14" slot="icon" />Exportar JSON
      </app-button>
      <app-button variant="outline" size="sm" (clicked)="history.emit()">
        <app-icon name="history" [size]="14" slot="icon" />Historial
      </app-button>
      <app-button variant="outline" size="sm" (clicked)="permissions.emit()">
        <app-icon name="lock" [size]="14" slot="icon" />Permisos
      </app-button>
      <app-button variant="outline" size="sm" (clicked)="json.emit()">
        <app-icon name="code" [size]="14" slot="icon" />JSON avanzado
      </app-button>
      <app-button variant="primary" size="sm" (clicked)="publish.emit()">
        <app-icon name="send" [size]="14" slot="icon" />Publicar
      </app-button>
    </div>
  `,
})
export class EditorToolbarComponent {
  protected readonly store = inject(WorkflowEditorStore);

  readonly validate = output<void>();
  readonly simulate = output<void>();
  readonly publish = output<void>();
  readonly exportJson = output<void>();
  readonly history = output<void>();
  readonly permissions = output<void>();
  readonly json = output<void>();

  readonly errorCount = computed(() => this.store.issues().length);

  readonly statusVariant = computed<'success' | 'warning' | 'neutral' | 'info'>(() => {
    const row = this.store.row();
    if (!row) return 'neutral';
    if (row.status === 'archived') return 'neutral';
    if (row.published_version) return this.store.hasUnpublished() ? 'info' : 'success';
    return 'warning';
  });

  readonly saveText = computed(() => {
    if (this.store.conflict()) return 'Conflicto: otro usuario guardó antes';
    if (this.store.savingNow()) return 'Guardando…';
    if (this.store.saveError()) return 'No se pudo guardar';
    if (this.store.dirty()) return 'Cambios sin guardar…';
    const saved = this.store.lastSavedAt();
    return saved ? `Guardado ${saved.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}` : 'Borrador al día';
  });
}
