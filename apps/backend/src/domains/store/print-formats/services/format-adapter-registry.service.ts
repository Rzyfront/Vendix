/**
 * [print-editor-dsk P7] — DI-friendly lookup over the 11 FormatAdapter
 * records.
 *
 * The adapters themselves are static (frozen at module load); the
 * service exists so Nest can inject them into `print-formats.service.ts`
 * and any future consumer (canvas, panels, hub) without re-instantiating.
 *
 * Lookup-by-`formatType` is the hot path; `Map.get()` is faster than
 * `Array.find()` and makes `has()` a one-liner. Iterating returns a fresh
 * array so callers can't mutate the internal map.
 */

import { Injectable } from '@nestjs/common';

import {
  ALL_ADAPTERS,
} from '../lib/adapters';
import type {
  AdapterPaper,
  FormatAdapter,
  RegionKind,
} from '../lib/format-adapter';

@Injectable()
export class FormatAdapterRegistryService {
  private readonly map: ReadonlyMap<string, Readonly<FormatAdapter>>;

  constructor() {
    this.map = new Map(
      ALL_ADAPTERS.map((adapter) => [adapter.formatType, adapter]),
    );
  }

  /**
   * Resolve an adapter by `format_type`. Returns `undefined` for unknown
   * format types — callers MUST handle the missing case (controllers
   * typically translate it into PRINT_FORMAT_NOT_FOUND_001).
   */
  get(formatType: string): Readonly<FormatAdapter> | undefined {
    return this.map.get(formatType);
  }

  /** Convenience: returns `true` when the registry knows about the format. */
  has(formatType: string): boolean {
    return this.map.has(formatType);
  }

  /**
   * All 11 adapter records in declaration order. Returns a fresh array
   * so callers can't mutate the registry's internal state.
   */
  list(): ReadonlyArray<Readonly<FormatAdapter>> {
    return [...this.map.values()];
  }

  /** All adapters that belong to the given category. */
  byCategory(
    category: string,
  ): ReadonlyArray<Readonly<FormatAdapter>> {
    return this.list().filter((a) => a.category === category);
  }

  /**
   * Returns the regions the canvas exposes for a format. Falls back to
   * an empty array for unknown formats so the picker can render an
   * "unsupported format" state instead of throwing.
   */
  availableRegions(formatType: string): RegionKind[] {
    return this.get(formatType)?.availableRegions ?? [];
  }

  /**
   * Default paper format for a format_type. Falls back to `'letter'`
   * for unknown formats — same fallback as `defaultPaperFor()` in
   * `lib/default-paper.ts` so the registry and the bare helper agree.
   */
  defaultPaper(formatType: string): AdapterPaper {
    return this.get(formatType)?.defaultPaper ?? 'letter';
  }
}
