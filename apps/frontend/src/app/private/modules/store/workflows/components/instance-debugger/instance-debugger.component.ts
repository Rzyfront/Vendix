import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { BadgeComponent, ButtonComponent, IconComponent } from '../../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { DebugEvent, InstanceDebug } from '../../interfaces/workflow-debug.interfaces';
import { WorkflowDebugApiService } from '../../services/workflow-debug-api.service';
import { eventLabel } from '../../utils/workflow-labels.util';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import {
  VariableRow,
  actorLabel,
  hasCapture,
  stageText,
  variableRows,
} from './instance-debugger.utils';

/** Debugger of a request: every event with the variables at that moment and what changed. */
@Component({
  selector: 'app-instance-debugger',
  standalone: true,
  imports: [BadgeComponent, ButtonComponent, IconComponent],
  template: `
    <div class="flex flex-col gap-3" data-testid="instance-debugger">
      @if (loading()) {
        <p class="text-sm text-text-secondary" role="status">Cargando el recorrido…</p>
      } @else if (error(); as message) {
        <p class="text-sm text-error" role="alert">{{ message }}</p>
        <div><app-button variant="outline" size="sm" (clicked)="load()">Reintentar</app-button></div>
      } @else if (debug(); as d) {
        <ol class="flex flex-col gap-2" aria-label="Eventos de la solicitud">
          @for (event of d.events; track event.seq) {
            <li class="rounded-xl border border-border bg-surface" data-testid="debug-event">
              <button
                type="button"
                class="flex w-full items-start gap-2 p-3 text-left"
                [attr.aria-expanded]="isOpen(event.seq)"
                (click)="toggle(event.seq)"
              >
                <app-icon [name]="isOpen(event.seq) ? 'chevron-down' : 'chevron-right'" [size]="16" class="mt-0.5 shrink-0" />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-semibold text-text-primary">
                    {{ event.seq }}. {{ label(event.type) }}
                  </span>
                  <span class="block text-xs text-text-secondary">
                    {{ stage(event) }} · {{ actor(event) }} · {{ date(event.occurred_at) }}
                  </span>
                </span>
                @if (event.changes.length > 0) {
                  <app-badge variant="warning">{{ event.changes.length }} cambio(s)</app-badge>
                }
              </button>
              @if (isOpen(event.seq)) {
                <div class="border-t border-border p-3" data-testid="debug-variables">
                  @if (captured(event)) {
                    <div class="overflow-x-auto">
                      <table class="w-full text-left text-xs">
                        <caption class="sr-only">Variables en este evento</caption>
                        <thead>
                          <tr class="text-text-secondary">
                            <th scope="col" class="py-1 pr-3 font-semibold">Variable</th>
                            <th scope="col" class="py-1 pr-3 font-semibold">Valor</th>
                            <th scope="col" class="py-1 font-semibold">Antes</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (row of rows(event); track row.key) {
                            <tr [class]="row.changed ? 'bg-warning/10' : ''" [attr.data-changed]="row.changed">
                              <th scope="row" class="py-1 pr-3 font-mono font-normal text-text-primary">{{ row.key }}</th>
                              <td class="break-all py-1 pr-3 text-text-primary" [class.font-semibold]="row.changed">{{ row.value }}</td>
                              <td class="break-all py-1 text-text-secondary">{{ row.changed ? row.before : '' }}</td>
                            </tr>
                          } @empty {
                            <tr><td colspan="3" class="py-1 text-text-secondary">La solicitud no tenía variables.</td></tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  } @else {
                    <p class="text-sm text-text-secondary" data-testid="debug-legacy">Sin captura de variables</p>
                  }
                </div>
              }
            </li>
          } @empty {
            <li class="text-sm text-text-secondary">Esta solicitud aún no tiene eventos.</li>
          }
        </ol>
        <p class="text-xs text-text-secondary">
          Variables actuales: {{ currentCount(d) }}. Cada fila resaltada cambió respecto del evento anterior con captura.
        </p>
      }
    </div>
  `,
})
export class InstanceDebuggerComponent {
  private readonly api = inject(WorkflowDebugApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly settings = inject(StoreSettingsFacade);

  readonly instanceId = input.required<number>();
  /** Stage key → name, to read the path without keys. */
  readonly stageNames = input<Record<string, string>>({});

  readonly debug = signal<InstanceDebug | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private readonly open = signal<ReadonlySet<number>>(new Set());

  constructor() {
    effect(() => {
      this.instanceId();
      untracked(() => this.load());
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .instanceDebug(this.instanceId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          this.debug.set(res);
          this.open.set(new Set());
        },
        error: (e) => {
          this.loading.set(false);
          this.error.set(toWorkflowError(e).message);
        },
      });
  }

  isOpen(seq: number): boolean {
    return this.open().has(seq);
  }

  toggle(seq: number): void {
    this.open.update((current) => {
      const next = new Set(current);
      if (!next.delete(seq)) next.add(seq);
      return next;
    });
  }

  label(type: string): string {
    return eventLabel(type);
  }

  stage(event: DebugEvent): string {
    return stageText(event, this.stageNames());
  }

  actor(event: DebugEvent): string {
    return actorLabel(event);
  }

  date(value: string): string {
    return formatStoreDateTime(value, this.settings.timezone());
  }

  captured(event: DebugEvent): boolean {
    return hasCapture(event);
  }

  rows(event: DebugEvent): VariableRow[] {
    return variableRows(event);
  }

  currentCount(d: InstanceDebug): number {
    return Object.keys(d.current_data).length;
  }
}
