import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Floating Vex avatar for the store admin (agentes-admin S3).
 *
 * It is deliberately NOT a chat: no panel, no voice, no state. Tapping it is a
 * plain navigation to the dedicated Vex view (`/admin/vex`). The layout mounts
 * it only when the store turned on `vex.floating_avatar` (off by default) while
 * Vex itself is on, and only for owner/admin — the same audience
 * `vexAccessGuard` lets into `/admin/vex`.
 */
@Component({
  selector: 'app-vex-floating-avatar',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      routerLink="/admin/vex"
      class="vex-floating-avatar"
      aria-label="Abrir Vex"
      title="Abrir Vex"
      data-testid="vex-floating-avatar"
    >
      <img src="assets/vex/vexicon-96.webp" alt="" width="40" height="40" />
    </a>
  `,
  styles: [
    `
      :host {
        position: fixed;
        right: max(1rem, env(safe-area-inset-right));
        bottom: max(1rem, env(safe-area-inset-bottom));
        z-index: 40;
      }
      .vex-floating-avatar {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 3.5rem;
        height: 3.5rem;
        border-radius: 9999px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
        transition:
          transform 0.15s ease,
          box-shadow 0.15s ease;
      }
      .vex-floating-avatar:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.2);
      }
      .vex-floating-avatar:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 3px;
      }
      .vex-floating-avatar img {
        width: 2.5rem;
        height: 2.5rem;
        object-fit: contain;
      }
      @media (prefers-reduced-motion: reduce) {
        .vex-floating-avatar {
          transition: none;
        }
        .vex-floating-avatar:hover {
          transform: none;
        }
      }
    `,
  ],
})
export class VexFloatingAvatarComponent {}
