import { Injectable, Logger } from '@nestjs/common';
import { Resolver as DnsResolver } from 'node:dns/promises';

/**
 * Result of a multi-resolver DNS lookup.
 *
 * - `records` is the merged consensus set (records returned by >= 2/3 resolvers).
 * - `perResolver` exposes each resolver's outcome for diagnostics.
 * - `consensus` is true when at least 2 of 3 resolvers responded successfully
 *   (including NXDOMAIN as "empty success") AND agree on a non-empty intersection
 *   of records (or all returned empty/NXDOMAIN, in which case consensusRecords is []).
 * - `consensusRecords` is the intersection of records across the resolvers
 *   that participated in the consensus.
 */
export interface ResolverResult<T> {
  records: T[];
  perResolver: Array<{
    resolver: string;
    status: 'success' | 'nxdomain' | 'error';
    records: T[];
    error?: string;
  }>;
  consensus: boolean;
  consensusRecords: T[];
}

type RecordType = 'TXT' | 'CNAME' | 'A';

@Injectable()
export class DnsResolverService {
  private readonly logger = new Logger(DnsResolverService.name);

  /**
   * Public DNS resolvers used for consensus checking.
   * - 1.1.1.1 → Cloudflare
   * - 8.8.8.8 → Google
   * - 9.9.9.9 → Quad9
   */
  private static readonly RESOLVERS: ReadonlyArray<string> = [
    '1.1.1.1',
    '8.8.8.8',
    '9.9.9.9',
  ];

  /**
   * Per-query timeout (ms) applied to each resolver.
   * Node's Resolver has no native timeout option, so we wrap with a
   * Promise.race to avoid one slow resolver blocking the consensus.
   */
  private static readonly QUERY_TIMEOUT_MS = 5_000;

  async resolveTxt(name: string): Promise<ResolverResult<string>> {
    return this.resolve(name, 'TXT', async (resolver, n) => {
      // resolveTxt returns string[][] (one entry per RRSet). Flatten by joining
      // the chunks of each TXT record (per RFC 1035 they may be split into
      // 255-byte segments).
      const groups = await resolver.resolveTxt(n);
      return groups.map((parts) => parts.join(''));
    });
  }

  async resolveCname(name: string): Promise<ResolverResult<string>> {
    return this.resolve(name, 'CNAME', (resolver, n) =>
      resolver.resolveCname(n),
    );
  }

  async resolveA(name: string): Promise<ResolverResult<string>> {
    return this.resolve(name, 'A', (resolver, n) => resolver.resolve4(n));
  }

  /**
   * Convenience helper used to verify an expected TXT value is present
   * (e.g. for domain ownership challenges).
   *
   * - `found` is true if the expected value appears across the consensus set.
   * - `consensus` is true if 2+ resolvers actually contained the value.
   * - `seenIn` lists the resolvers (by IP) where the value was observed.
   */
  async hasTxtRecord(
    name: string,
    expectedValue: string,
  ): Promise<{ found: boolean; consensus: boolean; seenIn: string[] }> {
    const result = await this.resolveTxt(name);
    const seenIn = result.perResolver
      .filter(
        (r) => r.status === 'success' && r.records.includes(expectedValue),
      )
      .map((r) => r.resolver);
    const consensus = seenIn.length >= 2;
    const found = consensus || result.consensusRecords.includes(expectedValue);
    return { found, consensus, seenIn };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async resolve(
    name: string,
    type: RecordType,
    queryFn: (resolver: DnsResolver, name: string) => Promise<string[]>,
  ): Promise<ResolverResult<string>> {
    const settled = await Promise.allSettled(
      DnsResolverService.RESOLVERS.map((ip) =>
        this.queryOne(ip, name, type, queryFn),
      ),
    );

    const perResolver: ResolverResult<string>['perResolver'] = settled.map(
      (s, idx) => {
        const resolverIp = DnsResolverService.RESOLVERS[idx];
        if (s.status === 'fulfilled') {
          return s.value;
        }
        // Promise rejection of queryOne itself shouldn't happen since we catch
        // inside, but guard defensively.
        return {
          resolver: resolverIp,
          status: 'error' as const,
          records: [],
          error: this.errorMessage(s.reason),
        };
      },
    );

    const { consensus, consensusRecords } = this.computeConsensus(perResolver);

    return {
      records: consensusRecords,
      perResolver,
      consensus,
      consensusRecords,
    };
  }

  private async queryOne(
    resolverIp: string,
    name: string,
    type: RecordType,
    queryFn: (resolver: DnsResolver, name: string) => Promise<string[]>,
  ): Promise<ResolverResult<string>['perResolver'][number]> {
    const resolver = new DnsResolver();
    resolver.setServers([resolverIp]);

    try {
      const records = await this.withTimeout(
        queryFn(resolver, name),
        DnsResolverService.QUERY_TIMEOUT_MS,
        `${type} ${name} via ${resolverIp}`,
      );
      return {
        resolver: resolverIp,
        status: 'success',
        records: records ?? [],
      };
    } catch (err: any) {
      // ENOTFOUND / ENODATA → "NXDOMAIN-ish": authoritative empty answer.
      // Treat as a successful empty result for consensus purposes (the resolver
      // DID respond — it just had no records).
      const code = err?.code as string | undefined;
      if (code === 'ENOTFOUND' || code === 'ENODATA') {
        return {
          resolver: resolverIp,
          status: 'nxdomain',
          records: [],
        };
      }
      this.logger.debug(
        `DNS ${type} lookup for "${name}" failed via ${resolverIp}: ${this.errorMessage(err)}`,
      );
      return {
        resolver: resolverIp,
        status: 'error',
        records: [],
        error: this.errorMessage(err),
      };
    }
  }

  /**
   * Consensus algorithm:
   *
   * 1. Discard resolvers with `status === 'error'` (they didn't speak — we
   *    can't count their silence). NXDOMAIN counts as a valid empty answer.
   * 2. Need at least 2 non-error resolvers; otherwise consensus = false.
   * 3. Bucket resolvers by their normalized record set (sorted JSON).
   *    The largest bucket wins; if its size >= 2, consensus = true and
   *    consensusRecords is that bucket's record set.
   * 4. If the winning bucket is empty/NXDOMAIN-only, consensusRecords = [].
   */
  private computeConsensus(
    perResolver: ResolverResult<string>['perResolver'],
  ): { consensus: boolean; consensusRecords: string[] } {
    const valid = perResolver.filter(
      (r) => r.status === 'success' || r.status === 'nxdomain',
    );

    if (valid.length < 2) {
      return { consensus: false, consensusRecords: [] };
    }

    const buckets = new Map<string, { records: string[]; count: number }>();
    for (const r of valid) {
      const key = this.canonicalize(r.records);
      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        buckets.set(key, { records: [...r.records], count: 1 });
      }
    }

    let winner: { records: string[]; count: number } | null = null;
    for (const bucket of buckets.values()) {
      if (!winner || bucket.count > winner.count) {
        winner = bucket;
      }
    }

    if (!winner || winner.count < 2) {
      return { consensus: false, consensusRecords: [] };
    }

    return { consensus: true, consensusRecords: [...winner.records].sort() };
  }

  private canonicalize(records: string[]): string {
    return JSON.stringify([...records].map((r) => r.trim()).sort());
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          Object.assign(
            new Error(`DNS query timeout after ${ms}ms: ${label}`),
            {
              code: 'ETIMEOUT',
            },
          ),
        );
      }, ms);
      p.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
}
