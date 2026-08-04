import { Injectable, signal } from '@angular/core';

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
  fillForm?(values: Record<string, unknown>): Promise<VexiUiActionResult>;
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
