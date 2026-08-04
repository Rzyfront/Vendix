import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MenuFilterService } from './menu-filter.service';
import { STORE_MODULE_CATALOG } from '../../shared/constants/store-module-catalog.constant';
import type { VexiUiContext } from './vexi-api.service';

/**
 * Snapshot of what the user is looking at, sent with every Vexi turn.
 *
 * Two things it buys: Vexi can say "veo que estás en el POS" without asking,
 * and when someone asks "¿por qué no veo Nómina?" it answers with the layer
 * the sidebar itself computed instead of guessing. The server treats it as
 * untrusted prompt material — it never authorizes anything — so nothing here
 * needs to be tamper-proof, only accurate.
 */
@Injectable({ providedIn: 'root' })
export class VexiUiContextService {
  private router = inject(Router);
  private menuFilter = inject(MenuFilterService);

  /**
   * Contributions from screens that know something Vexi cannot infer from the
   * route — today only the POS, which registers its cart. Keyed so a screen
   * can clear its own entry on destroy without disturbing the others.
   */
  private readonly contributors = signal<
    Record<string, Partial<VexiUiContext>>
  >({});

  /**
   * A screen publishes what it knows about itself. Called from `ngOnInit` /
   * effect and cleared on destroy — a stale POS cart reported from a screen
   * the user already left is worse than no cart at all.
   */
  contribute(key: string, value: Partial<VexiUiContext>): void {
    this.contributors.update((current) => ({ ...current, [key]: value }));
  }

  clear(key: string): void {
    this.contributors.update((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  /**
   * Builds the payload for one turn.
   *
   * The module split runs over the catalog rather than over the rendered
   * sidebar so it covers submodules the user has collapsed or never scrolled
   * to — "Punto de Compra" is exactly the kind of thing someone asks about
   * without ever having seen it.
   */
  build(): VexiUiContext {
    const visible_modules: string[] = [];
    const hidden_modules: Array<{ key: string; blocked_by: string }> = [];

    for (const entry of STORE_MODULE_CATALOG) {
      const diagnosis = this.menuFilter.diagnoseModule(entry.key);
      if (diagnosis.visible) {
        visible_modules.push(entry.key);
      } else {
        hidden_modules.push({
          key: entry.key,
          blocked_by: diagnosis.blockedBy ?? 'unknown',
        });
      }
    }

    const contributed = Object.values(this.contributors()).reduce<
      Partial<VexiUiContext>
    >((acc, value) => ({ ...acc, ...value }), {});

    return {
      route: this.router.url,
      visible_modules,
      hidden_modules,
      ...contributed,
    };
  }
}
