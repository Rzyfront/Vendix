import { Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  CreateCustomerRequest,
  ExternalCustomerIdentity,
} from '../../models/customer.model';

/**
 * Prellenado de alta a partir de una identidad pública (sin correo/teléfono/régimen).
 * RNT: el nombre NO se prellena (el registro trae el establecimiento, no al titular).
 */
export function ruesIdentityToPrefill(
  identity: ExternalCustomerIdentity,
): Partial<CreateCustomerRequest> {
  if (identity.source === 'rnt') {
    return {
      document_type: identity.document_type,
      document_number: identity.document_number,
      verification_digit: identity.verification_digit,
      person_type: identity.person_type,
      legal_name: null,
      first_name: '',
      last_name: '',
    };
  }
  const juridica = identity.person_type === 'JURIDICA';
  // Persona natural sin nombres separados: sólo trae razón social
  // («APELLIDOS NOMBRES», orden no fiable). Va entera al nombre y el operador
  // la reparte; mejor eso que un formulario vacío.
  const fullNameOnly =
    !juridica && !identity.first_name && !identity.last_name ? identity.legal_name : null;
  return {
    document_type: identity.document_type,
    document_number: identity.document_number,
    verification_digit: identity.verification_digit,
    person_type: identity.person_type,
    legal_name: juridica ? identity.legal_name : null,
    first_name: juridica ? '' : (identity.first_name ?? fullNameOnly ?? ''),
    last_name: juridica ? '' : (identity.last_name ?? ''),
  };
}

/**
 * Tarjeta presentacional «Encontrado en {fuente pública}» (RUES, SECOP, RNT) compartida por el modal de
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
          <span class="text-xs font-medium text-[var(--color-text-secondary)]">{{ sourceLabel() }}</span>
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
        @if (id.source_detail) {
          <p class="mt-1 text-xs text-[var(--color-text-secondary)]">{{ id.source_detail }}</p>
        }
        @if (id.source === 'rnt' && id.trade_name) {
          <p class="mt-2 text-sm text-[var(--color-text-secondary)]">
            Establecimiento: {{ id.trade_name }} — no es el nombre del titular
          </p>
        }
        @if (inactiveWarning(); as warning) {
          <p class="mt-2 text-sm text-[var(--color-warning,#b45309)] flex items-start gap-1">
            <app-icon name="alert-triangle" [size]="16"></app-icon>
            <span>{{ warning }}</span>
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

  readonly sourceLabel = computed(() => {
    switch (this.identity()?.source) {
      case 'rues':
        return 'Encontrado en RUES';
      case 'secop_proveedores':
        return 'Encontrado en SECOP II (proveedores del Estado)';
      case 'secop_contratos':
        return 'Encontrado en SECOP (contratos con el Estado)';
      case 'rnt':
        return 'Encontrado en el Registro Nacional de Turismo';
      default:
        return 'Encontrado en fuentes públicas';
    }
  });

  readonly inactiveWarning = computed(() => {
    const id = this.identity();
    if (!id || id.is_active) return null;
    if (id.source === 'rues') return 'Matrícula cancelada en RUES: verifica los datos';
    if (id.source === 'secop_proveedores') return 'Proveedor inactivo en SECOP: verifica los datos';
    return null;
  });

  readonly displayName = computed(() => {
    const id = this.identity();
    if (!id) return '';
    const legal = id.legal_name?.trim();
    if (legal) return legal;
    const person = [id.first_name, id.last_name].filter(Boolean).join(' ').trim();
    if (person) return person;
    // RNT: el título es el establecimiento; la nota aclara que no es el titular.
    if (id.source === 'rnt' && id.trade_name?.trim()) return id.trade_name.trim();
    return id.document_number;
  });

  readonly documentLine = computed(() => {
    const id = this.identity();
    if (!id) return '';
    const dv = id.document_type === 'NIT' && id.verification_digit ? `-${id.verification_digit}` : '';
    return `${id.document_type} ${id.document_number}${dv}`;
  });
}
