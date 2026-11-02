import { Component, computed, input } from '@angular/core';
import { IconComponent, TooltipComponent } from '../../../../../../shared/components';
import { CrmSegmentMembership, CrmTag } from './crm.interface';

interface Chip {
  key: string;
  kind: 'segment' | 'tag';
  label: string;
}

/**
 * Compact segment and tag chips of a customer: the first `max` chips, a "+N"
 * chip whose tooltip names the rest, and a discreet dash when there are none.
 * Segments carry the brand tint; tags stay neutral.
 */
@Component({
  selector: 'app-crm-membership-chips',
  standalone: true,
  imports: [IconComponent, TooltipComponent],
  template: `
    @if (chips().length) {
      <span class="flex flex-wrap items-center gap-1">
        @for (chip of visible(); track chip.key) {
          <span
            class="inline-flex h-6 max-w-40 items-center gap-1 rounded-full border px-2 text-xs font-semibold"
            [class]="chip.kind === 'segment' ? segmentClass : tagClass"
            [attr.title]="(chip.kind === 'segment' ? 'Segmento: ' : 'Etiqueta: ') + chip.label"
          >
            <app-icon [name]="chip.kind === 'segment' ? 'users' : 'tag'" [size]="12"></app-icon>
            <span class="truncate">{{ chip.label }}</span>
          </span>
        }
        @if (hidden().length) {
          <app-tooltip [content]="hiddenLabel()" size="sm" position="top" color="default">
            <span
              class="inline-flex h-6 items-center rounded-full border border-border bg-surface px-2 text-xs font-semibold text-text-secondary"
              tabindex="0"
              [attr.aria-label]="'Y ' + hidden().length + ' más: ' + hiddenLabel()"
            >
              +{{ hidden().length }}
            </span>
          </app-tooltip>
        }
      </span>
    } @else {
      <span class="text-sm text-muted" aria-label="Sin segmentos ni etiquetas">—</span>
    }
  `,
})
export class CrmMembershipChipsComponent {
  readonly segments = input<CrmSegmentMembership[]>([]);
  readonly tags = input<CrmTag[]>([]);
  /** Chips shown before collapsing the rest into "+N". */
  readonly max = input(2);

  protected readonly segmentClass = 'border-primary/25 bg-primary/10 text-primary-on-tint';
  protected readonly tagClass = 'border-border bg-surface text-text-secondary';

  protected readonly chips = computed<Chip[]>(() => [
    ...this.segments().map((segment) => ({
      key: `s${segment.id}`,
      kind: 'segment' as const,
      label: segment.name,
    })),
    ...this.tags().map((tag) => ({ key: `t${tag.id}`, kind: 'tag' as const, label: tag.name })),
  ]);
  protected readonly visible = computed(() => this.chips().slice(0, this.max()));
  protected readonly hidden = computed(() => this.chips().slice(this.max()));
  protected readonly hiddenLabel = computed(() =>
    this.hidden()
      .map((chip) => chip.label)
      .join(', '),
  );
}
