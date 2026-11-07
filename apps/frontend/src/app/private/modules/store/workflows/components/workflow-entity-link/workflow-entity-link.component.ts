import { Component, computed, effect, inject, input, model, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/index';
import type { IconName } from '../../../../../../shared/components/icon/icons.registry';
import {
  WorkflowLinkGate,
  WorkflowLinks,
  WorkflowLinksApiService,
} from '../../services/workflow-links-api.service';

const EMPTY: WorkflowLinks = { pending: false, gates: [], instances: [] };

/**
 * Shows the approval requests linked to a record ("Pendiente de aprobación ·
 * Solicitud FLU-000123 · etapa X") and the related requests. Renders nothing
 * when there are none. `pending` is true while an approval gate holds the
 * record, so the host can disable its action.
 */
@Component({
  selector: 'app-workflow-entity-link',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    @if (visible()) {
      <div class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 text-sm" data-testid="workflow-entity-link">
        @for (gate of gates(); track gate.id) {
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="workflow-gate">
            <app-icon [name]="icon(gate)" [size]="16" [class]="tone(gate)" />
            <span class="font-semibold" [class]="tone(gate)" data-testid="workflow-gate-status">{{ statusText(gate) }}</span>
            <span class="text-text-secondary">· {{ gate.operation_label }}</span>
            @if (gate.instance; as instance) {
              <span class="text-text-secondary">·</span>
              <a
                class="font-medium text-primary hover:underline"
                data-testid="workflow-gate-instance"
                [routerLink]="['/admin/workflows/instances', instance.id]"
              >
                Solicitud {{ instance.reference }}
              </a>
              @if (gate.status === 'pending' && instance.stage_name) {
                <span class="text-text-secondary">· etapa {{ instance.stage_name }}</span>
              }
            }
          </div>
        }
        @if (instances().length > 0) {
          <div class="flex flex-col gap-1" data-testid="workflow-related">
            <p class="text-xs font-semibold text-text-secondary">Solicitudes relacionadas</p>
            @for (instance of instances(); track instance.id) {
              <a
                class="font-medium text-primary hover:underline"
                [routerLink]="['/admin/workflows/instances', instance.id]"
              >
                {{ instance.reference }} · {{ instance.title }}
              </a>
              <span class="-mt-1 text-xs text-text-secondary">
                {{ instance.definition_name }}@if (instance.stage_name) { · etapa {{ instance.stage_name }} }
              </span>
            }
          </div>
        }
      </div>
    }
  `,
})
export class WorkflowEntityLinkComponent {
  private readonly api = inject(WorkflowLinksApiService);

  readonly entityType = input.required<string>();
  readonly entityId = input.required<number | string | null | undefined>();
  /** Bumped by the host after it reloads its record, to re-fetch the links. */
  readonly refreshKey = input<unknown>(null);
  /** True while an approval gate holds the record. */
  readonly pending = model<boolean>(false);

  private readonly links = signal<WorkflowLinks>(EMPTY);
  readonly gates = computed(() => this.links().gates);
  readonly instances = computed(() => this.links().instances);
  readonly visible = computed(() => this.gates().length > 0 || this.instances().length > 0);

  constructor() {
    effect((onCleanup) => {
      const type = this.entityType();
      const id = this.entityId();
      this.refreshKey();
      if (id === null || id === undefined || id === '') {
        this.apply(EMPTY);
        return;
      }
      const sub = this.api.getLinks(type, id).subscribe({
        next: (links) => this.apply(links),
        error: () => this.apply(EMPTY),
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  private apply(links: WorkflowLinks): void {
    this.links.set(links);
    this.pending.set(links.pending);
  }

  statusText(gate: WorkflowLinkGate): string {
    switch (gate.status) {
      case 'pending':
        return 'Pendiente de aprobación';
      case 'approved':
        return 'Aprobada';
      case 'rejected':
        return gate.reason ? `Rechazada: ${gate.reason}` : 'Rechazada';
      default:
        return 'Cancelada';
    }
  }

  icon(gate: WorkflowLinkGate): IconName {
    switch (gate.status) {
      case 'pending':
        return 'clock';
      case 'approved':
        return 'check-circle';
      case 'rejected':
        return 'x-circle';
      default:
        return 'minus-circle';
    }
  }

  tone(gate: WorkflowLinkGate): string {
    switch (gate.status) {
      case 'pending':
        return 'text-warning';
      case 'approved':
        return 'text-success';
      case 'rejected':
        return 'text-error';
      default:
        return 'text-text-secondary';
    }
  }
}
