import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

/**
 * Pantalla "sin acceso" — terminal de la cadena de fallback para usuarios
 * con sesión válida pero SIN módulos del panel activos (caso bug C1(2)).
 *
 * - Si el usuario quiere intentarlo más tarde: el botón "Iniciar sesión de
 *   nuevo" cierra la sesión y devuelve al flujo público de login. El guardia
 *   `panelUiGuard` ya pule el árbol del sidebar y deja al usuario saber
 *   por qué no ve módulos.
 * - Si es owner: la pantalla es inalcanzable porque `firstActiveModuleRoute`
 *   lo desvía al terminal `PANEL_UI_TERMINAL_ROUTE` (`/admin/settings/general`)
 *   directamente. La guard `panelUiGuard` además lo deja pasar. Coherente con
 *   la regla "el owner ve todo".
 *
 * Se hospeda bajo la rama `/admin/*` para que la sidebar y los guards de
 * `store_admin.routes.ts` (auth, onboarding, panel_ui) sigan aplicando — la
 * `panelUiGuard` la deja pasar vía el bypass explícito de `PANEL_UI_NO_ACCESS_ROUTE`.
 */
@Component({
  selector: 'vendix-no-access-page',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  templateUrl: './no-access-page.component.html',
  styleUrls: ['./no-access-page.component.scss'],
})
export class NoAccessPageComponent {
  private readonly authFacade = inject(AuthFacade);
  private readonly router = inject(Router);

  /** Nombre legible del usuario para personalizar el mensaje cuando existe. */
  readonly displayName = computed<string | null>(() => {
    const u = this.authFacade.user();
    if (!u) return null;
    const first = (u.first_name ?? '').trim();
    const last = (u.last_name ?? '').trim();
    const full = [first, last].filter(Boolean).join(' ');
    return full || u.username || u.email || null;
  });

  readonly storeName = computed<string | null>(() => {
    const u = this.authFacade.user();
    const org = (u as unknown as { organizations?: { name?: string } } | null)
      ?.organizations;
    return org?.name ?? null;
  });

  /** Cierra la sesión de manera controlada. `terminateSession` limpia tokens,
   *  dispara el toast y el `SessionService` redirige al login. */
  onSignOut(): void {
    this.authFacade.logout();
    // Si por alguna razón `terminateSession` no redirige, empujamos manualmente
    // para que el usuario nunca quede atrapado en esta pantalla.
    setTimeout(() => this.router.navigateByUrl('/'), 250);
  }
}
