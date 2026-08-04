import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { MenuFilterService } from './menu-filter.service';
import {
  VexiPosBridgeService,
  VexiPosActionResult,
} from './vexi-pos-bridge.service';
import {
  VexiUiActionResult,
  VexiUiHostRegistry,
} from './vexi-ui-host.registry';
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

/** `ui_wait_for` bounds, so a broken host cannot hold the turn open. */
const DEFAULT_WAIT_MS = 5000;
const MAX_WAIT_MS = 15000;

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
  private hosts = inject(VexiUiHostRegistry);
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
        case 'ui_pos_checkout':
          return await this.posCheckout();
        case 'ui_refresh':
          return await this.refresh(String(args['domain'] ?? ''));
        case 'ui_read_screen':
          return this.readScreen();
        case 'ui_list_actions':
          return this.listActions();
        case 'ui_fill_form':
          return await this.hostAction('fillForm', (host) =>
            host.fillForm!(
              (args['values'] as Record<string, unknown>) ?? {},
            ),
          );
        case 'ui_set_filter':
          return await this.hostAction('setFilter', (host) =>
            host.setFilter!(
              (args['values'] as Record<string, unknown>) ?? {},
            ),
          );
        case 'ui_click_action':
          return await this.clickAction(
            String(args['action_id'] ?? ''),
            args['args'] as Record<string, unknown> | undefined,
          );
        case 'ui_open_modal':
          return await this.hostAction('openModal', (host) =>
            host.openModal!(
              String(args['modal_id'] ?? ''),
              args['args'] as Record<string, unknown> | undefined,
            ),
          );
        case 'ui_wait_for':
          return await this.waitFor(
            args['module_key'] ? String(args['module_key']) : undefined,
            Number(args['timeout_ms'] ?? 0),
          );
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
          ? 'Pregúntale si quiere algo más. Si ya está completa, resúmele la venta y pregúntale si confirma para cobrar; con su sí, cóbrala con ui_pos_checkout.'
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
        'Resume lo que lleva y pregúntale si confirma para cobrar. Con su sí, cóbrala con ui_pos_checkout.',
    });
  }

  /**
   * Charges the open sale.
   *
   * The only POS command that does NOT go through `withUserInputTimeout`: that
   * helper caps the wait at 20s, and counting cash or picking a payment method
   * routinely takes longer. `vexiCheckout` carries its own 90s budget and
   * already reports a timeout as `needs_user_input`, so wrapping it would only
   * cut a live checkout short and mislabel it as pending.
   */
  private async posCheckout(): Promise<string> {
    const host = this.pos.current();
    if (!host) return this.posNotOpen();

    const result = await host.vexiCheckout();

    return JSON.stringify({
      ...result,
      next_step:
        result.status === 'ok'
          ? 'Confírmale que la venta quedó cobrada y dile el número de orden.'
          : 'Dile exactamente en qué quedó el cobro y qué falta para completarlo.',
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
  private withUserInputTimeout<
    T extends VexiPosActionResult | VexiUiActionResult,
  >(action: Promise<T>, pendingMessage: string): Promise<T> {
    return new Promise<T>((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ status: 'needs_user_input', message: pendingMessage } as T);
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
                : 'La acción en la pantalla falló.',
          } as T);
        });
    });
  }

  // ── Comandos genéricos sobre el host registrado ─────────────────────────

  /**
   * Describes the screen so Vexi can resolve "esto" and "este".
   *
   * Falls back to the module catalog when the on-screen module never registered a
   * host: naming the module and admitting it cannot be driven is far more useful
   * than a bare error, because it lets Vexi offer the API route instead.
   */
  private readScreen(): string {
    const host = this.hosts.current();

    if (!host?.readScreen) {
      const route = this.router.url;
      return JSON.stringify({
        status: 'no_host',
        route,
        next_step:
          'Esta pantalla no expone su estado, así que no puedes leer lo que la persona tiene delante. Si necesitas el dato, consúltalo con las herramientas de datos; y si te pidió actuar "sobre esto", pídele que te diga sobre qué registro.',
      });
    }

    return JSON.stringify({ status: 'ok', screen: host.readScreen() });
  }

  private listActions(): string {
    const host = this.hosts.current();

    if (!host?.listActions) {
      return JSON.stringify({
        status: 'no_host',
        actions: [],
        next_step:
          'Esta pantalla no declara acciones que puedas disparar. Haz lo que te piden por la vía de datos, o llévalo al módulo y dile qué botón buscar.',
      });
    }

    const actions = host.listActions();

    return JSON.stringify({
      status: 'ok',
      module: host.vexiModuleKey,
      actions,
      next_step:
        'Dispara una con ui_click_action pasando su `id`. Las marcadas `mutates` cambian datos: adviértelo y pide el sí antes.',
    });
  }

  /**
   * Runs a declared action, refusing an id the host never published.
   *
   * The check is what stops a hallucinated action id from being reported as "no
   * pasó nada": the model gets the real list back and can retry with a valid one.
   */
  private async clickAction(
    actionId: string,
    args?: Record<string, unknown>,
  ): Promise<string> {
    const host = this.hosts.current();

    if (!host?.runAction || !host.listActions) {
      return this.noHost('disparar acciones');
    }

    const declared = host.listActions();
    const match = declared.find((action) => action.id === actionId);

    if (!match) {
      return JSON.stringify({
        status: 'unknown_action',
        requested: actionId,
        available: declared.map((action) => action.id),
        next_step:
          'Esa acción no existe en esta pantalla. Elige una de las disponibles o resuélvelo por la vía de datos.',
      });
    }

    const result = await this.withUserInputTimeout(
      host.runAction(actionId, args),
      `Disparé "${match.label}" y la pantalla está esperando algo de la persona.`,
    );

    return JSON.stringify({
      ...result,
      action: match.label,
      next_step:
        result.status === 'ok'
          ? 'Cuéntale en una frase qué quedó hecho.'
          : 'Dile exactamente en qué quedó y qué falta de su parte.',
    });
  }

  /**
   * Shared shape for the host methods that take a values map.
   *
   * The `capability` string is the phrase the refusal uses, so a module that
   * implements `setFilter` but not `fillForm` produces two different, accurate
   * messages instead of one generic "no puedo".
   */
  private async hostAction(
    capability: 'fillForm' | 'setFilter' | 'openModal',
    run: (host: NonNullable<ReturnType<VexiUiHostRegistry['current']>>) => Promise<VexiUiActionResult>,
  ): Promise<string> {
    const host = this.hosts.current();

    const phrase = {
      fillForm: 'llenar formularios',
      setFilter: 'aplicar filtros',
      openModal: 'abrir formularios',
    }[capability];

    if (!host || typeof host[capability] !== 'function') {
      return this.noHost(phrase);
    }

    const result = await this.withUserInputTimeout(
      run(host),
      'La pantalla está esperando algo de la persona.',
    );

    return JSON.stringify({
      ...result,
      next_step:
        capability === 'fillForm'
          ? 'Los campos quedaron puestos pero NADA se guardó. Dile qué dejaste listo y qué falta que revise o decida antes de guardar.'
          : result.status === 'ok'
            ? 'Cuéntale qué quedó en pantalla, con el número de registros si lo tienes.'
            : 'Dile qué no se pudo y por qué.',
    });
  }

  /**
   * Waits for the module to finish loading, when it exposes a readiness signal.
   *
   * Capped hard: a host with a broken `whenReady` would otherwise hold the whole turn
   * open, and the turn's own budget is what the person is waiting on.
   */
  private async waitFor(
    moduleKey: string | undefined,
    requestedTimeout: number,
  ): Promise<string> {
    const timeout = Math.min(
      Math.max(requestedTimeout || DEFAULT_WAIT_MS, 500),
      MAX_WAIT_MS,
    );

    const host = moduleKey
      ? this.hosts.forModule(moduleKey)
      : this.hosts.current();

    if (!host) {
      return JSON.stringify({
        status: 'not_ready',
        expected: moduleKey,
        route: this.router.url,
        next_step: moduleKey
          ? `La pantalla de "${moduleKey}" no está montada. Llévalo con ui_navigate antes de intentar operar ahí.`
          : 'No hay ninguna pantalla operable montada ahora mismo.',
      });
    }

    if (!host.whenReady) {
      return JSON.stringify({
        status: 'ok',
        module: host.vexiModuleKey,
        note: 'La pantalla está montada. No expone señal de carga, así que asume que ya cargó.',
      });
    }

    const ready = await Promise.race([
      host.whenReady().then(() => true),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), timeout),
      ),
    ]);

    return JSON.stringify({
      status: ready ? 'ok' : 'timeout',
      module: host.vexiModuleKey,
      next_step: ready
        ? 'La pantalla ya cargó, puedes seguir.'
        : 'La pantalla sigue cargando. No afirmes nada sobre lo que muestra; dile que está tardando.',
    });
  }

  private noHost(capability: string): string {
    return JSON.stringify({
      status: 'no_host',
      message: `La pantalla que la persona tiene abierta no permite ${capability} desde aquí.`,
      next_step:
        'Hazlo por la vía de datos si puedes, o llévalo al módulo correspondiente y dile qué hacer allí.',
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
  private async refresh(domain: string): Promise<string> {
    const target = VEXI_REFRESH_ACTIONS[domain];

    // The route check is not defensive noise: these are lazily-loaded feature
    // stores, so dispatching from a screen that never loaded the effect is a silent
    // no-op that would still be reported as a successful refresh.
    if (target && this.router.url.startsWith(target.routeFragment)) {
      this.store.dispatch(target.action());

      return JSON.stringify({
        status: 'ok',
        domain,
        via: 'store',
        message: 'La pantalla ya muestra el cambio.',
      });
    }

    // Second rung of the cascade: a module with no NgRx state of its own can still
    // reload itself. Reached for the long tail of domains that keep their data in
    // component signals — without it, `ui_refresh` degraded to an apology on every
    // module that was not one of the handful with a feature store.
    const host = this.hosts.current();

    if (host?.refresh) {
      const result = await host.refresh();

      return JSON.stringify({
        status: result.status,
        domain,
        via: 'host',
        message:
          result.status === 'ok'
            ? 'La pantalla ya muestra el cambio.'
            : result.message,
      });
    }

    return JSON.stringify({
      status: 'no_refresh_available',
      domain,
      next_step: `El cambio se aplicó, pero esta pantalla no sabe recargar "${domain}" sola. Dile que actualice la vista para verlo.`,
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
