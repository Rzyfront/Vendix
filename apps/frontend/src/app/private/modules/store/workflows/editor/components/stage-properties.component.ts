import { Component, computed, inject } from '@angular/core';
import { ScrollableTabsComponent } from '../../../../../../shared/components/index';
import { ScrollableTab } from '../../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { WorkflowIssueView } from '../../interfaces/workflow.interfaces';
import { WorkflowEditorStore } from '../workflow-editor.store';
import { EDITOR_TABS, EditorTab, STAGE_TYPE_LABEL, tabForIssue } from '../workflow-editor.utils';
import { StageActionsTabComponent } from './tabs/stage-actions-tab.component';
import { StageAssigneeTabComponent } from './tabs/stage-assignee-tab.component';
import { StageDueTabComponent } from './tabs/stage-due-tab.component';
import { StageFormTabComponent } from './tabs/stage-form-tab.component';
import { StageGeneralTabComponent } from './tabs/stage-general-tab.component';
import { StageRequirementsTabComponent } from './tabs/stage-requirements-tab.component';
import { StageTransitionsTabComponent } from './tabs/stage-transitions-tab.component';

/** Right panel: tabbed properties of the selected stage. */
@Component({
  selector: 'app-stage-properties',
  standalone: true,
  imports: [
    ScrollableTabsComponent,
    StageGeneralTabComponent,
    StageAssigneeTabComponent,
    StageFormTabComponent,
    StageRequirementsTabComponent,
    StageTransitionsTabComponent,
    StageDueTabComponent,
    StageActionsTabComponent,
  ],
  template: `
    <section class="flex flex-col gap-3" aria-label="Propiedades de la etapa">
      @if (store.selectedStage(); as stage) {
        <header>
          <h2 class="truncate text-sm font-bold text-text-primary">{{ stage.name }}</h2>
          <p class="text-xs text-text-secondary">{{ typeLabel(stage.type) }} · {{ stage.key }}</p>
        </header>
        <app-scrollable-tabs
          [tabs]="tabs"
          [activeTab]="store.activeTab()"
          size="sm"
          ariaLabel="Propiedades de la etapa"
          (tabChange)="setTab($event)"
        />
        @if (stageIssues().length > 0) {
          <ul class="flex flex-col gap-1 rounded-xl border border-error/25 bg-error/10 p-2" aria-label="Problemas de esta etapa">
            @for (issue of stageIssues(); track $index) {
              <li>
                <button type="button" class="text-left text-xs text-text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20" (click)="store.activeTab.set(tabFor(issue))">
                  {{ issue.message }}
                </button>
              </li>
            }
          </ul>
        }
        @for (item of [stage]; track item.key) {
          @switch (store.activeTab()) {
            @case ('general') { <app-stage-general-tab [stage]="item" /> }
            @case ('assignee') { <app-stage-assignee-tab [stage]="item" /> }
            @case ('form') { <app-stage-form-tab [stage]="item" /> }
            @case ('requirements') { <app-stage-requirements-tab [stage]="item" /> }
            @case ('transitions') { <app-stage-transitions-tab [stage]="item" /> }
            @case ('due') { <app-stage-due-tab [stage]="item" /> }
            @case ('actions') { <app-stage-actions-tab [stage]="item" /> }
          }
        }
      } @else {
        <p class="text-sm text-text-secondary">Elige una etapa de la lista o del mapa para editarla.</p>
      }
    </section>
  `,
})
export class StagePropertiesComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly tabs: ScrollableTab[] = EDITOR_TABS;
  readonly stageIssues = computed(
    () => this.store.issuesByStage().get(this.store.selectedKey() ?? '') ?? [],
  );

  typeLabel(type: keyof typeof STAGE_TYPE_LABEL): string {
    return STAGE_TYPE_LABEL[type];
  }

  setTab(id: string): void {
    this.store.activeTab.set(id as EditorTab);
  }

  tabFor(issue: WorkflowIssueView): EditorTab {
    return tabForIssue(issue);
  }
}
