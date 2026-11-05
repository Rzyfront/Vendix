import { Component, DestroyRef, effect, inject, input, model, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonComponent, IconComponent, ModalComponent } from '../../../../../../shared/components/index';
import { WorkflowVersionRow } from '../../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import { shortHash } from '../../utils/workflow-labels.util';

/** Version history: list of published versions and a read-only JSON viewer. */
@Component({
  selector: 'app-history-modal',
  standalone: true,
  imports: [ButtonComponent, IconComponent, ModalComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      title="Historial de versiones"
      size="lg"
    >
      @if (error(); as message) {
        <p class="text-sm text-error" role="alert">{{ message }}</p>
      } @else if (loading()) {
        <p class="text-sm text-text-secondary">Cargando versiones…</p>
      } @else if (viewing(); as version) {
        <div class="flex flex-col gap-2">
          <app-button variant="ghost" size="sm" (clicked)="viewing.set(null)">
            Volver a la lista
          </app-button>
          <p class="text-sm font-semibold text-text-primary">Versión {{ version }} (solo lectura)</p>
          <pre class="max-h-96 overflow-auto rounded-xl border border-border bg-surface p-3 font-mono text-xs text-text-primary" data-testid="version-json">{{ json() }}</pre>
        </div>
      } @else {
        <ul class="flex flex-col gap-2">
          @for (v of versions(); track v.version) {
            <li class="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold text-text-primary">Versión {{ v.version }}</p>
                <p class="text-xs text-text-secondary">{{ dateText(v.published_at) }} · huella {{ hash(v.definition_hash) }}</p>
                @if (v.changelog) {
                  <p class="text-xs text-text-primary">{{ v.changelog }}</p>
                }
              </div>
              <app-button variant="outline" size="sm" (clicked)="view(v.version)">
                <app-icon name="eye" [size]="14" slot="icon" />
                Ver JSON
              </app-button>
            </li>
          } @empty {
            <li class="text-sm text-text-secondary">Este flujo aún no se ha publicado.</li>
          }
        </ul>
      }
    </app-modal>
  `,
})
export class HistoryModalComponent {
  private readonly api = inject(WorkflowsApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly definitionId = input.required<number>();

  readonly versions = signal<WorkflowVersionRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly viewing = signal<number | null>(null);
  readonly json = signal('');

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;
      const id = this.definitionId();
      untracked(() => {
        this.viewing.set(null);
        this.error.set(null);
        this.loading.set(true);
        this.api.listVersions(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (rows) => {
            this.versions.set(rows);
            this.loading.set(false);
          },
          error: (e) => {
            this.error.set(toWorkflowError(e).message);
            this.loading.set(false);
          },
        });
      });
    });
  }

  hash(value: string): string {
    return shortHash(value);
  }

  dateText(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('es-CO');
  }

  view(version: number): void {
    this.loading.set(true);
    this.api
      .getVersion(this.definitionId(), version)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (detail) => {
        this.json.set(JSON.stringify(detail.definition, null, 2));
        this.viewing.set(version);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(toWorkflowError(e).message);
        this.loading.set(false);
      },
    });
  }
}
