import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { MenuFilterService } from './menu-filter.service';
import {
  VexiPosBridgeService,
  VexiPosActionResult,
} from './vexi-pos-bridge.service';
import {
  STORE_MODULE_BY_KEY,
  STORE_MODULE_CATALOG,
  resolveStoreModule,
} from '../../shared/constants/store-module-catalog.constant';
import { VEXI_REFRESH_ACTIONS } from '../store/vexi/vexi-refresh.map';

/**
 * How long Vexi waits for a decision that only a human can make.
 *
 * A modal's promise resolves on a click, and the agent loop times out at 60s.
 * Without this the whole turn would hang on a dialog the user may never have
 * noticed; with it, Vexi says "te abrí el selector de variante, elige y
 * seguimos" and the turn ends cleanly.
 */
const USER_INPUT_TIMEOUT_MS = 20000;

/**
 * Executes Vexi's `ui_*` commands against the running application.
 *
 * These never reach the server: `AIToolRegistry.executeTool()` refuses them by
 * design, because there is no router and no cart in that process. The browser
 * intercepts them by prefix — in the SSE effect for text chat and in the
 * realtime data channel for voice — and dispatches here.
 *
 * Everything POS-related goes through the **component**, never through
 * `PosCartService`. The repo already settled this for the barcode scanner
 * (`pos.component.ts` drives `PosProductSelectionComponent.onAddToCart`), and
 * that path is what keeps stock validation, variant selection, the
 * prepared-vs-KDS decision and the toasts. Reaching into the cart service
 * directly would build carts the checkout later rejects.
 */
@Injectable({ providedIn: 'root' })
export class VexiUiCommandService {
  private router = inject(Router);
  private menuFilter = inject(MenuFilterService);
  private pos = inject(VexiPosBridgeService);
  private store = inject(Store);

  /** True for names this service owns. Callers use it to intercept. */
  handles(toolName: string): boolean {
    return toolName.startsWith('ui_');
  }

