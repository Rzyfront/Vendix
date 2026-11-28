import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  CardComponent,
  SettingToggleComponent,
} from '../../../../../shared/components/index';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { StoreSettingsService } from '../general/services/store-settings.service';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  AgentStatusService,
  AgentStatusView,
} from '../ai-agents/agent-status.service';
import { AgentUsageMetersComponent } from '../ai-agents/agent-usage-meters.component';

/**
 * Vexi section of "Agentes IA", below Vex (agentes-admin S1).
 *
 * Vexi only exists in the store's public apps now: the internal admin dock is
 * retired (S2), so the old «Usar Vexi» switch is gone. What remains is what
 * the public Vexi has today: the «Vexi en tus apps públicas» switch
 * (`vexi_public.enabled`, off by default — S4), where the conversation hands
 * off to the store's WhatsApp, and the usage bars. Model and prompt are set in
 * superadmin; the conversations are in «Historial».
 */
@Component({
  selector: 'app-vexi-settings',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    CardComponent,
    SettingToggleComponent,
    IconComponent,
    AgentUsageMetersComponent,
  ],
  template: `
    <app-card
      [responsive]="true"
      [showHeader]="true"
      data-testid="vexi-settings-section"
    >
      <div slot="header" class="flex items-start gap-3 min-w-0">
        <img
          src="assets/vexi/vexi-happy.webp"
          alt=""
          class="h-10 w-10 shrink-0 object-contain"
        />
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">
            Vexi · atención a tus clientes
          </h2>
          <p class="text-sm text-[var(--color-text-secondary)] mt-1">
            Vexi atiende a tus clientes en tu tienda en línea, en la página de
            cada producto y en la de servicios. Dentro del panel ya no aparece:
            para el trabajo de la tienda está Vex.
          </p>
        </div>
      </div>

      <div class="space-y-4">
        <div
          class="rounded-lg border border-[var(--color-border)] p-4"
          role="group"
          aria-label="Vexi en tus apps públicas"
          data-testid="vexi-public-setting"
          [attr.aria-describedby]="reason() ? 'vexi-reason' : null"
        >
          <app-setting-toggle
            label="Vexi en tus apps públicas"
            [description]="publicDescription()"
            [disabled]="savingPublic() || publicLocked()"
            [ngModel]="publicEnabled()"
            (ngModelChange)="onPublicToggle($event)"
          />
          @if (reason()) {
            <p
              id="vexi-reason"
              class="mt-3 text-sm text-[var(--color-text-secondary)]"
              role="status"
            >
              {{ reason() }}
            </p>
          }
        </div>

        <div
          class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] p-4"
          data-testid="vexi-whatsapp-handoff"
        >
          <app-icon
            name="message-circle"
            [size]="20"
            [class]="
              whatsappNumber()
                ? 'text-[var(--color-success)] mt-0.5 shrink-0'
                : 'text-[var(--color-warning)] mt-0.5 shrink-0'
            "
          />
          <div class="min-w-0 flex-1 text-sm">
            <h3 class="font-semibold text-[var(--color-text-primary)]">
              Saludo y paso a WhatsApp
            </h3>
            <p class="text-[var(--color-text-secondary)] mt-1">
              Vexi saluda con el nombre de tu tienda y, cuando el cliente
              termina su pedido o pide hablar con alguien, le ofrece seguir la
              conversación por tu WhatsApp.
            </p>
            @if (whatsappNumber(); as number) {
              <p class="mt-2 text-[var(--color-text-primary)]">
                WhatsApp de la tienda: <span class="font-semibold">{{ number }}</span>
              </p>
            } @else {
              <p class="mt-2 text-[var(--color-text-primary)]">
                Aún no tienes un número de WhatsApp en tu tienda en línea, así
                que Vexi no puede ofrecer ese paso.
                <a
                  routerLink="/admin/ecommerce"
                  class="text-primary-600 hover:underline"
                  >Agrégalo en Tienda en línea</a
                >.
              </p>
            }
          </div>
        </div>
      </div>

      <app-agent-usage-meters agent="vexi" />
    </app-card>
  `,
  styles: [':host { display: block; width: 100%; }'],
})
export class VexiSettingsComponent {
  private readonly settingsService = inject(StoreSettingsService);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly toast = inject(ToastService);
  private readonly statusService = inject(AgentStatusService);

  /** `null` until `GET /store/ai-agents/status` answers, or if it fails. */
  readonly status = signal<AgentStatusView | null>(null);
  readonly blockedByPlan = computed(() => this.status()?.plan_includes === false);
  /** Only the plan or subscription reasons matter here; «off» is the switch itself. */
  readonly reason = computed(() => {
    const s = this.status();
    return s && s.state !== 'off_by_store' && s.state !== 'on' ? s.reason : null;
  });

  /** WhatsApp the public chat hands off to (`ecommerce.checkout.whatsapp_number`). */
  readonly whatsappNumber = computed<string | null>(() => {
    const raw = this.settingsFacade.settings()?.ecommerce?.['checkout']?.[
      'whatsapp_number'
    ];
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  });

  constructor() {
    void this.statusService.loadFor('vexi').then((s) => this.status.set(s));
  }

  /**
   * Optimistic local value. The facade signal only flips once the PATCH
   * response is republished into NgRx; without a local override the toggle
   * would snap back for the duration of the round trip and read as a failure.
   */
  private readonly publicOverride = signal<boolean | null>(null);
  readonly savingPublic = signal(false);
  readonly publicEnabled = computed(
    () => this.publicOverride() ?? this.settingsFacade.vexiPublicEnabled(),
  );
  /** The plan only blocks turning it on; it can always be turned off. */
  readonly publicLocked = computed(
    () => this.blockedByPlan() && !this.publicEnabled(),
  );
  readonly publicDescription = computed(() =>
    this.publicEnabled()
      ? 'Tus clientes ven a Vexi en la tienda en línea, la página de producto y la de servicios: arma pedidos, agenda citas y registra peticiones. Solo responde por escrito y usa los tokens de IA de tu plan.'
      : 'Vexi no aparece en tus apps públicas. Al activarlo, tus clientes lo ven como una burbuja de chat.',
  );

  async onPublicToggle(next: boolean): Promise<void> {
    if (
      this.savingPublic() ||
      next === this.publicEnabled() ||
      (next && this.blockedByPlan())
    ) {
      return;
    }
    const previous = this.publicEnabled();
    this.publicOverride.set(next);
    this.savingPublic.set(true);
    try {
      await firstValueFrom(
        this.settingsService.saveSettingsNow({ vexi_public: { enabled: next } }),
      );
      this.publicOverride.set(null);
      this.toast.success(
        next
          ? 'Vexi quedó publicado en tus apps públicas.'
          : 'Vexi ya no aparece en tus apps públicas.',
      );
      void this.statusService.loadFor('vexi').then((s) => this.status.set(s));
    } catch (error) {
      this.publicOverride.set(previous);
      this.toast.error(
        parseApiError(error).userMessage ??
          'No se pudo guardar la configuración de Vexi.',
      );
    } finally {
      this.savingPublic.set(false);
    }
  }
}
