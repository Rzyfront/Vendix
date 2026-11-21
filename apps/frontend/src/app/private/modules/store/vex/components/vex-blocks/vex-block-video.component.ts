import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { VexUiBlock } from '../../models/vex.models';
import { VexMediaDockService } from '../../services/vex-media-dock.service';
import { VEX_MEDIA_COPY, formatMediaTime } from '../vex-media-dock/vex-media-dock.copy';
import { readVideo } from './vex-learning-block.util';

/**
 * `video` block: thumbnail plus a play button that hands the video off to the
 * page-level media dock (the player never lives inside the thread).
 */
@Component({
  selector: 'vendix-vex-block-video',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (video(); as v) {
      <article
        class="rounded-2xl border border-border bg-surface overflow-hidden"
        [attr.aria-label]="copy.video_label"
      >
        <button
          type="button"
          class="relative block w-full aspect-video bg-background group focus-visible:outline-2 focus-visible:outline-primary"
          [attr.aria-label]="copy.play_aria(v.title)"
          (click)="dock.playVideo(v)"
        >
          @if (v.thumbnail_url) {
            <img
              [src]="v.thumbnail_url"
              alt=""
              class="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
          }
          <span class="absolute inset-0 flex items-center justify-center bg-text-primary/20 group-hover:bg-text-primary/30">
            <span class="w-14 h-14 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-lg">
              <app-icon name="play" [size]="24" />
            </span>
          </span>
          @if (v.duration_seconds) {
            <span class="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-text-primary/70 text-xs text-on-primary">
              {{ time(v.duration_seconds) }}
            </span>
          }
        </button>
        <div class="px-4 py-3 flex flex-col gap-1">
          <h3 class="m-0 text-sm font-semibold text-text-primary">{{ v.title }}</h3>
          @if (v.summary) {
            <p class="m-0 text-xs text-text-secondary">{{ v.summary }}</p>
          }
          @if (done()) {
            <p class="m-0 inline-flex items-center gap-1 text-xs font-semibold text-success">
              <app-icon name="check" [size]="14" />
              {{ copy.completed }}
            </p>
          } @else if (resume_label()) {
            <p class="m-0 text-xs text-text-secondary">{{ resume_label() }}</p>
          }
        </div>
      </article>
    } @else {
      <p class="text-sm text-text-secondary">{{ copy.unavailable }}</p>
    }
  `,
})
export class VexBlockVideoComponent {
  protected readonly copy = VEX_MEDIA_COPY.blocks;
  protected readonly dock = inject(VexMediaDockService);
  readonly block = input.required<VexUiBlock>();

  readonly video = computed(() => readVideo(this.block().data['video']));

  protected readonly done = computed(() => {
    const v = this.video();
    return v ? !!this.dock.progress()[v.id]?.completed : false;
  });

  protected readonly resume_label = computed(() => {
    const v = this.video();
    const seconds = v ? (this.dock.progress()[v.id]?.seconds_watched ?? 0) : 0;
    return seconds >= 5 ? this.copy.seconds_in(formatMediaTime(seconds)) : '';
  });

  protected time(seconds: number): string {
    return formatMediaTime(seconds);
  }
}
