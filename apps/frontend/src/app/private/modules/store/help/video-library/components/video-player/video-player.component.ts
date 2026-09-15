import {
  Component,
  input,
  output,
  computed,
  effect,
  signal,
  viewChild,
  ElementRef,
  inject,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SpinnerComponent } from '../../../../../../../shared/components/spinner/spinner.component';
import { VideoSourceType } from '../../models/video.model';

@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [SpinnerComponent],
  template: `
    <div class="relative w-full aspect-video bg-neutral-900 rounded-2xl overflow-hidden shadow-xl border border-neutral-800">
      @if (isDirectVideo()) {
        <video
          #html5Player
          [src]="videoUrl()"
          controls
          preload="auto"
          playsinline
          [autoplay]="autoplay()"
          class="w-full h-full object-contain"
          (loadstart)="onWaiting()"
          (waiting)="onWaiting()"
          (playing)="onPlaying()"
          (canplay)="onCanPlay()"
          (ended)="onEnded()"
        ></video>
        @if (isBuffering()) {
          <div class="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950/90 backdrop-blur-sm pointer-events-none transition-opacity z-20">
            <app-spinner size="lg"></app-spinner>
            <span class="text-xs text-white/90 mt-3 font-medium">Cargando video...</span>
          </div>
        }
      } @else if (embedUrl()) {
        <iframe
          #iframePlayer
          [src]="embedUrl()!"
          class="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
        ></iframe>
      } @else {
        <div class="w-full h-full flex items-center justify-center text-neutral-400 text-sm">
          No se pudo cargar la fuente del video
        </div>
      }
    </div>
  `,
  styles: [
    `
      /* Suprimir el círculo/botón de carga central nativo del Shadow DOM de Chromium */
      video::-webkit-media-controls-overlay-play-button,
      video::-webkit-media-controls-overlay-enclosure {
        display: none !important;
        -webkit-appearance: none;
      }
    `,
  ],
})
export class VideoPlayerComponent {
  private sanitizer = inject(DomSanitizer);

  videoUrl = input.required<string>();
  videoSource = input<VideoSourceType>('YOUTUBE');
  externalId = input<string | null | undefined>(null);
  autoplay = input<boolean>(false);
  seekSeconds = input<number | null>(null);

  ended = output<void>();

  html5Player = viewChild<ElementRef<HTMLVideoElement>>('html5Player');
  iframePlayer = viewChild<ElementRef<HTMLIFrameElement>>('iframePlayer');

  isBuffering = signal<boolean>(false);
  isDirectVideo = computed(() => this.videoSource() === 'DIRECT_S3');

  embedUrl = computed<SafeResourceUrl | null>(() => {
    const source = this.videoSource();
    const id = this.externalId() || this.extractIdFromUrl(this.videoUrl(), source);
    const auto = this.autoplay() ? 1 : 0;

    if (source === 'YOUTUBE' && id) {
      return this.sanitizer.bypassSecurityTrustResourceUrl(
        `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&rel=0&modestbranding=1&autoplay=${auto}`,
      );
    }

    if (source === 'LOOM' && id) {
      return this.sanitizer.bypassSecurityTrustResourceUrl(
        `https://www.loom.com/embed/${id}?autoplay=${auto}`,
      );
    }

    if (source === 'VIMEO' && id) {
      return this.sanitizer.bypassSecurityTrustResourceUrl(
        `https://player.vimeo.com/video/${id}?autoplay=${auto}`,
      );
    }

    return null;
  });

  constructor() {
    // Effect to handle seeking when seekSeconds input changes
    effect(() => {
      const sec = this.seekSeconds();
      if (sec === null || sec === undefined) return;

      if (this.isDirectVideo()) {
        const video = this.html5Player()?.nativeElement;
        if (video) {
          video.currentTime = sec;
          video.play().catch(() => {});
        }
      } else {
        const iframe = this.iframePlayer()?.nativeElement;
        if (iframe && iframe.contentWindow) {
          if (this.videoSource() === 'YOUTUBE') {
            iframe.contentWindow.postMessage(
              JSON.stringify({
                event: 'command',
                func: 'seekTo',
                args: [sec, true],
              }),
              '*',
            );
            iframe.contentWindow.postMessage(
              JSON.stringify({
                event: 'command',
                func: 'playVideo',
                args: [],
              }),
              '*',
            );
          }
        }
      }
    });
  }

  onWaiting() {
    this.isBuffering.set(true);
  }

  onPlaying() {
    this.isBuffering.set(false);
  }

  onCanPlay() {
    this.isBuffering.set(false);
  }

  onEnded() {
    this.ended.emit();
  }

  private extractIdFromUrl(url: string, source: VideoSourceType): string | null {
    if (!url) return null;
    if (source === 'YOUTUBE') {
      const match = url.match(
        /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      );
      return match ? match[1] : null;
    }
    if (source === 'LOOM') {
      const match = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
      return match ? match[1] : null;
    }
    if (source === 'VIMEO') {
      const match = url.match(/vimeo\.com\/(\d+)/);
      return match ? match[1] : null;
    }
    return null;
  }
}
