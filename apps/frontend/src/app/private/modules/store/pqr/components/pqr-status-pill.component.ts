import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PqrStatus } from '../../../../../shared/services/pqr.service';

/**
 * Compact pill that renders a PQR status with a consistent color scheme.
 * Color palette is hand-picked to match Vendix's design tokens (slate / amber
 * / emerald / rose) without depending on Tailwind classes.
 */
@Component({
  selector: 'app-pqr-status-pill',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="pqr-status-pill" [attr.data-status]="status()">
      {{ label() }}
    </span>
  `,
  styles: [
    `
      .pqr-status-pill {
        display: inline-flex;
        align-items: center;
        padding: 0.125rem 0.625rem;
        border-radius: 9999px;
        font-size: 0.7rem;
        font-weight: 600;
        line-height: 1.4;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      .pqr-status-pill[data-status='NEW'] {
        background: #fef3c7;
        color: #92400e;
      }
      .pqr-status-pill[data-status='OPEN'],
      .pqr-status-pill[data-status='IN_PROGRESS'] {
        background: #dbeafe;
        color: #1e40af;
      }
      .pqr-status-pill[data-status='WAITING_RESPONSE'] {
        background: #ede9fe;
        color: #5b21b6;
      }
      .pqr-status-pill[data-status='RESOLVED'] {
        background: #d1fae5;
        color: #065f46;
      }
      .pqr-status-pill[data-status='CLOSED'] {
        background: #e5e7eb;
        color: #374151;
      }
      .pqr-status-pill[data-status='REOPENED'] {
        background: #fee2e2;
        color: #991b1b;
      }
    `,
  ],
})
export class PqrStatusPillComponent {
  readonly status = input.required<PqrStatus>();

  readonly label = computed(() => {
    switch (this.status()) {
      case 'NEW':
        return 'Nuevo';
      case 'OPEN':
        return 'Abierto';
      case 'IN_PROGRESS':
        return 'En progreso';
      case 'WAITING_RESPONSE':
        return 'Esperando respuesta';
      case 'RESOLVED':
        return 'Respondida';
      case 'CLOSED':
        return 'Cerrada';
      case 'REOPENED':
        return 'Reabierta';
      default:
        return this.status();
    }
  });
}