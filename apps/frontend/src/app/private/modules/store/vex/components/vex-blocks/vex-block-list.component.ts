import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  VexBlockTone,
  VexListData,
  VexListItem,
  VexListSpec,
  VexUiBlock,
} from '../../models/vex.models';
import { VEX_COPY } from '../../vex-copy';
import { VexBlockExportMenuComponent } from './vex-block-export-menu.component';

const TONE_CLASSES: Record<VexBlockTone, string> = {
  success: 'border-success/25 bg-success/10 text-success',
  warning: 'border-warning/25 bg-warning/10 text-warning',
  error: 'border-error/25 bg-error/10 text-error',
  info: 'border-info/25 bg-info/10 text-info',
  neutral: 'border-border bg-text-primary/5 text-text-secondary',
};

/** `list` block: responsive cards grid or compact rows. */
@Component({
  selector: 'vendix-vex-block-list',
  standalone: true,
  imports: [VexBlockExportMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-2xl border border-border bg-surface"
      [attr.aria-label]="spec().title || copy.label"
    >
      <header class="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
        <h4 class="text-sm font-semibold text-text-primary min-w-0 truncate">
          {{ spec().title || copy.label }}
        </h4>
        <vendix-vex-block-export-menu [block]="block()" />
      </header>

      @if (items().length > 0) {
        <ul
          role="list"
          class="list-none m-0 p-3 pt-0"
          [class]="
            is_cards()
              ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3'
              : 'flex flex-col gap-2'
          "
        >
          @for (item of items(); track $index) {
            <li
              role="listitem"
              class="min-w-0 rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-sm font-semibold text-text-primary break-words">
                    {{ item.title }}
                  </p>
                  @if (item.subtitle) {
                    <p class="text-xs text-text-secondary break-words">
                      {{ item.subtitle }}
                    </p>
                  }
                </div>
                @if (item.badge) {
                  <span
                    class="shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold"
                    [class]="toneClass(item.badge.tone)"
                  >
                    {{ item.badge.label }}
                  </span>
                }
              </div>
              @if (item.description) {
                <p class="mt-1 text-sm text-text-secondary break-words">
                  {{ item.description }}
                </p>
              }
              @if (item.fields?.length) {
                <dl
                  class="mt-2 grid gap-x-3 gap-y-1 text-xs"
                  [class]="
                    is_cards() ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'
                  "
                >
                  @for (field of item.fields; track $index) {
                    <div class="min-w-0 flex justify-between gap-2">
                      <dt class="text-text-secondary truncate">{{ field.label }}</dt>
                      <dd class="m-0 font-medium text-text-primary text-right break-words">
                        {{ field.value }}
                      </dd>
                    </div>
                  }
                </dl>
              }
            </li>
          }
        </ul>
      } @else {
        <p class="px-4 py-6 text-sm text-center text-text-secondary">
          {{ copy.empty }}
        </p>
      }
    </section>
  `,
})
export class VexBlockListComponent {
  protected readonly copy = VEX_COPY.blocks.list;

  readonly block = input.required<VexUiBlock>();

  readonly spec = computed(() => this.block().spec as VexListSpec);
  readonly is_cards = computed(() => (this.spec().layout ?? 'cards') === 'cards');

  readonly items = computed<VexListItem[]>(() => {
    const items = (this.block().data as Partial<VexListData>).items;
    return Array.isArray(items) ? items : [];
  });

  protected toneClass(tone: VexBlockTone | undefined): string {
    return TONE_CLASSES[tone ?? 'neutral'] ?? TONE_CLASSES.neutral;
  }
}
