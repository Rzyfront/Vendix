import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { VexUiBlock } from '../../models/vex.models';
import { VexMediaDockService } from '../../services/vex-media-dock.service';
import { VexMarkdownComponent } from '../vex-markdown/vex-markdown.component';
import { VEX_MEDIA_COPY } from '../vex-media-dock/vex-media-dock.copy';
import { readArticle } from './vex-learning-block.util';

/**
 * `help_article` block: the article as the help center shows it (module and
 * type badges, title, summary, expandable body) with the body rendered by the
 * Vex markdown renderer, which sanitizes through Angular's `[innerHTML]`.
 */
@Component({
  selector: 'vendix-vex-block-help-article',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, VexMarkdownComponent],
  template: `
    @if (article(); as a) {
      <article
        class="rounded-2xl border border-border bg-surface overflow-hidden"
        [attr.aria-label]="copy.article_label"
      >
        @if (a.cover_image_url) {
          <img
            [src]="a.cover_image_url"
            alt=""
            class="w-full max-h-48 object-cover"
            loading="lazy"
          />
        }
        <div class="p-4 flex flex-col gap-2">
          <div class="flex flex-wrap items-center gap-2">
            @if (a.module) {
              <span class="px-2 py-0.5 rounded-full bg-primary/10 text-primary-on-tint text-xs font-semibold">
                {{ a.module }}
              </span>
            }
            @if (type_label()) {
              <span class="px-2 py-0.5 rounded-full border border-border text-text-secondary text-xs font-semibold">
                {{ type_label() }}
              </span>
            }
          </div>
          <h3 class="m-0 text-base font-semibold text-text-primary">{{ a.title }}</h3>
          @if (a.summary) {
            <p class="m-0 text-sm text-text-secondary">{{ a.summary }}</p>
          }
          <div class="flex flex-wrap items-center gap-2 pt-1">
            @if (a.video; as v) {
              <button
                type="button"
                class="min-h-10 px-4 rounded-full bg-primary text-on-primary text-sm font-semibold inline-flex items-center gap-2"
                [attr.aria-label]="copy.play_aria(v.title)"
                (click)="dock.playVideo(v)"
              >
                <app-icon name="play" [size]="16" />
                {{ copy.related_video }}
              </button>
            }
            <button
              type="button"
              class="min-h-10 px-3 rounded-full text-sm font-semibold text-text-secondary hover:text-text-primary inline-flex items-center gap-1"
              [attr.aria-expanded]="expanded()"
              (click)="expanded.set(!expanded())"
            >
              {{ expanded() ? copy.show_less : copy.show_more }}
              <app-icon [name]="expanded() ? 'chevron-up' : 'chevron-down'" [size]="16" />
            </button>
          </div>
        </div>
        @if (expanded()) {
          <div class="px-4 pb-4 border-t border-border pt-3">
            <vendix-vex-markdown [content]="a.content" />
          </div>
        }
      </article>
    } @else {
      <p class="text-sm text-text-secondary">{{ copy.unavailable }}</p>
    }
  `,
})
export class VexBlockHelpArticleComponent {
  protected readonly copy = VEX_MEDIA_COPY.blocks;
  protected readonly dock = inject(VexMediaDockService);
  readonly block = input.required<VexUiBlock>();
  readonly expanded = signal(true);

  readonly article = computed(() => readArticle(this.block().data['article']));

  protected readonly type_label = computed(() => {
    const type = this.article()?.type;
    return type ? (this.copy.types[type.toUpperCase()] ?? type) : '';
  });
}
