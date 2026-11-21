import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VideoPlayerComponent } from '../../../help/video-library/components/video-player/video-player.component';
import { VexMediaDockService } from '../../services/vex-media-dock.service';
import { VEX_MEDIA_COPY, formatMediaTime } from './vex-media-dock.copy';

const YOUTUBE_ORIGIN = 'https://www.youtube-nocookie.com';
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Persistent media dock for Vex, mounted ONCE at page level.
 *
 * One fixed container whose classes switch between `inline` (docked under the
 * header), `minimized` (floating corner, above the composer on small screens)
 * and `fullscreen`. The player node is never moved or re-created when the
 * state changes, so playback keeps going while the owner minimizes it,
 * scrolls the thread or keeps chatting. A new player is created per video so
 * each one starts from its own saved position.
 *
 * Telemetry: `DIRECT_S3` is read from the native `<video>`; YouTube through
 * its iframe `postMessage` API (`enablejsapi=1` is already on the embed).
 * Vimeo and Loom expose nothing without their SDKs, so those get manual
 * «Siguiente» and «Marcar como visto» controls instead of guessed progress.
 */
@Component({
  selector: 'vendix-vex-media-dock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, VideoPlayerComponent],
  template: `
    @if (dock.current(); as item) {
      @if (dock.state() === 'fullscreen') {
        <div class="fixed inset-0 z-40 bg-background" aria-hidden="true"></div>
      }
      <section
        #root
        tabindex="-1"
        [class]="container_class()"
        [attr.role]="is_fullscreen() ? 'dialog' : 'region'"
        [attr.aria-modal]="is_fullscreen() ? 'true' : null"
        [attr.aria-label]="copy.region"
        data-testid="vex-media-dock"
        (keydown)="onKeydown($event)"
      >
        <header class="flex items-center gap-2 min-w-0">
          <div class="flex-1 min-w-0">
            @if (dock.state() !== 'minimized') {
              <p class="text-xs text-text-secondary truncate">
                @if (dock.series(); as series) {
                  {{ series.title }} ·
                  {{ copy.position(dock.index() + 1, dock.queue().length) }}
                } @else {
                  {{ copy.now_playing }}
                }
              </p>
            }
            <p class="text-sm font-semibold text-text-primary truncate">
              {{ item.video.title }}
            </p>
          </div>
          @if (dock.state() === 'minimized') {
            <button
              type="button"
              class="dock-btn"
              [attr.aria-label]="copy.expand"
              (click)="dock.restore()"
            >
              <app-icon name="maximize" [size]="16" />
            </button>
          } @else {
            @if (dock.state() === 'inline') {
              <button
                type="button"
                class="dock-btn"
                [attr.aria-label]="copy.minimize"
                [attr.title]="copy.minimize"
                (click)="dock.minimize()"
              >
                <app-icon name="minimize" [size]="16" />
              </button>
            }
            <button
              #fullscreenButton
              type="button"
              class="dock-btn"
              [attr.aria-label]="
                is_fullscreen() ? copy.exit_fullscreen : copy.fullscreen
              "
              [attr.title]="
                is_fullscreen() ? copy.exit_fullscreen : copy.fullscreen
              "
              (click)="dock.toggleFullscreen()"
            >
              <app-icon [name]="is_fullscreen() ? 'minimize' : 'maximize'" [size]="16" />
            </button>
          }
          <button
            type="button"
            class="dock-btn"
            [attr.aria-label]="copy.close"
            [attr.title]="copy.close"
            (click)="dock.close()"
          >
            <app-icon name="x" [size]="16" />
          </button>
        </header>

        <div #playerHost class="w-full" [class]="is_fullscreen() ? 'max-w-5xl mx-auto' : ''">
          @for (video of [item.video]; track video.id) {
            <app-video-player
              [videoUrl]="video.video_url"
              [videoSource]="video.video_source"
              [externalId]="video.external_id"
              [autoplay]="true"
              (ended)="onPlayerEnded()"
            />
          }
        </div>

        @if (dock.state() !== 'minimized') {
          <footer class="flex flex-col gap-3 min-h-0" [class]="is_fullscreen() ? 'max-w-5xl mx-auto w-full overflow-y-auto' : ''">
            <div class="flex flex-wrap items-center gap-2">
              @if (dock.has_previous()) {
                <button type="button" class="dock-chip" (click)="dock.previous()">
                  {{ copy.previous }}
                </button>
              }
              @if (dock.has_next()) {
                <button type="button" class="dock-chip" (click)="dock.next()">
                  <app-icon name="skip-forward" [size]="14" />
                  {{ copy.next }}
                </button>
              }
              @if (!current_done()) {
                <button type="button" class="dock-chip" (click)="dock.markCurrentDone()">
                  <app-icon name="check" [size]="14" />
                  {{ copy.mark_done }}
                </button>
              } @else {
                <span class="inline-flex items-center gap-1 text-xs font-semibold text-success">
                  <app-icon name="check" [size]="14" />
                  {{ copy.done }}
                </span>
              }
            </div>
            @if (no_telemetry()) {
              <p class="text-xs text-text-secondary">{{ copy.approx_note }}</p>
            }
            @if (dock.queue().length > 1) {
              <ol class="list-none m-0 p-0 flex flex-col gap-1" [attr.aria-label]="copy.queue">
                @for (entry of dock.queue(); track entry.video.id; let i = $index) {
                  <li>
                    <button
                      type="button"
                      class="w-full min-h-10 px-3 rounded-lg flex items-center gap-2 text-left text-sm hover:bg-text-primary/5"
                      [class]="
                        i === dock.index()
                          ? 'bg-primary/10 text-primary-on-tint font-semibold'
                          : 'text-text-primary'
                      "
                      [attr.aria-current]="i === dock.index() ? 'true' : null"
                      [attr.aria-label]="
                        copy.queue_item(entry.position, entry.video.title, is_done(entry.video.id))
                      "
                      (click)="dock.goTo(i)"
                    >
                      <span class="w-5 shrink-0 flex justify-center">
                        @if (is_done(entry.video.id)) {
                          <app-icon name="check" [size]="14" class="text-success" />
                        } @else if (i === dock.index()) {
                          <app-icon name="play" [size]="14" />
                        } @else {
                          <span class="text-xs text-text-secondary">{{ entry.position }}</span>
                        }
                      </span>
                      <span class="flex-1 min-w-0 truncate">{{ entry.video.title }}</span>
                      @if (entry.video.duration_seconds) {
                        <span class="text-xs text-text-secondary shrink-0">
                          {{ time(entry.video.duration_seconds) }}
                        </span>
                      }
                    </button>
                  </li>
                }
              </ol>
            }
          </footer>
        }
      </section>
    }
  `,
  styles: [
    `
      .dock-btn {
        width: 2.25rem;
        height: 2.25rem;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 9999px;
        color: var(--color-text-secondary);
      }
      .dock-btn:hover {
        color: var(--color-text-primary);
        background: rgba(var(--color-primary-rgb), 0.1);
      }
      .dock-btn:focus-visible,
      .dock-chip:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
      }
      .dock-chip {
        min-height: 2.25rem;
        padding: 0 0.75rem;
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        border-radius: 9999px;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-text-primary);
        border: 1px solid var(--color-border);
        background: var(--color-surface);
      }
      .dock-chip:hover {
        border-color: var(--color-primary);
      }
      @media (prefers-reduced-motion: no-preference) {
        section {
          transition: box-shadow 0.15s ease;
        }
      }
    `,
  ],
})
export class VexMediaDockComponent {
  protected readonly dock = inject(VexMediaDockService);
  protected readonly copy = VEX_MEDIA_COPY.dock;
  private readonly injector = inject(Injector);

  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private readonly player_host = viewChild<ElementRef<HTMLElement>>('playerHost');
  private readonly fullscreen_button =
    viewChild<ElementRef<HTMLButtonElement>>('fullscreenButton');

