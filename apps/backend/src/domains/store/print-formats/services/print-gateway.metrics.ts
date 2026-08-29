import { Injectable } from '@nestjs/common';
import { Histogram } from 'prom-client';

/**
 * [print-editor-dsk P9] — Prometheus instrumentation for `PrintGatewayService`.
 *
 * ONE histogram, three labels:
 *  - `format_type`      : the `print_format_type_enum` value (e.g. `pos_sale_ticket`,
 *                         `fiscal_electronic_invoice`, `dispatch_ticket`). High-cardinality
 *                         source — bounded by the enum (~15 values today).
 *  - `engine`           : `'html'` or `'pdf'`. Only `fiscal_electronic_invoice` /
 *                         `fiscal_credit_note` exercise `'pdf'`; the histogram
 *                         still spans both engines to avoid per-engine dashboards.
 *  - `organization_id`  : scoping label so a multi-org cluster can slice render
 *                         cost per tenant. The id is a number — coerced via
 *                         `String()` to satisfy `prom-client`'s string label type.
 *
 * Buckets are tuned for the expected workload: most renders finish in 50–250ms
 * (single-page HTML composition + composer walk). The `5s` upper bound catches
 * pathological cases (large quotation with hundreds of rows, PDF with embedded
 * logo) without flooding the histogram with empty buckets.
 *
 * This service is a pure Prometheus adapter — it does NOT touch Prisma,
 * AsyncLocalStorage, or any request-scoped state. The caller (`PrintGatewayService`)
 * owns the timing and the `organization_id` resolution (via the `StorePrismaService`
 * already injected into the gateway).
 */
@Injectable()
export class PrintGatewayMetricsService {
  private readonly renderDuration = new Histogram({
    name: 'vendix_print_format_render_duration_seconds',
    help: 'Time to render a print document via the PrintGateway (HTML composition + PDF render when applicable).',
    labelNames: ['format_type', 'engine', 'organization_id'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  });

  /**
   * Record one render observation.
   *
   * The `duration_seconds` MUST be measured by the caller with `process.hrtime.bigint()`
   * and converted to seconds. We do NOT call `Date.now()` here because the gateway
   * already does that for the log line and we want ONE measurement to feed both
   * signals — splitting them would double the cost of `now()` per render.
   */
  observe(opts: {
    format_type: string;
    engine: string;
    organization_id: string;
    duration_seconds: number;
  }): void {
    // `prom-client` v15 strictly validates that the labels object passed
    // to `observe` ONLY contains keys declared in `labelNames` — passing
    // the full `opts` (which carries `duration_seconds`) throws
    // `Added label "duration_seconds" is not included in initial labelset`.
    // We destructure here so the histogram contract is explicit and the
    // adapter signature stays a single object for callers.
    const { duration_seconds, ...labels } = opts;
    this.renderDuration.observe(labels, duration_seconds);
  }
}
