import { Component, signal } from '@angular/core';

import { AgentHistoryChangesComponent } from './agent-history-changes.component';
import { AgentHistoryConversationsComponent } from './agent-history-conversations.component';

type HistoryTab = 'changes' | 'conversations';

/** «Historial» tab of Agentes IA: two read-only sub-tabs. Nothing is editable. */
@Component({
  selector: 'app-agent-history',
  standalone: true,
  imports: [AgentHistoryChangesComponent, AgentHistoryConversationsComponent],
  template: `
    <div
      class="bg-surface rounded-lg shadow-sm border border-[var(--color-border)] p-4 sm:p-6"
    >
      <div
        class="flex gap-4 border-b border-[var(--color-border)] mb-4"
        role="tablist"
        aria-label="Historial de los agentes"
      >
        @for (tab of tabs; track tab.id) {
          <button
            type="button"
            role="tab"
            [id]="'history-tab-' + tab.id"
            [attr.aria-selected]="active() === tab.id"
            [attr.aria-controls]="'history-panel-' + tab.id"
            [attr.tabindex]="active() === tab.id ? 0 : -1"
            (click)="active.set(tab.id)"
            (keydown.arrowright)="move(1)"
            (keydown.arrowleft)="move(-1)"
            class="-mb-px border-b-2 px-1 pb-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
            [class.border-primary-600]="active() === tab.id"
            [class.text-[var(--color-text-primary)]]="active() === tab.id"
            [class.border-transparent]="active() !== tab.id"
            [class.text-[var(--color-text-secondary)]]="active() !== tab.id"
          >
            {{ tab.label }}
          </button>
        }
      </div>

      <div
        role="tabpanel"
        [id]="'history-panel-' + active()"
        [attr.aria-labelledby]="'history-tab-' + active()"
      >
        @if (active() === 'changes') {
          <app-agent-history-changes />
        } @else {
          <app-agent-history-conversations />
        }
      </div>
    </div>
  `,
  styles: [':host { display: block; width: 100%; }'],
})
export class AgentHistoryComponent {
  readonly tabs: ReadonlyArray<{ id: HistoryTab; label: string }> = [
    { id: 'changes', label: 'Cambios' },
    { id: 'conversations', label: 'Conversaciones' },
  ];
  readonly active = signal<HistoryTab>('changes');

  move(step: number): void {
    const index = this.tabs.findIndex((tab) => tab.id === this.active());
    const next = (index + step + this.tabs.length) % this.tabs.length;
    this.active.set(this.tabs[next].id);
  }
}