  protected readonly is_fullscreen = computed(
    () => this.dock.state() === 'fullscreen',
  );

  /**
   * Inline sits under the 3.5rem page header; minimized floats in a corner and
   * stays above the composer below `lg`, where the composer spans the width.
   */
  protected readonly container_class = computed(() => {
    const base =
      'fixed flex flex-col gap-3 bg-surface border border-border text-text-primary';
    switch (this.dock.state()) {
      case 'fullscreen':
        return `${base} inset-0 z-50 p-4 sm:p-6 rounded-none border-0`;
      case 'minimized':
        return `${base} z-30 p-2 rounded-2xl shadow-lg right-2 w-56 bottom-[calc(7.5rem+env(safe-area-inset-bottom))] lg:right-6 lg:bottom-6 lg:w-72`;
      default:
        return `${base} z-30 p-3 rounded-2xl shadow-lg top-14 inset-x-2 max-h-[calc(100dvh-4rem)] overflow-y-auto lg:left-auto lg:right-4 lg:w-[28rem]`;
    }
  });

  protected readonly current_done = computed(() => {
    const item = this.dock.current();
    return item ? !!this.dock.progress()[item.video.id]?.completed : false;
  });

  /** Vimeo and Loom give no playback events without their SDKs. */
  protected readonly no_telemetry = computed(() => {
    const source = this.dock.current()?.video.video_source;
    return source === 'VIMEO' || source === 'LOOM';
  });

  private unbind: (() => void) | null = null;
  private ended_handled = false;
  private youtube_resumed = false;
  private return_focus: HTMLElement | null = null;
  private was_fullscreen = false;

