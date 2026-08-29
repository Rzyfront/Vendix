import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PrintGatewayClientService } from './print-gateway-client.service';
import { PrintTokenDefinition } from '../../../core/models/print-formats.model';

/**
 * [print-editor-dsk P3.2] — Token catalog.
 *
 * Owns the in-memory list of `available_tokens` exposed by
 * `GET /store/print-formats/:formatType`, grouped by the first path segment
 * (`store.*`, `customer.*`, `items.*`, …) so the UI can render collapsible
 * sections without recomputing on every change-detection.
 *
 * The grouping is purely presentational — the raw `PrintTokenDefinition[]` is
 * still surfaced via `tokens()` for callers (e.g. drag-and-drop) that need
 * the flat list.
 */
export interface TokenGroup {
  /** Capitalized first path segment, e.g. `store`, `customer`, `items`. */
  label: string;
  /** Lowercased prefix used for stable grouping. */
  prefix: string;
  tokens: PrintTokenDefinition[];
}

@Injectable({ providedIn: 'root' })
export class PrintTokenCatalogService {
  private readonly gatewayClient = inject(PrintGatewayClientService);

  private readonly _groups = signal<TokenGroup[]>([]);
  private readonly _tokens = signal<PrintTokenDefinition[]>([]);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _lastFormatType = signal<string | null>(null);

  readonly groups = this._groups.asReadonly();
  readonly tokens = this._tokens.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly lastFormatType = this._lastFormatType.asReadonly();

  /**
   * Loads `available_tokens` for the given format and rebuilds the groups.
   * Safe to call repeatedly — the signal setters dedupe no-op writes.
   */
  async load(formatType: string): Promise<void> {
    this._isLoading.set(true);
    try {
      const detail = await firstValueFrom(this.gatewayClient.getFormatDetail(formatType as any));
      const tokens = (detail?.available_tokens ?? []) as PrintTokenDefinition[];
      this._tokens.set(tokens);
      this._groups.set(this.groupByPath(tokens));
      this._lastFormatType.set(formatType);
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Clears in-memory state — useful when the editor unmounts so a future
   * mount for a different format never renders stale groups.
   */
  reset(): void {
    this._groups.set([]);
    this._tokens.set([]);
    this._lastFormatType.set(null);
  }

  /**
   * Groups tokens by the prefix of `token` (falling back to `path`).
   * The prefix is the substring before the first `.`, capitalized for the
   * group label. Tokens without a `.` (root-level keys) land in a synthetic
   * `Root` group.
   */
  private groupByPath(tokens: PrintTokenDefinition[]): TokenGroup[] {
    const groups = new Map<string, TokenGroup>();
    for (const t of tokens) {
      const source = (t.token ?? t.path ?? '').toString();
      const dotIndex = source.indexOf('.');
      const prefix = dotIndex >= 0 ? source.slice(0, dotIndex) : source;
      const labelRaw = prefix || 'root';
      const label = labelRaw.charAt(0).toUpperCase() + labelRaw.slice(1);
      const key = labelRaw.toLowerCase();
      if (!groups.has(key)) {
        groups.set(key, { label, prefix: key, tokens: [] });
      }
      groups.get(key)!.tokens.push(t);
    }
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
  }
}