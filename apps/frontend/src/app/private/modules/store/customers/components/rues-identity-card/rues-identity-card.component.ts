import { Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  CreateCustomerRequest,
  ExternalCustomerIdentity,
} from '../../models/customer.model';

/** Prellenado de alta a partir de una identidad RUES (sin correo/teléfono/régimen). */
export function ruesIdentityToPrefill(
  identity: ExternalCustomerIdentity,
): Partial<CreateCustomerRequest> {
  const juridica = identity.person_type === 'JURIDICA';
  return {
    document_type: identity.document_type,
    document_number: identity.document_number,
    verification_digit: identity.verification_digit,
    person_type: identity.person_type,
    legal_name: juridica ? identity.legal_name : null,
    first_name: juridica ? '' : (identity.first_name ?? ''),
    last_name: juridica ? '' : (identity.last_name ?? ''),
  };
}

/**
 * Tarjeta presentacional «Encontrado en RUES» compartida por el modal de
 * cliente del POS y el modal «Cambiar titular».
 */
@Component({
  selector: 'app-rues-identity-card',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  template: `
    @if (identity(); as id) {
      <div class="mt-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
        <div class="flex items-center gap-2 mb-1">
          <app-icon name="check-circle" [size]="16"></app-icon>
          <span class="text-xs font-medium text-[var(--color-text-secondary)]">Encontrado en RUES</span>
        </div>
        <p class="font-medium text-[var(--color-text-primary)] break-words">{{ displayName() }}</p>
        <div class="flex flex-wrap items-center gap-2 mt-1">
          <span class="text-sm text-[var(--color-neutral-600)]">{{ documentLine() }}</span>
          @if (id.registration_status) {
            <span
              class="text-xs px-2 py-0.5 rounded-full"
              [class]="id.is_active
                ? 'bg-[var(--color-success-light,#dcfce7)] text-[var(--color-success,#15803d)]'
                : 'bg-[var(--color-warning-light,#fef3c7)] text-[var(--color-warning,#b45309)]'"
            >{{ id.registration_status }}</span>
          }
        </div>
        @if (!id.is_active) {
          <p class="mt-2 text-sm text-[var(--color-warning,#b45309)] flex items-start gap-1">
            <app-icon name="alert-triangle" [size]="16"></app-icon>
            <span>Matrícula cancelada en RUES: verifica los datos</span>
          </p>
        }
        <div class="flex flex-col sm:flex-row gap-2 mt-3">
          <app-button variant="primary" size="sm" customClasses="min-h-[44px]" (clicked)="createWithData.emit()">
            Crear con estos datos
          </app-button>
          <app-button variant="outline" size="sm" customClasses="min-h-[44px]" (clicked)="createManual.emit()">
            Crear manualmente
          </app-button>
        </div>
      </div>
    }
  `,
})
export class RuesIdentityCardComponent {
  readonly identity = input<ExternalCustomerIdentity | null>(null);
  readonly createWithData = output<void>();
  readonly createManual = output<void>();

  readonly displayName = computed(() => {
    const id = this.identity();
    if (!id) return '';
    const legal = id.legal_name?.trim();
    if (legal) return legal;
    return [id.first_name, id.last_name].filter(Boolean).join(' ').trim() || id.document_number;
  });

  readonly documentLine = computed(() => {
    const id = this.identity();
    if (!id) return '';
    const dv = id.document_type === 'NIT' && id.verification_digit ? `-${id.verification_digit}` : '';
    return `${id.document_type} ${id.document_number}${dv}`;
  });
}
