import { Test, TestingModule } from '@nestjs/testing';
import { Histogram, Registry } from 'prom-client';
import { PrintGatewayMetricsService } from '../../domains/store/print-formats/services/print-gateway.metrics';

/**
 * [print-editor-dsk P9] — Prometheus adapter unit specs.
 *
 * `prom-client` v15 exposes `Histogram.get()` as a Promise and treats
 * `labelNames` / `help` as private (no public getter). We work with the
 * public surface only:
 *  - `Histogram` instance check (`service['renderDuration']` is a Histogram).
 *  - `observe()` does not throw.
 *  - The metric registers with the default registry under the expected
 *    metric name (`vendix_print_format_render_duration_seconds`).
 *
 * The deep assertions (bucket counters, label cardinality) live in
 * `prom-client`'s own suite — we just pin the public contract.
 */
describe('PrintGatewayMetricsService [print-editor-dsk P9]', () => {
  let service: PrintGatewayMetricsService;
  let registry: Registry;

  beforeEach(async () => {
    // Use a FRESH registry per test so `clearRegister` doesn't leak across
    // runs. `prom-client` exposes `register` as the default registry; the
    // service attaches its histogram to that default registry on init.
    registry = (await import('prom-client')).register;
    registry.clear?.();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PrintGatewayMetricsService],
    }).compile();
    service = module.get(PrintGatewayMetricsService);
  });

  it('instantiates with a vendix_print_format_render_duration_seconds histogram', () => {
    expect(service).toBeDefined();
    const h = service['renderDuration'] as Histogram<string>;
    expect(h).toBeInstanceOf(Histogram);
  });

  it('registers the metric under the expected name on the default registry', async () => {
    // Allow the metric to settle in the registry.
    const metrics = await registry.getMetricsAsJSON();
    // The metric MUST be present under its full Prometheus name.
    const found = metrics.find(
      (m) => m.name === 'vendix_print_format_render_duration_seconds',
    );
    expect(found).toBeDefined();
    expect(found?.type).toBe('histogram');
  });

  it('observe() records one observation without throwing', () => {
    expect(() =>
      service.observe({
        format_type: 'pos_sale_ticket',
        engine: 'html',
        organization_id: '42',
        duration_seconds: 0.123,
      }),
    ).not.toThrow();
  });

  it('observe() with a second organization_id creates an independent label slice', async () => {
    // Observe under TWO different organization_ids; both labels MUST
    // surface in the registered metric's `values` array. This proves
    // we are NOT collapsing labels in the adapter.
    service.observe({
      format_type: 'fiscal_electronic_invoice',
      engine: 'pdf',
      organization_id: '7',
      duration_seconds: 2.5,
    });
    service.observe({
      format_type: 'fiscal_electronic_invoice',
      engine: 'pdf',
      organization_id: '8',
      duration_seconds: 1.25,
    });

    const metrics = await registry.getMetricsAsJSON();
    const target = metrics.find(
      (m) => m.name === 'vendix_print_format_render_duration_seconds',
    );
    expect(target).toBeDefined();
    const orgs = new Set(
      (target?.values ?? [])
        .map((v) => v.labels?.organization_id)
        .filter((id): id is string => typeof id === 'string'),
    );
    expect(orgs.has('7')).toBe(true);
    expect(orgs.has('8')).toBe(true);
  });
});
