import { Component, input, output, computed } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { Video } from '../../models/video.model';

@Component({
  selector: 'app-video-card',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  template: `
    @if (layout() === 'horizontal') {
      <!-- Horizontal Compact Card (for Watch Page Sidebar) -->
      <a
        [routerLink]="['/admin/help/videos/watch', video().slug]"
        class="group flex gap-3 p-1.5 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-all duration-200 cursor-pointer"
      >
        <!-- Thumbnail 16:9 -->
        <div class="relative w-40 shrink-0 aspect-video rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800">
          <img
            [src]="thumbnailUrl()"
            [alt]="video().title"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            (error)="onImageError($event)"
          />
          @if (formattedDuration()) {
            <span class="absolute bottom-1 right-1 px-1.5 py-0.5 text-[11px] font-semibold bg-black/80 text-white rounded">
              {{ formattedDuration() }}
            </span>
          }
        </div>

        <!-- Meta -->
        <div class="flex flex-col justify-start min-w-0 flex-1 py-0.5">
          <div class="flex items-start justify-between gap-1">
            <h4 class="text-xs font-semibold text-neutral-900 dark:text-neutral-100 line-clamp-2 leading-tight group-hover:text-primary transition-colors">
              {{ video().title }}
            </h4>
            <button
              type="button"
              (click)="$event.preventDefault(); $event.stopPropagation(); shareClicked.emit(video())"
              class="p-1 rounded-md text-neutral-400 hover:text-primary hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors shrink-0"
              title="Compartir video"
              aria-label="Compartir video"
            >
              <app-icon name="share-2" [size]="13"></app-icon>
            </button>
          </div>
          <span class="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
            {{ video().category.name }}
          </span>
          <div class="flex items-center gap-1.5 text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5">
            <span>{{ formattedViews() }}</span>
            <span>•</span>
            <span>{{ relativeDate() }}</span>
          </div>
        </div>
      </a>
    } @else {
      <!-- Vertical Standard Card (for YouTube Feed) -->
      <a
        [routerLink]="['/admin/help/videos/watch', video().slug]"
        class="group flex flex-col rounded-2xl overflow-hidden hover:shadow-md transition-all duration-200 bg-surface border border-neutral-100 dark:border-neutral-800 cursor-pointer"
      >
        <!-- Thumbnail 16:9 with duration badge -->
        <div class="relative w-full aspect-video overflow-hidden bg-neutral-100 dark:bg-neutral-800">
          <img
            [src]="thumbnailUrl()"
            [alt]="video().title"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            (error)="onImageError($event)"
          />

          <!-- Hover Play Overlay -->
          <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <div class="w-11 h-11 rounded-full bg-primary text-white flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
              <app-icon name="play" [size]="20" class="translate-x-0.5"></app-icon>
            </div>
          </div>

          <!-- Duration Badge -->
          @if (formattedDuration()) {
            <span class="absolute bottom-2 right-2 px-2 py-0.5 text-xs font-semibold bg-black/80 text-white rounded-md backdrop-blur-sm">
              {{ formattedDuration() }}
            </span>
          }

          <!-- Featured Badge -->
          @if (video().is_featured) {
            <span class="absolute top-2 left-2 px-2 py-0.5 text-[11px] font-bold bg-amber-500 text-white rounded-md shadow-sm">
              Destacado
            </span>
          }
        </div>

        <!-- Content -->
        <div class="p-3.5 flex gap-3">
          <!-- Avatar Icon -->
          <div class="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 font-bold text-sm">
            <app-icon name="play-circle" [size]="20"></app-icon>
          </div>

          <!-- Details -->
          <div class="flex flex-col flex-1 min-w-0">
            <div class="flex items-start justify-between gap-1.5">
              <h3 class="text-sm font-bold text-neutral-900 dark:text-neutral-100 line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                {{ video().title }}
              </h3>
              <button
                type="button"
                (click)="$event.preventDefault(); $event.stopPropagation(); shareClicked.emit(video())"
                class="p-1.5 rounded-lg text-neutral-400 hover:text-primary hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors shrink-0"
                title="Compartir video"
                aria-label="Compartir video"
              >
                <app-icon name="share-2" [size]="14"></app-icon>
              </button>
            </div>

            <!-- Category & Module -->
            <div class="flex items-center gap-1.5 mt-1 text-xs text-neutral-500 dark:text-neutral-400 truncate">
              <span class="font-medium truncate">{{ video().category.name }}</span>
              @if (video().module) {
                <span>•</span>
                <span class="px-1.5 py-0.2 bg-neutral-100 dark:bg-neutral-800 text-[10px] rounded text-neutral-600 dark:text-neutral-300">
                  {{ video().module }}
                </span>
              }
            </div>

            <!-- Views and Date -->
            <div class="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500 mt-1">
              <span>{{ formattedViews() }}</span>
              <span>•</span>
              <span>{{ relativeDate() }}</span>
            </div>
          </div>
        </div>
      </a>
    }
  `,
})
export class VideoCardComponent {
  video = input.required<Video>();
  layout = input<'vertical' | 'horizontal'>('vertical');
  shareClicked = output<Video>();

  thumbnailUrl = computed(() => {
    const v = this.video();
    if (v.thumbnail_url) return v.thumbnail_url;
    if (v.video_source === 'YOUTUBE' && v.external_id) {
      return `https://img.youtube.com/vi/${v.external_id}/mqdefault.jpg`;
    }
    return 'assets/images/video-placeholder.jpg';
  });

  formattedDuration = computed(() => {
    const sec = this.video().duration_seconds;
    if (!sec || sec <= 0) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');

    if (h > 0) {
      return `${h}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
  });

  formattedViews = computed(() => {
    const views = this.video().view_count || 0;
    if (views === 1) return '1 vista';
    if (views < 1000) return `${views} vistas`;
    if (views < 1000000) return `${(views / 1000).toFixed(1)}k vistas`;
    return `${(views / 1000000).toFixed(1)}M vistas`;
  });

  relativeDate = computed(() => {
    const dateStr = this.video().created_at;
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return 'Hoy';
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7) return `hace ${diffDays} días`;
    if (diffDays < 30) return `hace ${Math.floor(diffDays / 7)} semanas`;
    if (diffDays < 365) return `hace ${Math.floor(diffDays / 30)} meses`;
    return `hace ${Math.floor(diffDays / 365)} años`;
  });

  onImageError(event: Event) {
    const target = event.target as HTMLImageElement;
    target.src =
      'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180" fill="%231e293b"><rect width="320" height="180"/><circle cx="160" cy="90" r="28" fill="%233b82f6"/><polygon points="152,76 174,90 152,104" fill="white"/></svg>';
  }
}
