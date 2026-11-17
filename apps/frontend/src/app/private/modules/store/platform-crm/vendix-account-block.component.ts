import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  BadgeComponent,
  ButtonComponent,
  DialogService,
  IconComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../shared/components';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import { CustomerSectionComponent } from '../customers/components/customer-section/customer-section.component';
import { PlatformCrmService } from './platform-crm.service';
import {
  PlatformCrmLinkView,
  PlatformOrganizationSubscription,
  canManageVendixAccount,
} from './platform-crm.interface';
import { VendixAccountLinkModalComponent } from './vendix-account-link-modal.component';

const SUBSCRIPTION_STATE_LABELS: Record<string, string> = {
  draft: 'Borrador',
  trial: 'En prueba',
  active: 'Activa',
  grace_soft: 'En gracia',
  grace_hard: 'En gracia (final)',
  suspended: 'Suspendida',
  blocked: 'Bloqueada',
  cancelled: 'Cancelada',
  expired: 'Vencida',
  pending_payment: 'Pago pendiente',
};

const ORGANIZATION_STATE_LABELS: Record<string, string> = {
  active: 'Activa',
  inactive: 'Inactiva',
  suspended: 'Suspendida',
  archived: 'Archivada',
  draft: 'Borrador',
};

/** Fecha de un instante (fin de periodo o de trial) en hora de Colombia. */
function formatInstantDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Bogota',
  });
}

type BlockState = 'loading' | 'ready' | 'error' | 'hidden';

/**
 * Bloque "Cuenta Vendix" de la ficha CRM del cliente (solo Vendix Platform).
 *
 * El panel lo monta únicamente con `platform:crm_link:read`. Si aun así el
 * backend responde 404 (otra tienda, o el cliente no es del CRM plataforma)
 * el bloque desaparece: nunca muestra un error que delate la función.
 */
@Component({
  selector: 'app-vendix-account-block',
  standalone: true,
  imports: [
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    SpinnerComponent,
    CustomerSectionComponent,
    VendixAccountLinkModalComponent,
  ],
  template: `
    @if (state() !== 'hidden') {
      <app-customer-section
        title="Cuenta Vendix"
        icon="building-2"
        hint="Organización que este cliente creó y paga en Vendix."
      >
        @if (state() === 'loading') {
          <div class="flex justify-center py-4"><app-spinner size="sm"></app-spinner></div>
        } @else if (state() === 'error') {
          <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
            <span>No pudimos cargar la cuenta Vendix.</span>
            <app-button variant="outline" size="sm" (clicked)="reload()">Reintentar</app-button>
          </div>
        } @else if (view()?.link && view()?.organization) {
          <div class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <app-badge variant="success" size="sm">Cliente consolidado</app-badge>
              <span class="font-semibold text-text-primary">{{ view()!.organization!.name }}</span>
              <app-badge variant="neutral" size="xs">{{ organizationState() }}</app-badge>
            </div>

            @for (sub of view()!.organization!.subscriptions; track $index) {
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span class="text-text-secondary">{{ sub.store_name }}</span>
                <span class="font-medium text-text-primary">{{ sub.plan_name || 'Sin plan' }}</span>
                @if (sub.state) {
                  <app-badge variant="neutral" size="xs">{{ subscriptionState(sub) }}</app-badge>
                }
                @if (renewalText(sub); as renewal) {
                  <span class="text-xs text-text-secondary">{{ renewal }}</span>
                }
              </div>
            } @empty {
              <p class="text-sm text-text-secondary">La organización aún no tiene tiendas con suscripción.</p>
            }

            @if (view()!.link!.note) {
              <p class="text-sm text-text-secondary">{{ view()!.link!.note }}</p>
            }

            @if (canManage()) {
              <div class="flex justify-end">
                <app-button variant="outline" size="sm" [loading]="unlinking()" (clicked)="unlink()">
                  <app-icon slot="icon" name="x-circle" [size]="14"></app-icon>
                  Desenlazar
                </app-button>
              </div>
            }
          </div>
        } @else {
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-text-secondary">Sin cuenta Vendix enlazada.</span>
            @if (canManage()) {
              <app-button variant="primary" size="sm" (clicked)="modalOpen.set(true)">
                <app-icon slot="icon" name="link" [size]="14"></app-icon>
                Enlazar con cuenta Vendix
              </app-button>
            }
          </div>
        }
      </app-customer-section>

      @if (canManage()) {
        <app-vendix-account-link-modal
          [customerId]="customerId()"
          [isOpen]="modalOpen()"
          (isOpenChange)="modalOpen.set($event)"
          (linked)="onLinked($event)"
        ></app-vendix-account-link-modal>
      }
    }
  `,
})
export class VendixAccountBlockComponent {
  private readonly service = inject(PlatformCrmService);
  private readonly auth = inject(AuthFacade);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);

  readonly customerId = input.required<number>();

  protected readonly state = signal<BlockState>('loading');
  protected readonly view = signal<PlatformCrmLinkView | null>(null);
  protected readonly modalOpen = signal(false);
  protected readonly unlinking = signal(false);
  protected readonly canManage = computed(() => canManageVendixAccount(this.auth));
  protected readonly organizationState = computed(() => {
    const state = this.view()?.organization?.state ?? '';
    return ORGANIZATION_STATE_LABELS[state] ?? state;
  });

  constructor() {
    effect(() => {
      const id = this.customerId();
      untracked(() => void this.load(id));
    });
  }

  protected reload(): void {
    void this.load(this.customerId());
  }

  private async load(customerId: number): Promise<void> {
    this.state.set('loading');
    try {
      const view = await firstValueFrom(this.service.getLink(customerId));
      if (customerId !== this.customerId()) return;
      this.view.set(view);
      this.state.set('ready');
    } catch (error) {
      if (customerId !== this.customerId()) return;
      this.view.set(null);
      this.state.set(
        error instanceof HttpErrorResponse && error.status === 404 ? 'hidden' : 'error',
      );
    }
  }

  protected onLinked(view: PlatformCrmLinkView): void {
    this.view.set(view);
    this.state.set('ready');
  }

  protected async unlink(): Promise<void> {
    const organization = this.view()?.organization;
    if (!organization || this.unlinking()) return;
    const confirmed = await this.dialog.confirm({
      title: 'Desenlazar cuenta Vendix',
      message: `El cliente deja de estar enlazado con ${organization.name}. El historial del enlace se conserva y puedes volver a enlazarlo.`,
      confirmText: 'Desenlazar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.unlinking.set(true);
    try {
      this.view.set(await firstValueFrom(this.service.unlink(this.customerId())));
      this.toast.success('Enlace deshecho');
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.unlinking.set(false);
    }
  }

  protected subscriptionState(sub: PlatformOrganizationSubscription): string {
    return sub.state ? (SUBSCRIPTION_STATE_LABELS[sub.state] ?? sub.state) : '';
  }

  protected renewalText(sub: PlatformOrganizationSubscription): string {
    if (sub.state === 'trial' && sub.trial_ends_at) {
      return `Trial hasta ${formatInstantDate(sub.trial_ends_at)}`;
    }
    if (sub.current_period_end) {
      return `Renueva ${formatInstantDate(sub.current_period_end)}`;
    }
    return '';
  }
}