  /**
   * Runs a UI command and returns the tool result as a JSON string, matching
   * what a server-side tool would have returned.
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    try {
      switch (toolName) {
        case 'ui_list_modules':
          return this.listModules(Boolean(args['only_visible']));
        case 'ui_explain_module':
          return this.explainModule(String(args['module_key'] ?? ''));
        case 'ui_why_hidden':
          return this.whyHidden(String(args['module_key'] ?? ''));
        case 'ui_navigate':
          return await this.navigate(String(args['module_key'] ?? ''));
        case 'ui_pos_add_item':
          return await this.posAddItem(
            String(args['query'] ?? ''),
            Number(args['quantity'] ?? 1),
          );
        case 'ui_pos_remove_item':
          return await this.posRemoveItem(String(args['query'] ?? ''));
        case 'ui_pos_set_customer':
          return await this.posSetCustomer(String(args['query'] ?? ''));
        case 'ui_pos_read_cart':
          return this.posReadCart();
        case 'ui_refresh':
          return this.refresh(String(args['domain'] ?? ''));
        default:
          return JSON.stringify({
            error: `El comando de interfaz "${toolName}" no existe en este navegador.`,
          });
      }
    } catch (error: unknown) {
      return JSON.stringify({
        error: `El comando de interfaz "${toolName}" falló: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      });
    }
  }

  // ── Módulos ─────────────────────────────────────────────────────────────

  private listModules(onlyVisible: boolean): string {
    const modules = STORE_MODULE_CATALOG.map((entry) => {
      const diagnosis = this.menuFilter.diagnoseModule(entry.key);
      return {
        key: entry.key,
        label: entry.label,
        route: entry.route,
        description: entry.description,
        parent: entry.parentKey,
        visible: diagnosis.visible,
        blocked_by: diagnosis.blockedBy ?? undefined,
      };
    }).filter((m) => !onlyVisible || m.visible);

    return JSON.stringify({ modules, total: modules.length });
  }

  private explainModule(rawKey: string): string {
    const entry = this.resolve(rawKey);
    if (!entry) return this.unknownModule(rawKey);

    const diagnosis = this.menuFilter.diagnoseModule(entry.key);

    return JSON.stringify({
      key: entry.key,
      label: entry.label,
      route: entry.route,
      description: entry.description,
      parent: entry.parentKey
        ? STORE_MODULE_BY_KEY[entry.parentKey]?.label
        : undefined,
      visible: diagnosis.visible,
      blocked_by: diagnosis.blockedBy ?? undefined,
      detail: diagnosis.detail,
      next_step: diagnosis.visible
        ? 'Puedes ofrecerle llevarlo con ui_navigate. Pregunta primero.'
        : 'No ofrezcas llevarlo: explícale por qué no lo ve.',
    });
  }

  private whyHidden(rawKey: string): string {
    const entry = this.resolve(rawKey);
    if (!entry) return this.unknownModule(rawKey);

    const diagnosis = this.menuFilter.diagnoseModule(entry.key);

    if (diagnosis.visible) {
      return JSON.stringify({
        key: entry.key,
        label: entry.label,
        visible: true,
        message: `${entry.label} sí está disponible, en ${entry.route}. Puede que simplemente no lo haya encontrado en el menú.`,
      });
    }

    return JSON.stringify({
      key: entry.key,
      label: entry.label,
      visible: false,
      blocked_by: diagnosis.blockedBy,
      detail: diagnosis.detail,
      fix_path: diagnosis.fixPath,
      next_step: diagnosis.fixPath
        ? 'Explícale la causa y ofrécele llevarlo a la pantalla donde puede resolverlo.'
        : 'Explícale la causa. No puede resolverlo él mismo desde aquí; dile a quién pedírselo.',
    });
  }

  // ── Navegación ──────────────────────────────────────────────────────────

  /**
   * Navigates and then **checks where it actually landed**.
   *
   * `onboardingGuard` is a `canActivateChild` that redirects silently, so a
   * resolved `navigate()` promise is not proof of arrival. Reporting success
   * on a redirect would have Vexi narrate a screen the user is not on.
   */
  private async navigate(rawKey: string): Promise<string> {
    const entry = this.resolve(rawKey);
    if (!entry) return this.unknownModule(rawKey);

    const diagnosis = this.menuFilter.diagnoseModule(entry.key);
    if (!diagnosis.visible) {
      return JSON.stringify({
        status: 'blocked',
        target: entry.label,
        blocked_by: diagnosis.blockedBy,
        detail: diagnosis.detail,
        next_step:
          'No navegues. Explícale por qué no puede entrar y qué haría falta.',
      });
    }

    const accepted = await this.router.navigate([entry.route]);
    const landedOn = this.router.url;

    if (!accepted) {
      return JSON.stringify({
        status: 'blocked',
        target: entry.label,
        landed_on: landedOn,
        next_step:
          'La navegación fue rechazada por un guard. Dile que no pudiste llevarlo y que su cuenta no tiene acceso a esa pantalla.',
      });
    }

    if (!landedOn.startsWith(entry.route)) {
      return JSON.stringify({
        status: 'redirected',
        target: entry.label,
        landed_on: landedOn,
        next_step: `La aplicación lo desvió a ${landedOn}. Dile dónde quedó realmente en vez de afirmar que llegó a ${entry.label}.`,
      });
    }

    return JSON.stringify({
      status: 'ok',
      target: entry.label,
      landed_on: landedOn,
      message: `Listo, lo llevé a ${entry.label}.`,
    });
  }

  // ── POS ─────────────────────────────────────────────────────────────────

