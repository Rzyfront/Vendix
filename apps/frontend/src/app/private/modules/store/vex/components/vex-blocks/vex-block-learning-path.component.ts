import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VexUiBlock } from '../../models/vex.models';
import { VexMediaDockService } from '../../services/vex-media-dock.service';
import { VEX_MEDIA_COPY, formatMediaTime } from '../vex-media-dock/vex-media-dock.copy';
import { readSeries } from './vex-learning-block.util';

/**
 * `learning_path` block: ordered videos with progress. Progress shown here is
 * the live dock map, hydrated from `GET /store/help/learning-paths/:id` so a
 * reload restores seconds and completion instead of the values the block was
 * persisted with.
 */
@Component({
  selector: 'vendix-vex-block-learning-path',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (series(); as s) {
      <section
        class="rounded-2xl border border-border bg-surface overflow-hidden"
        [attr.aria-label]="copy.path_label"
      >
        <div class="p-4 flex flex-col gap-2">
          <h3 class="m-0 text-base font-semibold text-text-primary">{{ s.title }}</h3>
          @if (s.summary) {
            <p class="m-0 text-sm text-text-secondary">{{ s.summary }}</p>
          }
          <p class="m-0 text-xs text-text-secondary">
            {{ copy.progress(completed_count(), s.items.length) }}
          </p>
          <div
            class="h-1.5 rounded-full bg-border overflow-hidden"
            role="progressbar"
            [attr.aria-valuemin]="0"
            [attr.aria-valuemax]="s.items.length"
            [attr.aria-valuenow]="completed_count()"
            [attr.aria-label]="copy.progress(completed_count(), s.items.length)"
          >
            <div
              class="h-full bg-primary"
              [style.width.%]="(completed_count() / s.items.length) * 100"
            ></div>
          </div>
          <div>
            <button
              type="button"
              class="min-h-10 px-4 rounded-full bg-primary text-on-primary text-sm font-semibold inline-flex items-center gap-2"
              (click)="dock.playPath(s)"
            >
              <app-icon name="play" [size]="16" />
              {{ primary_label() }}
            </button>
          </div>
        </div>
        <ol class="list-none m-0 p-0 border-t border-border">
          @for (item of s.items; track item.video.id; let i = $index) {
            <li class="border-b border-border last:border-b-0">
              <button
                type="button"
                class="w-full min-h-14 px-4 py-2 flex items-center gap-3 text-left hover:bg-text-primary/5 focus-visible:outline-2 focus-visible:outline-primary"
                [attr.aria-label]="copy.play_aria(item.video.title)"
                (click)="dock.playPath(s, i)"
              >
                <span class="w-6 shrink-0 flex justify-center">
                  @if (is_done(item.video.id)) {
                    <app-icon name="check" [size]="16" class="text-success" />
                  } @else {
                    <span class="text-xs font-semibold text-text-secondary">{{ item.position }}</span>
                  }
                </span>
                @if (item.video.thumbnail_url) {
                  <img
                    [src]="item.video.thumbnail_url"
                    alt=""
                    class="w-16 h-9 rounded-md object-cover shrink-0"
                    loading="lazy"
                  />
                }
                <span class="flex-1 min-w-0 flex flex-col">
                  <span class="text-sm font-semibold text-text-primary truncate">{{ item.video.title }}</span>
                  <span class="text-xs text-text-secondary">
                    @if (is_done(item.video.id)) {
                      {{ copy.completed }}
                    } @else if (seconds_of(item.video.id) >= 5) {
                      {{ copy.seconds_in(time(seconds_of(item.video.id))) }}
                    } @else if (item.video.duration_seconds) {
                      {{ time(item.video.duration_seconds) }}
                    }
                  </span>
                </span>
                <app-icon name="play" [size]="16" class="shrink-0 text-text-secondary" />
              </button>
            </li>
          }
        </ol>
      </section>
    } @else {
      <p class="text-sm text-text-secondary">{{ copy.unavailable }}</p>
    }
  `,
})
export class VexBlockLearningPathComponent {
  protected readonly copy = VEX_MEDIA_COPY.blocks;
  protected readonly dock = inject(VexMediaDockService);
  readonly block = input.required<VexUiBlock>();

  readonly series = computed(() => readSeries(this.block().data['series']));

  constructor() {
    // Block payload progress is a snapshot from creation time: seed it, then
    // let the server's current progress win.
    effect(() => {
      const s = this.series();
      if (!s) return;
      untracked(() => {
        this.dock.seedProgress(s);
        void this.dock.loadPath(s.id);
      });
    });
  }

  protected is_done(videoId: number): boolean {
    return !!this.dock.progress()[videoId]?.completed;
  }

  protected seconds_of(videoId: number): number {
    return this.dock.progress()[videoId]?.seconds_watched ?? 0;
  }

  protected readonly completed_count = computed(() => {
    const s = this.series();
    if (!s) return 0;
    const progress = this.dock.progress();
    return s.items.filter((item) => progress[item.video.id]?.completed).length;
  });

  protected readonly primary_label = computed(() => {
    const s = this.series();
    const progress = this.dock.progress();
    if (!s) return this.copy.start;
    const done = this.completed_count();
    if (done >= s.items.length) return this.copy.review;
    const started = s.items.some(
      (item) => (progress[item.video.id]?.seconds_watched ?? 0) > 0,
    );
    return done > 0 || started ? this.copy.continue : this.copy.start;
  });

  protected time(seconds: number): string {
    return formatMediaTime(seconds);
  }
}
