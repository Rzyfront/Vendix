import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { TimelineComponent } from '../../../../../../shared/components/timeline/timeline.component';
import { TimelineStep } from '../../../../../../shared/components/timeline/timeline.interfaces';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import {
  VexBlockTone,
  VexTimelineData,
  VexTimelineEvent,
  VexUiBlock,
} from '../../models/vex.models';
import { VEX_COPY } from '../../vex-copy';
import { VexBlockExportMenuComponent } from './vex-block-export-menu.component';

interface TimelineRow {
  step: TimelineStep;
  event: VexTimelineEvent;
  when: string;
}

/** Maps the block tone onto the shared timeline marker vocabulary. */
function toStep(event: VexTimelineEvent, index: number): TimelineStep {
  const tone: VexBlockTone = event.status ?? 'neutral';
  const base = { key: event.id ?? String(index), label: event.title };
  switch (tone) {
    case 'success':
      return { ...base, status: 'completed', variant: 'success' };
    case 'warning':
      return { ...base, status: 'terminal', variant: 'warning' };
    case 'error':
      return { ...base, status: 'terminal', variant: 'danger' };
    case 'info':
      return { ...base, status: 'current', variant: 'default' };
    default:
      return { ...base, status: 'pending', variant: 'default' };
  }
}

/** `timeline` block: reuses the shared `app-timeline`, always expanded. */
@Component({
  selector: 'vendix-vex-block-timeline',
  standalone: true,
  imports: [TimelineComponent, VexBlockExportMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-2xl border border-border bg-surface"
      [attr.aria-label]="title() || copy.label"
    >
      <header class="px-4 pt-3 pb-1 flex items-center justify-between gap-2">
        <h4 class="text-sm font-semibold text-text-primary min-w-0 truncate">
          {{ title() || copy.label }}
        </h4>
        <vendix-vex-block-export-menu [block]="block()" />
      </header>
      @if (rows().length > 0) {
        <div class="px-4 pb-3 pt-1">
          <app-timeline
            [steps]="steps()"
            [collapsible]="false"
            size="sm"
          >
            <ng-template #stepTemplate let-step let-index="index">
              <div class="min-w-0 pb-3">
                <p class="text-sm font-semibold text-text-primary break-words">
                  {{ rows()[index].event.title }}
                </p>
                @if (rows()[index].event.description) {
                  <p class="text-xs text-text-secondary mt-0.5 break-words">
                    {{ rows()[index].event.description }}
                  </p>
                }
                <p class="text-xs text-text-secondary mt-0.5">
                  {{ rows()[index].when || copy.no_date }}
                  @if (rows()[index].event.actor) {
                    · {{ rows()[index].event.actor }}
                  }
                </p>
              </div>
            </ng-template>
          </app-timeline>
        </div>
      } @else {
        <p class="px-4 py-6 text-sm text-center text-text-secondary">
          {{ copy.empty }}
        </p>
      }
    </section>
  `,
})
export class VexBlockTimelineComponent {
  protected readonly copy = VEX_COPY.blocks.timeline;
  private readonly auth = inject(AuthFacade);

  readonly block = input.required<VexUiBlock>();

  readonly title = computed(
    () => (this.block().spec as { title?: string }).title,
  );

  private readonly timezone = computed(() => {
    const settings = this.auth.storeSettings() as {
      general?: { timezone?: string };
    } | null;
    return settings?.general?.timezone || 'America/Bogota';
  });

  readonly rows = computed<TimelineRow[]>(() => {
    const events = (this.block().data as Partial<VexTimelineData>).events;
    if (!Array.isArray(events)) return [];
    return events.map((event, index) => ({
      event,
      step: toStep(event, index),
      when: event.timestamp
        ? formatStoreDateTime(event.timestamp, this.timezone())
        : '',
    }));
  });

  readonly steps = computed(() => this.rows().map((row) => row.step));
}
