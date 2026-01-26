import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-loading',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="app-loading">
      <div class="loading-content">
        <div class="loading-logo">
          <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="32"
              cy="32"
              r="28"
              stroke="currentColor"
              stroke-width="4"
              stroke-linecap="round"
              class="loading-circle"
            />
          </svg>
        </div>
        <h2 class="loading-title">Vendix</h2>
        <p class="loading-text">Cargando aplicación...</p>
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
        background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
        position: fixed;
        top: 0;
        left: 0;
        z-index: 9999;
      }

      .loading-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
      }

      .loading-logo {
        color: #3b82f6;
        animation: pulse 2s ease-in-out infinite;
      }

      .loading-circle {
        stroke-dasharray: 175;
        stroke-dashoffset: 175;
        animation: dash 1.5s ease-in-out infinite;
      }

      .loading-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1e293b;
        margin: 0;
      }

      .loading-text {
        font-size: 0.875rem;
        color: #64748b;
        margin: 0;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }

      @keyframes dash {
        0% {
          stroke-dashoffset: 175;
        }
        50% {
          stroke-dashoffset: 0;
        }
        100% {
          stroke-dashoffset: -175;
        }
      }
    `,
  ],
})
export class AppLoadingComponent {}
