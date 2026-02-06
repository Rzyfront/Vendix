import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { EcommerceProduct } from '../../services/catalog.service';

@Component({
  selector: 'app-share-modal',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    @if (isOpen && product) {
      <div class="modal-backdrop" (click)="close()">
        <div class="modal-content" (click)="$event.stopPropagation()">
          <!-- Header -->
          <div class="modal-header">
            <h3>Compartir producto</h3>
            <button class="close-btn" (click)="close()">
              <app-icon name="x" [size]="20"></app-icon>
            </button>
          </div>

          <!-- Product preview -->
          <div class="product-preview">
            @if (product.image_url) {
              <img [src]="product.image_url" [alt]="product.name">
            } @else {
              <div class="no-image">
                <app-icon name="image" [size]="24"></app-icon>
              </div>
            }
            <div class="product-info">
              <span class="product-name">{{ product.name }}</span>
              <span class="product-price">{{ product.final_price | currency }}</span>
            </div>
          </div>

          <!-- Share options -->
          <div class="share-options">
            <button class="share-option" (click)="copyLink()">
              <div class="option-icon copy">
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

          <!-- Copied feedback -->
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
      z-index: 1000;
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

    .product-preview {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem;
      background: var(--color-background);

      img {
        width: 56px;
        height: 56px;
        object-fit: cover;
        border-radius: var(--radius-md);
      }

      .no-image {
        width: 56px;
        height: 56px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-surface);
        border-radius: var(--radius-md);
        color: var(--color-text-muted);
      }

      .product-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .product-name {
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        color: var(--color-text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .product-price {
        font-size: var(--fs-sm);
        font-weight: var(--fw-bold);
        color: var(--color-primary);
      }
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
export class ShareModalComponent {
  @Input() isOpen = false;
  @Input() product: EcommerceProduct | null = null;
  @Output() closed = new EventEmitter<void>();

  showCopied = false;

  get productUrl(): string {
    if (!this.product) return '';
    return `${window.location.origin}/catalog/${this.product.slug}`;
  }

  get shareText(): string {
    if (!this.product) return '';
    return `¡Mira este producto! ${this.product.name} - ${this.productUrl}`;
  }

  close(): void {
    this.isOpen = false;
    this.showCopied = false;
    this.closed.emit();
  }

  async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.productUrl);
      this.showCopied = true;
      setTimeout(() => {
        this.showCopied = false;
      }, 2000);
    } catch (err) {
      console.error('Error copying link:', err);
    }
  }

  shareWhatsApp(): void {
    const url = `https://wa.me/?text=${encodeURIComponent(this.shareText)}`;
    window.open(url, '_blank');
  }

  shareEmail(): void {
    const subject = encodeURIComponent(`¡Mira este producto! ${this.product?.name}`);
    const body = encodeURIComponent(this.shareText);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }
}
