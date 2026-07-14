import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Angular bootstrap splash. Rendered while the app resolves its final view,
 * right after the static pre-Angular gate in index.html is removed.
 *
 * It is intentionally a PIXEL-FOR-PIXEL match of the index.html gate splash
 * (same #f4f4f4 background, same triple-ring Vendix loader + centered logo) so
 * the static -> Angular handoff produces no flicker. Colors are the hardcoded
 * Vendix DEFAULT green tones (not tenant branding, which is not yet applied at
 * bootstrap time) so both splashes stay identical.
 */
@Component({
  selector: 'app-loading',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app-loading">
      <div class="app-loading-wrap">
        <span class="app-loading-ring"></span>
        <img
          class="app-loading-logo"
          src="/vlogomono.png"
          alt="Vendix"
          width="22"
          height="22"
        />
      </div>
    </div>
  `,
  styles: [
    `
      .app-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        width: 100vw;
        background: #f4f4f4;
        position: fixed;
        top: 0;
        left: 0;
        z-index: 9999;
      }

      .app-loading-wrap {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 58px;
        height: 58px;
      }

      /* Triple-ring Vendix loader — identical to the index.html gate. */
      .app-loading-ring {
        --v-size: 1.2px;
        width: calc(48 * var(--v-size));
        height: calc(48 * var(--v-size));
        border-radius: 50%;
        display: inline-block;
        position: relative;
        box-sizing: border-box;
        border: calc(3 * var(--v-size)) solid;
        border-color: #108a15 #108a15 transparent transparent;
        animation: app-loading-rot 1s linear infinite;
      }

      .app-loading-ring::after,
      .app-loading-ring::before {
        content: '';
        box-sizing: border-box;
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        bottom: 0;
        margin: auto;
        border: calc(3 * var(--v-size)) solid;
        border-color: transparent transparent #cbd5e1 #cbd5e1;
        width: calc(40 * var(--v-size));
        height: calc(40 * var(--v-size));
        border-radius: 50%;
        animation: app-loading-rot-back 0.5s linear infinite;
        transform-origin: center center;
      }

      .app-loading-ring::before {
        width: calc(32 * var(--v-size));
        height: calc(32 * var(--v-size));
        border-color: #2ecc71 #2ecc71 transparent transparent;
        animation: app-loading-rot 1.5s linear infinite;
      }

      .app-loading-logo {
        position: absolute;
        width: 22px;
        height: 22px;
        object-fit: contain;
        pointer-events: none;
      }

      @keyframes app-loading-rot {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      @keyframes app-loading-rot-back {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(-360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .app-loading-ring,
        .app-loading-ring::after,
        .app-loading-ring::before {
          animation: none !important;
        }
      }
    `,
  ],
})
export class AppLoadingComponent {}
