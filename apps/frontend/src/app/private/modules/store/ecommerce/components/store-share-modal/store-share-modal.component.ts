import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-store-share-modal',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    @if (isOpen && storeUrl) {
      <div class="modal-backdrop" (click)="close()">
        <div class="modal-content" (click)="$event.stopPropagation()">
          <!-- Header -->
          <div class="modal-header">
            <h3>Compartir Tienda</h3>
            <button class="close-btn" (click)="close()">
              <app-icon name="x" [size]="20"></app-icon>
            </button>
          </div>

          <!-- Store Preview Card -->
          <div class="store-preview" [style.background]="gradientBackground">
            <div class="store-preview-overlay"></div>
            <div class="store-preview-content">
              <div class="store-logo-wrapper">
                @if (logoUrl) {
                  <img [src]="logoUrl" [alt]="storeName" class="store-logo" />
                } @else {
                  <div class="store-logo-placeholder">
                    <app-icon name="shopping-bag" [size]="28"></app-icon>
                  </div>
                }
              </div>
              <div class="store-info">
                <span class="store-name">{{ storeName || 'Mi Tienda' }}</span>
                <span class="store-url">{{ displayUrl }}</span>
              </div>
            </div>
          </div>

          <!-- Share Options -->
          <div class="share-options">
            <button class="share-option" (click)="copyLink()">
              <div class="option-icon copy" [style.background]="copyGradient">
                <app-icon name="link" [size]="22"></app-icon>
              </div>
              <span>Copiar enlace</span>
            </button>

            <button class="share-option" (click)="shareWhatsApp()">
              <div class="option-icon whatsapp">
                <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </div>
              <span>WhatsApp</span>
            </button>

            <button class="share-option" (click)="shareEmail()">
              <div class="option-icon email">
                <app-icon name="mail" [size]="22"></app-icon>
              </div>
              <span>Correo</span>
            </button>
          </div>

          <!-- Copied Feedback -->
          @if (showCopied) {
            <div class="copied-feedback">
              <app-icon name="check" [size]="16"></app-icon>
              ¡Enlace copiado!
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: var(--z-modal-overlay);
      padding: 1rem;
      animation: fadeIn 0.15s ease-out;
    }

    .modal-content {
      background: var(--color-surface);
      border-radius: 1rem;
      width: 100%;
      max-width: 320px;
      overflow: hidden;
      animation: slideUp 0.2s ease-out;
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem;
      border-bottom: 1px solid var(--color-border);

      h3 {
        margin: 0;
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
      }

      .close-btn {
        background: none;
        border: none;
        padding: 0.25rem;
        cursor: pointer;
        color: var(--color-text-secondary);
        border-radius: var(--radius-md);
        transition: all 0.15s ease;

        &:hover {
          background: var(--color-background);
          color: var(--color-text-primary);
        }
      }
    }

    .store-preview {
      position: relative;
      padding: 1.5rem 1rem;
      overflow: hidden;
    }

    .store-preview-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.1);
    }

    .store-preview-content {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      text-align: center;
    }

    .store-logo-wrapper {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.2);
      border: 2px solid rgba(255, 255, 255, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .store-logo {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .store-logo-placeholder {
      color: rgba(255, 255, 255, 0.8);
    }

    .store-info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .store-name {
      font-size: var(--fs-base);
      font-weight: var(--fw-semibold);
      color: white;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    }

    .store-url {
      font-size: var(--fs-xs);
      color: rgba(255, 255, 255, 0.85);
      font-family: monospace;
      word-break: break-all;
    }

    .share-options {
      display: flex;
      justify-content: center;
      gap: 1.5rem;
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
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
        font-weight: var(--fw-medium);
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
      background: var(--color-success-light);
      color: var(--color-success);
      font-size: var(--fs-sm);
      font-weight: var(--fw-medium);
      animation: fadeIn 0.2s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
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
  `]
})
export class StoreShareModalComponent {
  @Input() isOpen = false;
  @Input() storeUrl: string | null = null;
  @Input() storeName = '';
  @Input() logoUrl: string | null = null;
  @Input() primaryColor = '#3B82F6';
  @Input() secondaryColor = '#10B981';
  @Input() accentColor = '#F59E0B';
  @Output() closed = new EventEmitter<void>();

  private toast = inject(ToastService);
  showCopied = false;

  get gradientBackground(): string {
    return `linear-gradient(135deg, ${this.primaryColor}, ${this.secondaryColor})`;
  }

  get copyGradient(): string {
    return `linear-gradient(135deg, ${this.primaryColor}, ${this.accentColor})`;
  }

  get displayUrl(): string {
    if (!this.storeUrl) return '';
    return this.storeUrl.replace(/^https?:\/\//, '');
  }

  get shareText(): string {
    return `¡Visita nuestra tienda en línea! ${this.storeName || 'Mi Tienda'} - ${this.storeUrl}`;
  }

  close(): void {
    this.isOpen = false;
    this.showCopied = false;
    this.closed.emit();
  }

  async copyLink(): Promise<void> {
    if (!this.storeUrl) return;
    try {
      await navigator.clipboard.writeText(this.storeUrl);
      this.showCopied = true;
      setTimeout(() => {
        this.showCopied = false;
      }, 2000);
    } catch {
      this.toast.warning('No se pudo copiar el enlace');
    }
  }

  shareWhatsApp(): void {
    const url = `https://wa.me/?text=${encodeURIComponent(this.shareText)}`;
    window.open(url, '_blank');
  }

  async shareEmail(): Promise<void> {
    const subject = `¡Visita ${this.storeName || 'nuestra tienda'}!`;
    const text = this.shareText;

    if (navigator.share) {
      try {
        await navigator.share({ title: subject, text, url: this.storeUrl || '' });
        return;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }

    const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    const opened = window.open(mailto, '_self');

    if (!opened) {
      this.toast.warning(
        'No se pudo abrir el cliente de correo. Puedes copiar el enlace y compartirlo manualmente.'
      );
    }
  }
}
