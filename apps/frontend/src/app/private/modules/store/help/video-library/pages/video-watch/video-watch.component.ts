import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../../../../../shared/components/spinner/spinner.component';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { VideoLibraryService } from '../../services/video-library.service';
import { Video, TimestampBookmark } from '../../models/video.model';
import { VideoPlayerComponent } from '../../components/video-player/video-player.component';
import { VideoCardComponent } from '../../components/video-card/video-card.component';

@Component({
  selector: 'app-video-watch',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IconComponent,
    SpinnerComponent,
    VideoPlayerComponent,
    VideoCardComponent,
  ],
  template: `
    <div class="max-w-7xl mx-auto p-3 sm:p-4 md:p-6 w-full">
      <!-- Back to Feed link -->
      <a
        routerLink="/admin/help/videos"
        class="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 mb-4 transition-colors cursor-pointer"
      >
        <app-icon name="arrow-left" [size]="14"></app-icon>
        <span>Volver a la biblioteca</span>
      </a>

      @if (isLoading()) {
        <div class="flex justify-center items-center py-32">
          <app-spinner size="lg"></app-spinner>
        </div>
      } @else if (video()) {
        <!-- 70 / 30 Layout (YouTube Style) -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <!-- Main Content (70% - 8 cols) -->
          <div class="lg:col-span-8 flex flex-col gap-4">
            <!-- Universal Player -->
            <app-video-player
              [videoUrl]="video()!.video_url"
              [videoSource]="video()!.video_source"
              [externalId]="video()!.external_id"
              [seekSeconds]="seekSeconds()"
              [autoplay]="true"
            ></app-video-player>

            <!-- Video Title -->
            <h1 class="text-xl md:text-2xl font-bold text-neutral-900 dark:text-neutral-100 leading-snug">
              {{ video()!.title }}
            </h1>

            <!-- Meta & Action Bar -->
            <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-200 dark:border-neutral-800">
              <!-- Author & Category -->
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                  <app-icon name="play-circle" [size]="22"></app-icon>
                </div>
                <div class="flex flex-col">
                  <span class="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                    Vendix Academy
                  </span>
                  <span class="text-xs text-neutral-500 dark:text-neutral-400">
                    {{ video()!.category.name }}
                  </span>
                </div>
              </div>

              <!-- Action Buttons -->
              <div class="flex items-center gap-2">
                <!-- Like Button -->
                <button
                  class="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer"
                  [ngClass]="
                    isLiked()
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                  "
                  (click)="toggleLike()"
                >
                  <app-icon name="thumbs-up" [size]="15"></app-icon>
                  <span>{{ likesCount() }}</span>
                </button>

                <!-- Share Button -->
                <button
                  class="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all cursor-pointer"
                  (click)="shareVideo()"
                >
                  <app-icon name="share-2" [size]="15"></app-icon>
                  <span>Compartir</span>
                </button>
              </div>
            </div>

            <!-- Description Box with Timestamps -->
            <div class="bg-neutral-50 dark:bg-neutral-800/60 rounded-2xl p-4 border border-neutral-100 dark:border-neutral-800 text-sm">
              <div class="flex items-center gap-2 font-semibold text-xs text-neutral-700 dark:text-neutral-300 mb-2">
                <span>{{ video()!.view_count }} vistas</span>
                <span>•</span>
                <span>{{ formattedDate() }}</span>
                @if (video()!.module) {
                  <span>•</span>
                  <span class="text-primary">Módulo: {{ video()!.module }}</span>
                }
              </div>

              <!-- Summary -->
              <p class="text-neutral-800 dark:text-neutral-200 whitespace-pre-line leading-relaxed mb-3">
                {{ video()!.summary }}
              </p>

              <!-- Extended description if present -->
              @if (video()!.description) {
                <div class="text-neutral-700 dark:text-neutral-300 whitespace-pre-line leading-relaxed mb-4 border-t border-neutral-200 dark:border-neutral-700/60 pt-3">
                  {{ video()!.description }}
                </div>
              }

              <!-- Timestamps / Bookmarks (if detected) -->
              @if (timestamps().length > 0) {
                <div class="border-t border-neutral-200 dark:border-neutral-700/60 pt-3 mt-2">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-2 flex items-center gap-1.5">
                    <app-icon name="clock" [size]="13"></app-icon>
                    Capítulos y Marcas de Tiempo
                  </h4>
                  <div class="flex flex-col gap-1.5">
                    @for (ts of timestamps(); track ts.seconds) {
                      <button
                        (click)="seekTo(ts.seconds)"
                        class="flex items-center gap-2 text-xs text-left p-1.5 rounded-lg hover:bg-neutral-200/60 dark:hover:bg-neutral-700/50 transition-colors cursor-pointer group"
                      >
                        <span class="px-2 py-0.5 rounded bg-primary/10 text-primary font-mono font-semibold group-hover:bg-primary group-hover:text-white transition-colors">
                          {{ ts.formattedTime }}
                        </span>
                        <span class="text-neutral-800 dark:text-neutral-200 group-hover:text-primary transition-colors">
                          {{ ts.label }}
                        </span>
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          </div>

          <!-- Sidebar: Related Videos (30% - 4 cols) -->
          <div class="lg:col-span-4 flex flex-col gap-3">
            <h3 class="text-sm font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
              <app-icon name="layers" [size]="16" class="text-primary"></app-icon>
              <span>Videos recomendados</span>
            </h3>

            @if (relatedVideos().length > 0) {
              <div class="flex flex-col gap-2">
                @for (rel of relatedVideos(); track rel.id) {
                  <app-video-card [video]="rel" layout="horizontal"></app-video-card>
                }
              </div>
            } @else {
              <div class="p-6 text-center text-xs text-neutral-400 rounded-xl border border-dashed border-neutral-200 dark:border-neutral-800">
                No hay más videos en esta categoría por ahora.
              </div>
            }
          </div>
        </div>
      } @else {
        <div class="text-center py-20 text-neutral-500">
          Video no encontrado.
        </div>
      }
    </div>
  `,
})
export class VideoWatchComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private videoService = inject(VideoLibraryService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  video = signal<Video | null>(null);
  relatedVideos = signal<Video[]>([]);
  isLoading = signal<boolean>(true);
  seekSeconds = signal<number | null>(null);
  isLiked = signal<boolean>(false);
  likesCount = signal<number>(12);

  timestamps = computed<TimestampBookmark[]>(() => {
    const v = this.video();
    if (!v) return [];
    const text = `${v.summary || ''}\n${v.description || ''}`;
    return this.extractTimestamps(text);
  });

  formattedDate = computed(() => {
    const d = this.video()?.created_at;
    if (!d) return '';
    return new Date(d).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  });

  ngOnInit() {
    this.route.params
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const slug = params['slug'];
        if (slug) {
          this.loadVideo(slug);
        }
      });
  }

  loadVideo(slug: string) {
    this.isLoading.set(true);
    this.videoService
      .getVideoBySlug(slug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.video.set(data);
          this.relatedVideos.set(data.related_videos || []);
          this.isLoading.set(false);

          // Track view count
          this.videoService
            .incrementView(data.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe();
        },
        error: () => {
          this.video.set(null);
          this.isLoading.set(false);
        },
      });
  }

  seekTo(seconds: number) {
    this.seekSeconds.set(seconds);
  }

  toggleLike() {
    this.isLiked.update((v) => !v);
    this.likesCount.update((c) => (this.isLiked() ? c + 1 : Math.max(0, c - 1)));
  }

  shareVideo() {
    const url = window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        this.toast.success('Enlace del video copiado al portapapeles');
      });
    } else {
      this.toast.info(`Enlace: ${url}`);
    }
  }

  private extractTimestamps(text: string): TimestampBookmark[] {
    const lines = text.split('\n');
    const regex = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[-–—:]?\s*(.+)/;
    const bookmarks: TimestampBookmark[] = [];

    for (const line of lines) {
      const match = line.trim().match(regex);
      if (match) {
        let sec = 0;
        let formatted = '';
        if (match[3] !== undefined) {
          // hh:mm:ss
          sec = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10);
          formatted = `${match[1]}:${match[2]}:${match[3]}`;
        } else {
          // mm:ss
          sec = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
          formatted = `${match[1]}:${match[2]}`;
        }
        bookmarks.push({
          seconds: sec,
          formattedTime: formatted,
          label: match[4].trim(),
        });
      }
    }

    return bookmarks;
  }
}
