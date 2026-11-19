import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

/**
 * Returns the URL only when the browser can load it as-is (signed S3 URL,
 * `data:` or `blob:`). A bare S3 key (e.g. a session persisted before the
 * backend signed it) would resolve against the frontend host and 404, so it
 * is treated as "no photo" until the backend returns the signed URL.
 */
export function resolveAvatarSrc(url: unknown): string | null {
  return typeof url === 'string' && /^(https?:|data:|blob:)/i.test(url.trim())
    ? url.trim()
    : null;
}

/**
 * Shows the user's photo, falling back to initials when there is no photo or
 * the image fails to load (expired signed URL, 404). It fills its parent, so
 * the parent keeps controlling size, circle shape and initials typography:
 * swapping photo ↔ initials never shifts the layout.
 */
@Component({
  selector: 'app-user-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (displaySrc(); as url) {
      <img
        [src]="url"
        [alt]="alt()"
        class="user-avatar__img"
        (error)="onImageError()"
      />
    } @else {
      <span class="user-avatar__initials">{{ initials() || fallback() }}</span>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: center;
        border-radius: inherit;
        overflow: hidden;
      }
      .user-avatar__img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: inherit;
        display: block;
      }
    `,
  ],
})
export class UserAvatarComponent {
  /** Signed URL / data: / blob: of the photo; keys and empty values show initials. */
  readonly src = input<string | null | undefined>(null);
  readonly initials = input<string>('');
  /** Shown when there are no initials either. */
  readonly fallback = input<string>('');
  readonly alt = input<string>('Foto de perfil');
  /** Emits when the photo fails to load (e.g. expired signed URL). */
  readonly loadError = output<string>();

  /** Last URL that failed; a different URL gets a fresh chance to load. */
  private readonly failedSrc = signal<string | null>(null);
  private readonly resolvedSrc = computed(() => resolveAvatarSrc(this.src()));

  readonly displaySrc = computed(() => {
    const url = this.resolvedSrc();
    return url && url !== this.failedSrc() ? url : null;
  });

  onImageError(): void {
    const url = this.resolvedSrc();
    if (!url) return;
    this.failedSrc.set(url);
    this.loadError.emit(url);
  }
}