  private async posAddItem(query: string, quantity: number): Promise<string> {
    const host = this.pos.current();
    if (!host) return this.posNotOpen();

    const result = await this.withUserInputTimeout(
      host.vexiAddProductByName(query, Number.isFinite(quantity) ? quantity : 1),
      `Le abrí el selector para "${query}" y estoy esperando que elija.`,
    );

    return JSON.stringify({
      ...result,
      next_step:
        result.status === 'ok'
          ? 'Pregúntale si quiere algo más, o si desea crear, enviar o pagar la orden. Nunca cobres tú.'
          : 'Cuéntale exactamente qué pasó y qué tiene que hacer él.',
    });
  }

  private async posRemoveItem(query: string): Promise<string> {
    const host = this.pos.current();
    if (!host) return this.posNotOpen();

    const result = await this.withUserInputTimeout(
      host.vexiRemoveLineByName(query),
      `Estoy esperando confirmación para quitar "${query}".`,
    );
    return JSON.stringify(result);
  }

  private async posSetCustomer(query: string): Promise<string> {
    const host = this.pos.current();
    if (!host) return this.posNotOpen();

    const result = await this.withUserInputTimeout(
      host.vexiSetCustomerByQuery(query),
      `Le abrí la búsqueda de cliente para "${query}".`,
    );
    return JSON.stringify(result);
  }

  private posReadCart(): string {
    const host = this.pos.current();
    if (!host) return this.posNotOpen();

    const cart = host.vexiReadCart();
    return JSON.stringify({
      status: 'ok',
      ...cart,
      next_step:
        'Resume lo que lleva y pregúntale si desea crear, enviar o pagar la orden. El pago lo hace la persona, no tú.',
    });
  }

  private posNotOpen(): string {
    return JSON.stringify({
      status: 'error',
      message:
        'El Punto de Venta no está abierto en esta pantalla, así que no hay carrito sobre el que actuar.',
      next_step:
        'Ofrécele llevarlo al Punto de Venta con ui_navigate y espera su sí antes de navegar.',
    });
  }

  /**
   * Caps the wait on anything that ends in a modal.
   *
   * On timeout the action is NOT cancelled — the dialog stays open and the
   * user can still finish it. Only Vexi's turn stops waiting, which is the
   * honest thing to report: the work is pending on them, not failed.
   */
  private withUserInputTimeout(
    action: Promise<VexiPosActionResult>,
    pendingMessage: string,
  ): Promise<VexiPosActionResult> {
    return new Promise<VexiPosActionResult>((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ status: 'needs_user_input', message: pendingMessage });
      }, USER_INPUT_TIMEOUT_MS);

      action
        .then((result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            status: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'La acción en el Punto de Venta falló.',
          });
        });
    });
  }

  // ── Refresco ────────────────────────────────────────────────────────────

  /**
   * Reloads the on-screen module after a confirmed write.
   *
   * Dispatches the domain's own NgRx action rather than calling a service or
   * reloading the route: the effect is the sole owner of refresh
   * (`vendix-frontend-state`, enforced by `scripts/state-refresh-audit.sh`),
   * and a route reload would throw away filters, pagination and half-filled
   * forms.
   */
  private refresh(domain: string): string {
    const action = VEXI_REFRESH_ACTIONS[domain];

    if (!action) {
      return JSON.stringify({
        status: 'no_refresh_available',
        domain,
        next_step: `El cambio se aplicó, pero esta pantalla no sabe recargar "${domain}" sola. Dile que actualice la vista para verlo.`,
      });
    }

    this.store.dispatch(action());

    return JSON.stringify({
      status: 'ok',
      domain,
      message: 'La pantalla ya muestra el cambio.',
    });
  }

  // ── Utilidades ──────────────────────────────────────────────────────────

  private resolve(rawKey: string) {
    return rawKey ? resolveStoreModule(rawKey) : null;
  }

  private unknownModule(rawKey: string): string {
    return JSON.stringify({
      error: `No encontré un módulo que corresponda a "${rawKey}", o el nombre es ambiguo.`,
      next_step:
        'Llama a ui_list_modules para ver las claves reales y vuelve a intentarlo con una.',
    });
  }
}
