import { Injectable, signal } from '@angular/core';
import type { FormGroup, ValidationErrors } from '@angular/forms';

/**
 * Outcome of a UI action Vexi asked a module to run.
 *
 * `needs_user_input` is a first-class result, not a failure: a variant choice, a
 * weight, a date, a confirmation dialog — the product deliberately leaves those to a
 * human. Vexi reports them and asks, which is only possible because the agent loop
 * now receives this result inside the same turn.
 */
export interface VexiUiActionResult {
  status: 'ok' | 'needs_user_input' | 'not_found' | 'error';
  message: string;
  detail?: unknown;
}

/** One thing a module says it can do, in words Vexi can put in front of a person. */
export interface VexiUiAction {
  id: string;
  label: string;
  /** True when running it changes data, so Vexi warns before asking. */
  mutates?: boolean;
  /** Argument names the action needs, if any. */
  args?: string[];
}

/**
 * What the module has on screen right now.
 *
 * Deliberately shallow. This answers "what is the person looking at" so Vexi can
 * resolve "esto" and "este" — it is not a data channel, and a host that returned its
 * full dataset here would push the conversation out of the context window.
 */
export interface VexiUiScreen {
  module_key: string;
  title: string;
  /** Filters currently applied, by field name. */
  filters?: Record<string, unknown>;
  /** How many records the current view shows. */
  visible_count?: number;
  /** The record the person has selected or open, named as they would name it. */
  selection?: string | null;
  /** Fields of the form currently open, if one is. */
  form_fields?: string[];
  /** Anything else worth one line in the prompt. */
  notes?: string;
  // ── Paginación server-side (G3) ─────────────────────────────────────
  // El módulo estándar es server-paginated por contrato: cuando el host conoce
  // su página, la publica aquí para que Vexi pueda decir "página 2 de 6".
  // Un host sin paginación omite los cinco campos sin romper nada.
  /** Current page, 1-based, as the UI shows it. */
  page?: number;
  /** Rows per page. */
  limit?: number;
  /** Total records across all pages, not just the visible ones. */
  total?: number;
  /** Total pages, so the model never asks for one past the end. */
  total_pages?: number;
  /** Current sort as "field:asc|desc", when the list owns an order. */
  sort?: string;
}

/**
 * The contract a module implements to come within Vexi's operational reach.
 *
 * Every method is optional so a module can opt into exactly as much as it wants: a
 * read-only dashboard implements `readScreen` and nothing else, and Vexi answers
 * honestly that it cannot act there instead of failing.
 */
export interface VexiUiHost {
  /** Module key from `STORE_MODULE_CATALOG`, for matching against the route. */
  readonly vexiModuleKey: string;

  readScreen?(): VexiUiScreen;
  listActions?(): VexiUiAction[];
  runAction?(id: string, args?: Record<string, unknown>): Promise<VexiUiActionResult>;
  /**
   * Fills the open form but NEVER saves it (G1).
   *
   * Maps field→control on the module's own form, runs the form's own
   * validation, and leaves the form open for the person to review. On an
   * invalid form the result carries `detail.validation_errors` (one entry per
   * field) so the dispatcher can tell the model what is missing; unknown
   * fields are named in the message, never silently dropped.
   */
  fillForm?(values: Record<string, unknown>): Promise<VexiUiActionResult>;
  /**
   * Applies filters through the module's own handlers (G3).
   *
   * Besides the module's own filter names, `values` accepts the reserved keys
   * `page` (1-based), `limit` and `sort` ("field:asc|desc"). A filter change
   * resets to page 1 exactly like the UI does; an explicit `page` applies
   * after the filters so `{search, page: 2}` lands on page 2 of the filtered
   * list. Out-of-range pages clamp with a `note`; unknown keys are reported.
   */
  setFilter?(values: Record<string, unknown>): Promise<VexiUiActionResult>;
  openModal?(
    id: string,
    args?: Record<string, unknown>,
  ): Promise<VexiUiActionResult>;
  /** Reloads the module's own data after a confirmed write. */
  refresh?(): Promise<VexiUiActionResult> | VexiUiActionResult;
  /** Resolves when the module has finished loading. */
  whenReady?(): Promise<void>;
}

/**
 * Which module is on screen, and what it lets Vexi do there.
 *
 * The generalisation of `VexiPosBridgeService`, and it exists for the same reason:
 * "is the user in module X" cannot be answered by parsing the URL, because the route
 * and the mounted component disagree during a transition — and driving a screen that
 * is tearing down silently loses the work.
 *
 * The registration direction is the important part. A module enters Vexi's reach by
 * registering ITSELF and declaring what it exposes; the agent never names a component
 * or reaches into a service. That is what preserves the module's own validation,
 * variant selection and confirmation dialogs — the POS taught this lesson concretely,
 * where writing to the cart service directly produced carts the checkout rejected.
 * Adding a module to Vexi's reach costs one `register()` call in that component and
 * zero changes to the agent.
 */
/**
 * What a modal reports after Vexi filled its form (G1).
 *
 * The form is left open and unsaved in every case; `valid === false` means the
 * person still has fields to fix, named in `validation_errors`, and `unknown`
 * names the keys no control understood so the model can retry with the names
 * from `form_fields`.
 */
export interface VexiFillFormResult {
  applied: string[];
  unknown: string[];
  validation_errors: Array<{ field: string; message: string }>;
  valid: boolean;
}

/**
 * Collects the module form's own validation errors in words Vexi can relay.
 *
 * Reads the errors the form's own validators already produced — it never
 * invents rules — so what Vexi reports is exactly what the person would see
 * refusing the save.
 */
export function vexiCollectValidationErrors(
  form: FormGroup,
  labels: Record<string, string> = {},
): Array<{ field: string; message: string }> {
  const collected: Array<{ field: string; message: string }> = [];

  for (const [name, control] of Object.entries(form.controls)) {
    if (!control || control.valid) continue;
    const label = labels[name] ?? name;
    const errors: ValidationErrors = control.errors ?? {};
    for (const key of Object.keys(errors)) {
      collected.push({
        field: name,
        message: `${label}: ${vexiErrorText(key, errors[key])}`,
      });
    }
  }

  return collected;
}

function vexiErrorText(key: string, detail: unknown): string {
  const params = (detail ?? {}) as Record<string, unknown>;
  switch (key) {
    case 'required':
      return 'es obligatorio';
    case 'minlength':
      return `está muy corto (mínimo ${String(params['requiredLength'] ?? '?')})`;
    case 'maxlength':
      return 'está muy largo';
    case 'min':
      return `debe ser mayor a ${String(params['min'] ?? 0)}`;
    case 'email':
      return 'no es un correo válido';
    case 'pattern':
      return 'tiene un formato inválido';
    default:
      return 'es inválido';
  }
}

@Injectable({ providedIn: 'root' })
export class VexiUiHostRegistry {
  private readonly host = signal<VexiUiHost | null>(null);

  readonly current = () => this.host();

  register(host: VexiUiHost): void {
    this.host.set(host);
  }

  /**
   * Clears the handle only if it still points at the caller.
   *
   * On an A→A navigation the new instance registers before the old one is destroyed,
   * so an unconditional clear would drop the handle to the screen actually on display.
   */
  unregister(host: VexiUiHost): void {
    if (this.host() === host) this.host.set(null);
  }

  /** The host for a given module key, when that is the one on screen. */
  forModule(moduleKey: string): VexiUiHost | null {
    const active = this.host();
    return active?.vexiModuleKey === moduleKey ? active : null;
  }
}