  constructor() {
    // A new player node per video: rebind telemetry once it is rendered.
    effect(() => {
      const item = this.dock.current();
      if (!item) {
        untracked(() => this.releaseTelemetry());
        return;
      }
      untracked(() =>
        afterNextRender(() => this.bindTelemetry(), { injector: this.injector }),
      );
    });

    // Fullscreen focus management: move focus in, give it back on exit.
    effect(() => {
      const fullscreen = this.is_fullscreen();
      untracked(() => {
        if (fullscreen && !this.was_fullscreen) {
          const active = document.activeElement;
          this.return_focus = active instanceof HTMLElement ? active : null;
          afterNextRender(
            () =>
              (this.fullscreen_button()?.nativeElement ?? this.root()?.nativeElement)?.focus(),
            { injector: this.injector },
          );
        } else if (!fullscreen && this.was_fullscreen) {
          const target = this.return_focus;
          this.return_focus = null;
          afterNextRender(
            () => {
              if (target && target.isConnected) target.focus();
              else this.root()?.nativeElement.focus();
            },
            { injector: this.injector },
          );
        }
        this.was_fullscreen = fullscreen;
      });
    });

    inject(DestroyRef).onDestroy(() => this.releaseTelemetry());
  }

  protected time(seconds: number): string {
    return formatMediaTime(seconds);
  }

  protected is_done(videoId: number): boolean {
    return !!this.dock.progress()[videoId]?.completed;
  }

  protected onPlayerEnded(): void {
    this.handleEnded();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.is_fullscreen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.dock.restore();
      return;
    }
    if (event.key !== 'Tab') return;
    const root = this.root()?.nativeElement;
    if (!root) return;
    const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private handleEnded(): void {
    if (this.ended_handled) return;
    this.ended_handled = true;
    this.dock.reportEnded();
  }

  private releaseTelemetry(): void {
    this.unbind?.();
    this.unbind = null;
  }

  private bindTelemetry(): void {
    this.releaseTelemetry();
    this.ended_handled = false;
    this.youtube_resumed = false;
    const host = this.player_host()?.nativeElement;
    const item = this.dock.current();
    if (!host || !item) return;
    const controller = new AbortController();
    const { signal } = controller;
    this.unbind = () => controller.abort();

    if (item.video.video_source === 'DIRECT_S3') {
      const video = host.querySelector('video');
      if (!video) return;
      video.addEventListener(
        'loadedmetadata',
        () => {
          const at = this.dock.resume_at();
          if (at > 0 && (!Number.isFinite(video.duration) || at < video.duration - 2)) {
            video.currentTime = at;
          }
        },
        { signal, once: true },
      );
      video.addEventListener(
        'timeupdate',
        () => this.dock.reportTime(video.currentTime),
        { signal },
      );
      video.addEventListener('play', () => this.dock.reportPlaying(true), { signal });
      video.addEventListener(
        'pause',
        () => {
          if (!video.ended) this.dock.reportPlaying(false);
        },
        { signal },
      );
      return;
    }

    if (item.video.video_source === 'YOUTUBE') {
      const iframe = host.querySelector('iframe');
      if (!iframe) return;
      const post = (payload: Record<string, unknown>) =>
        iframe.contentWindow?.postMessage(JSON.stringify(payload), YOUTUBE_ORIGIN);
      const subscribe = () => post({ event: 'listening', id: 1, channel: 'widget' });
      iframe.addEventListener('load', subscribe, { signal });
      subscribe();
      window.addEventListener(
        'message',
        (event: MessageEvent) => {
          if (event.source !== iframe.contentWindow) return;
          if (event.origin !== YOUTUBE_ORIGIN) return;
          let data: unknown;
          try {
            data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          } catch {
            return;
          }
          if (typeof data !== 'object' || data === null) return;
          const message = data as { event?: string; info?: unknown };
          const info = message.info;
          if (message.event === 'onStateChange' && typeof info === 'number') {
            this.onYoutubeState(info);
            return;
          }
          if (message.event !== 'infoDelivery' || typeof info !== 'object' || info === null) {
            return;
          }
          const delivery = info as { currentTime?: number; playerState?: number };
          if (typeof delivery.playerState === 'number') {
            this.onYoutubeState(delivery.playerState);
          }
          if (typeof delivery.currentTime === 'number') {
            if (!this.youtube_resumed) {
              this.youtube_resumed = true;
              const at = this.dock.resume_at();
              if (at > 0 && delivery.currentTime < 2) {
                post({ event: 'command', func: 'seekTo', args: [at, true] });
              }
            }
            this.dock.reportTime(delivery.currentTime);
          }
        },
        { signal },
      );
    }
  }

  private onYoutubeState(state: number): void {
    if (state === 1) this.dock.reportPlaying(true);
    else if (state === 2) this.dock.reportPlaying(false);
    else if (state === 0) this.handleEnded();
  }
}
