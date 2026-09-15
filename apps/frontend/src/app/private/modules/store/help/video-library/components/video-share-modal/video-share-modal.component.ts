import { Component, model, input, output, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { Video } from '../../models/video.model';

@Component({
  selector: 'app-video-share-modal',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    @if (isOpen() && video()) {
      <div class="modal-backdrop" (click)="close()">
        <div class="modal-content" (click)="$event.stopPropagation()">
          <!-- Header -->
          <div class="modal-header">
            <h3>Compartir video</h3>
            <button class="close-btn" (click)="close()" type="button" aria-label="Cerrar">
              <app-icon name="x" [size]="20"></app-icon>
            </button>
          </div>

          <!-- Video preview -->
          <div class="video-preview">
            @if (thumbnailUrl()) {
              <div class="video-thumb-container">
                <img [src]="thumbnailUrl()" [alt]="video()?.title" class="video-thumb" />
                @if (formattedDuration()) {
                  <span class="duration-badge">{{ formattedDuration() }}</span>
                }
              </div>
            } @else {
              <div class="no-thumb">
                <app-icon name="play-circle" [size]="26"></app-icon>
              </div>
            }
            <div class="video-info">
              <span class="video-title">{{ video()?.title }}</span>
              <div class="video-meta">
                <span class="video-category">{{ video()?.category?.name }}</span>
                @if (video()?.module) {
                  <span class="meta-dot">•</span>
                  <span class="video-module">{{ video()?.module }}</span>
                }
              </div>
            </div>
          </div>

          <!-- Share options -->
          <div class="share-options">
            <button class="share-option" (click)="copyLink()" type="button">
              <div class="option-icon copy">
                <app-icon name="link" [size]="22"></app-icon>
              </div>
              <span>Copiar enlace</span>
            </button>

            <button class="share-option" (click)="shareWhatsApp()" type="button">
              <div class="option-icon whatsapp">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="22"
                  height="22"
                >
                  <path
                    d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
                  />
                </svg>
              </div>
              <span>WhatsApp</span>
            </button>

            <button class="share-option" (click)="shareEmail()" type="button">
              <div class="option-icon email">
                <app-icon name="mail" [size]="22"></app-icon>
              </div>
              <span>Correo</span>
            </button>
          </div>

          <!-- Copied feedback -->
          @if (showCopied()) {
            <div class="copied-feedback">
              <app-icon name="check" [size]="16"></app-icon>
              ¡Enlace del video copiado!
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: var(--z-modal-overlay, 9999);
        padding: 1rem;
        animation: fadeIn 0.15s ease-out;
      }

      .modal-content {
        background: var(--color-surface, #ffffff);
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 1.25rem;
        width: 100%;
        max-width: 380px;
        overflow: hidden;
        animation: slideUp 0.2s ease-out;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      }

      .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid var(--color-border, #f3f4f6);

        h3 {
          margin: 0;
          font-size: var(--fs-base, 1rem);
          font-weight: 600;
          color: var(--color-text-primary, #111827);
        }

        .close-btn {
          background: none;
          border: none;
          padding: 0.25rem;
          cursor: pointer;
          color: var(--color-text-secondary, #6b7280);
          border-radius: 0.375rem;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;

          &:hover {
            background: var(--color-background, #f9fafb);
            color: var(--color-text-primary, #111827);
          }
        }
      }

      .video-preview {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        padding: 1rem 1.25rem;
        background: var(--color-background, #f9fafb);
        border-bottom: 1px solid var(--color-border, #f3f4f6);
      }

      .video-thumb-container {
        position: relative;
        width: 72px;
        aspect-ratio: 16 / 9;
        flex-shrink: 0;
        border-radius: 0.5rem;
        overflow: hidden;
        background: #1e293b;

        .video-thumb {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .duration-badge {
          position: absolute;
          bottom: 2px;
          right: 2px;
          background: rgba(0, 0, 0, 0.8);
          color: white;
          font-size: 9px;
          font-weight: 600;
          padding: 1px 3px;
          border-radius: 2px;
        }
      }

      .no-thumb {
        width: 72px;
        aspect-ratio: 16 / 9;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1e293b;
        color: #94a3b8;
        border-radius: 0.5rem;
      }

      .video-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .video-title {
        font-size: var(--fs-sm, 0.875rem);
        font-weight: 600;
        color: var(--color-text-primary, #111827);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        line-height: 1.25;
      }

      .video-meta {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 11px;
        color: var(--color-text-secondary, #6b7280);
      }

      .video-category {
        font-weight: 500;
        color: var(--color-primary, #2563eb);
      }

      .meta-dot {
        opacity: 0.6;
      }

      .video-module {
        background: rgba(0, 0, 0, 0.05);
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 10px;
      }

      .share-options {
        display: flex;
        justify-content: center;
        gap: 1.75rem;
        padding: 1.5rem 1rem;
      }

      .share-option {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        background: none;
        border: none;
        cursor: pointer;
        transition: transform 0.15s ease;

        &:hover {
          transform: scale(1.05);
        }

        &:active {
          transform: scale(0.95);
        }

        span {
          font-size: var(--fs-xs, 0.75rem);
          color: var(--color-text-secondary, #6b7280);
          font-weight: 500;
        }
      }

      .option-icon {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;

        &.copy {
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
        }

        &.whatsapp {
          background: linear-gradient(135deg, #25d366, #128c7e);
        }

        &.email {
          background: linear-gradient(135deg, #f59e0b, #d97706);
        }
      }

      .copied-feedback {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.75rem;
        background: var(--color-success-light, #ecfdf5);
        color: var(--color-success, #059669);
        font-size: var(--fs-sm, 0.875rem);
        font-weight: 500;
        animation: fadeIn 0.2s ease-out;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(20px) scale(0.95);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
    `,
  ],
})
export class VideoShareModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly video = input<Video | null>(null);
  readonly closed = output<void>();

  private toast = inject(ToastService);
  readonly showCopied = signal(false);

  /**
   * Genera la URL canónica de Vendix donde se reproduce el video.
   * NUNCA devuelve la URL externa directa de YouTube.
   */
  get videoUrl(): string {
    const v = this.video();
    if (!v) return '';
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/admin/help/videos/watch/${v.slug}`;
  }

  get shareText(): string {
    const v = this.video();
    if (!v) return '';
    return `¡Mira este video tutorial en Vendix! ${v.title}\n${this.videoUrl}`;
  }

  thumbnailUrl = computed(() => {
    const v = this.video();
    if (!v) return '';
    if (v.thumbnail_url) return v.thumbnail_url;
    if (v.video_source === 'YOUTUBE' && v.external_id) {
      return `https://img.youtube.com/vi/${v.external_id}/mqdefault.jpg`;
    }
    return '';
  });

  formattedDuration = computed(() => {
    const sec = this.video()?.duration_seconds;
    if (!sec || sec <= 0) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  });

  close(): void {
    this.isOpen.set(false);
    this.showCopied.set(false);
    this.closed.emit();
  }

  async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.videoUrl);
      this.showCopied.set(true);
      setTimeout(() => {
        this.showCopied.set(false);
      }, 2000);
    } catch (err) {
      console.error('Error copying link:', err);
      this.toast.error('No se pudo copiar el enlace');
    }
  }

  shareWhatsApp(): void {
    const url = `https://wa.me/?text=${encodeURIComponent(this.shareText)}`;
    window.open(url, '_blank');
  }

  async shareEmail(): Promise<void> {
    const v = this.video();
    if (!v) return;
    const subject = `Video tutorial Vendix: ${v.title}`;
    const text = this.shareText;
    const url = this.videoUrl;

    if (navigator.share) {
      try {
        await navigator.share({ title: subject, text, url });
        return;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }

    const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    const opened = window.open(mailto, '_self');
    if (!opened) {
      this.toast.warning(
        'No se pudo abrir el cliente de correo. Puedes copiar el enlace y compartirlo manualmente.',
      );
    }
  }
}
