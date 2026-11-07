import { Component, computed, inject, input, output } from '@angular/core';
import { ButtonComponent, IconComponent } from '../../../../../../shared/components/index';
import { WorkflowIssueView } from '../../interfaces/workflow.interfaces';
import { GENERAL_BUCKET, WorkflowEditorStore } from '../workflow-editor.store';
import { issueStageKey } from '../workflow-editor.utils';

interface Group {
  key: string | null;
  title: string;
  issues: WorkflowIssueView[];
}

/** Backend validation result grouped by stage; clicking an item selects stage and tab. */
@Component({
  selector: 'app-validation-panel',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  template: `
    <section class="flex flex-col gap-2 rounded-xl border p-3" [class]="errors().length === 0 ? 'border-success/25 bg-success/10' : 'border-error/25 bg-error/10'" aria-label="Resultado de la validación" role="status">
      <div class="flex items-center justify-between gap-2">
        <h2 class="flex items-center gap-2 text-sm font-bold text-text-primary">
          <app-icon [name]="errors().length === 0 ? 'check-circle' : 'alert-circle'" [size]="16" />
          @if (errors().length === 0) {
            El flujo es válido
          } @else {
            {{ errors().length }} {{ errors().length === 1 ? 'problema por corregir' : 'problemas por corregir' }}
          }
        </h2>
        <app-button variant="ghost" size="xsm" ariaLabel="Cerrar resultado" (clicked)="closed.emit()">
          <app-icon name="x" [size]="12" slot="icon" />
        </app-button>
      </div>
      @for (group of groups(); track group.title) {
        <div>
          <p class="text-xs font-semibold text-text-primary">{{ group.title }}</p>
          <ul class="list-disc pl-5">
            @for (issue of group.issues; track $index) {
              <li class="text-xs text-text-primary">
                @if (group.key) {
                  <button type="button" class="text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20" (click)="store.goToIssue(issue)">{{ issue.message }}</button>
                } @else {
                  {{ issue.message }}
                }
              </li>
            }
          </ul>
        </div>
      }
      @if (warnings().length > 0) {
        <div>
          <p class="text-xs font-semibold text-text-primary">Avisos</p>
          <ul class="list-disc pl-5">
            @for (w of warnings(); track $index) {
              <li class="text-xs text-text-secondary">{{ w.message }}</li>
            }
          </ul>
        </div>
      }
    </section>
  `,
})
export class ValidationPanelComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly errors = input<WorkflowIssueView[]>([]);
  readonly warnings = input<WorkflowIssueView[]>([]);
  readonly closed = output<void>();

  readonly groups = computed<Group[]>(() => {
    const draft = this.store.draft();
    const map = new Map<string, Group>();
    for (const issue of this.errors()) {
      const key = issueStageKey(issue, draft);
      const id = key ?? GENERAL_BUCKET;
      const title = key ? (draft?.stages.find((s) => s.key === key)?.name ?? key) : 'Flujo en general';
      const group = map.get(id) ?? { key, title, issues: [] };
      group.issues.push(issue);
      map.set(id, group);
    }
    return [...map.values()];
  });
}
