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
  CoveredStore,
  PlatformCrmLinkItem,
  PlatformOrganizationSubscription,
  canManageVendixAccount,
  organizationStateLabel,
  subscriptionStateLabel,
} from './platform-crm.interface';
import { VendixAccountLinkModalComponent } from './vendix-account-link-modal.component';
import { VendixAccountMovementsComponent } from './vendix-account-movements.component';
import { VendixAccountActivityComponent } from './vendix-account-activity.component';

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

/** Tope del backend (`UnlinkPlatformCustomerDto.reason`). */
const MAX_REASON = 300;

type BlockState = 'loading' | 'ready' | 'error' | 'hidden';

/**
 * Bloque "Cuenta Vendix" de la ficha CRM del cliente (solo Vendix Platform).
 *
 * Un cliente puede tener varias cuentas enlazadas (organizaciones completas
 * y/o tiendas sueltas): una tarjeta por cuenta, cada una con su desenlace.
 * Debajo, los movimientos de la suscripción y la actividad de cada comercio
 * (esta última carga diferida al entrar en pantalla).
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
    VendixAccountMovementsComponent,
    VendixAccountActivityComponent,
  ],
  template: `
    @if (state() !== 'hidden') {
      <app-customer-section
        title="Cuenta Vendix"
        icon="building-2"
        hint="Organizaciones o tiendas que este cliente creó y paga en Vendix."
      >
        @if (state() === 'loading') {
          <div class="flex justify-center py-4"><app-spinner size="sm"></app-spinner></div>
        } @else if (state() === 'error') {
          <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
            <span>No pudimos cargar la cuenta Vendix.</span>
            <app-button variant="outline" size="sm" (clicked)="reload()">Reintentar</app-button>
          </div>
        } @else if (links().length) {
          <div class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <app-badge variant="success" size="sm">Cliente consolidado</app-badge>
                <span class="text-sm text-text-secondary">{{ countLabel() }}</span>
              </div>
              @if (canManage()) {
                <app-button variant="outline" size="sm" (clicked)="modalOpen.set(true)">
                  <app-icon slot="icon" name="link" [size]="14"></app-icon>
                  Enlazar otra cuenta
                </app-button>
              }
            </div>

            @for (item of links(); track item.id) {
              <article
                class="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
                data-testid="vendix-account-card"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-text-primary">
                    {{ item.organization?.name || 'Organización no disponible' }}
                  </span>
                  @if (item.organization) {
                    <app-badge variant="neutral" size="xs">{{ organizationState(item) }}</app-badge>
                  }
                </div>

                <p class="text-sm text-text-secondary" data-testid="vendix-account-scope">
                  @if (item.linked_store; as store) {
                    Tienda
                    <span class="font-medium text-text-primary">{{ store.name }}</span>
                    de esta organización.
                  } @else {
                    Organización completa.
                  }
                </p>

                @for (sub of item.organization?.subscriptions ?? []; track $index) {
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
                  <p class="text-sm text-text-secondary">Aún no tiene tiendas con suscripción.</p>
                }

                @if (item.note) {
                  <p class="text-sm text-text-secondary">{{ item.note }}</p>
                }

                @if (canManage()) {
                  <div class="flex justify-end">
                    <app-button
                      variant="outline"
                      size="sm"
                      [loading]="unlinkingId() === item.id"
                      [disabled]="unlinkingId() !== null && unlinkingId() !== item.id"
                      (clicked)="unlink(item)"
                    >
                      <app-icon slot="icon" name="x-circle" [size]="14"></app-icon>
                      Desenlazar
                    </app-button>
                  </div>
                }
              </article>
            }

            <app-vendix-account-movements
              class="mt-2 block"
              [customerId]="customerId()"
              [reloadKey]="linksKey()"
              (storesLoaded)="coveredStores.set($event)"
            ></app-vendix-account-movements>

            @defer (on viewport) {
              <app-vendix-account-activity
                class="mt-2 block"
                [customerId]="customerId()"
                [stores]="coveredStores()"
              ></app-vendix-account-activity>
            } @placeholder {
              <div class="h-24" aria-hidden="true"></div>
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
          [linkedAccounts]="links()"
          [isOpen]="modalOpen()"
          (isOpenChange)="modalOpen.set($event)"
          (linked)="reload()"
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
  protected readonly links = signal<PlatformCrmLinkItem[]>([]);
  protected readonly modalOpen = signal(false);
  /** Enlace que se está desenlazando (uno a la vez). */
  protected readonly unlinkingId = signal<number | null>(null);
  protected readonly canManage = computed(() => canManageVendixAccount(this.auth));
  /** Cambia al enlazar o desenlazar: el historial vuelve a cargarse. */
  protected readonly linksKey = computed(() => this.links().map((l) => l.id).join(','));
  /** Comercios cubiertos, según el historial; alimentan el selector de Actividad. */
  protected readonly coveredStores = signal<CoveredStore[]>([]);
  protected readonly countLabel = computed(() => {
    const count = this.links().length;
    return count === 1 ? '1 cuenta enlazada' : `${count} cuentas enlazadas`;
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
      const { links } = await firstValueFrom(this.service.getLinks(customerId));
      if (customerId !== this.customerId()) return;
      this.links.set(links);
      this.state.set('ready');
    } catch (error) {
      if (customerId !== this.customerId()) return;
      this.links.set([]);
      this.state.set(
        error instanceof HttpErrorResponse && error.status === 404 ? 'hidden' : 'error',
      );
    }
  }

  protected async unlink(item: PlatformCrmLinkItem): Promise<void> {
    if (this.unlinkingId() !== null) return;
    const name = item.linked_store
      ? `la tienda ${item.linked_store.name}`
      : (item.organization?.name ?? 'esta cuenta');
    const reason = await this.dialog.prompt({
      title: 'Desenlazar cuenta Vendix',
      message: `El cliente deja de estar enlazado con ${name}. Sus demás cuentas siguen enlazadas, el historial del enlace se conserva y puedes volver a enlazarlo.`,
      placeholder: 'Motivo (opcional)',
      confirmText: 'Desenlazar',
      cancelText: 'Cancelar',
    });
    if (reason === undefined) return;

    const trimmed = reason.trim().slice(0, MAX_REASON);
    this.unlinkingId.set(item.id);
    try {
      const { links } = await firstValueFrom(
        this.service.unlinkById(this.customerId(), item.id, trimmed ? { reason: trimmed } : {}),
      );
      this.links.set(links);
      this.toast.success('Enlace deshecho');
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.unlinkingId.set(null);
    }
  }

  protected organizationState(item: PlatformCrmLinkItem): string {
    return organizationStateLabel(item.organization?.state);
  }

  protected subscriptionState(sub: PlatformOrganizationSubscription): string {
    return subscriptionStateLabel(sub.state);
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
