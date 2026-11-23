import {
  QUEUES_WITH_OWN_INCIDENTS,
  canEscalate,
  classifyPlanLimit,
  planLimitPeriod,
  positiveInt,
  readMonitorConfig,
  severityOfHttpFailure,
  severityOfQueue,
} from './platform-alert-policy';

describe('platform-alert-policy (S3: grave = ventas, pagos, DIAN, cargas masivas o sin servicio)', () => {
  it.each([
    ['/api/store/orders/:id', 'ventas'],
    ['/api/store/pos/sales', 'ventas'],
    ['/api/ecommerce/checkout', 'ventas'],
    ['/api/store/payments/:id', 'pagos'],
    ['/api/store/subscriptions/current', 'pagos'],
    ['/api/store/invoicing/:id/send', 'facturación DIAN'],
    ['/api/store/dian/config', 'facturación DIAN'],
    ['/api/store/products/bulk/upload', 'cargas masivas'],
  ])('5xx en %s es grave (%s)', (route, area) => {
    expect(severityOfHttpFailure(route, 500)).toEqual({ severity: 'critical', area });
  });

  it('5xx fuera de esas áreas es leve; 503 siempre es grave', () => {
    expect(severityOfHttpFailure('/api/store/products/:id', 500)).toEqual({
      severity: 'warning',
      area: null,
    });
    expect(severityOfHttpFailure('/api/store/products/:id', 503).severity).toBe('critical');
  });

  it('colas de pagos, DIAN, facturación y contabilidad son graves; el resto leves', () => {
    expect(severityOfQueue('subscription-billing')).toBe('critical');
    expect(severityOfQueue('dian-retry')).toBe('critical');
    expect(severityOfQueue('accounting-events')).toBe('critical');
    expect(severityOfQueue('email-notifications')).toBe('warning');
  });

  it('las colas de IA y de cargas masivas no se barren (ya avisan por incidente)', () => {
    expect(QUEUES_WITH_OWN_INCIDENTS.has('ai-scan')).toBe(true);
    expect(QUEUES_WITH_OWN_INCIDENTS.has('email-notifications')).toBe(false);
  });

  it('solo http y jobs suben a grave por repetirse; la latencia no', () => {
    expect(canEscalate('http')).toBe(true);
    expect(canEscalate('job')).toBe(true);
    expect(canEscalate('latency')).toBe(false);
    expect(canEscalate('incident')).toBe(false);
  });

  it('config: valores por defecto, MONITOR_ENABLED=false apaga, basura cae al defecto', () => {
    const env: Record<string, string> = {};
    const read = () => readMonitorConfig({ get: <T>(k: string) => env[k] as T });
    expect(read()).toMatchObject({
      enabled: true,
      slowRequestMs: 10_000,
      resolveAfterMinutes: 30,
      escalateAfter: 20,
      jobActiveStallMinutes: 15,
      jobWaitingStallMinutes: 5,
      telegramMaxPerMinute: 20,
    });
    env.MONITOR_ENABLED = 'false';
    env.MONITOR_SLOW_REQUEST_MS = '-5';
    env.MONITOR_ENV_LABEL = 'staging';
    expect(read()).toMatchObject({ enabled: false, slowRequestMs: 10_000, envLabel: 'staging' });
    expect(positiveInt('12.7', 1)).toBe(12);
    expect(positiveInt('abc', 4)).toBe(4);
  });
});

describe('clasificación «Límite de plan» (QUI-1031, S5)', () => {
  it('reconoce el cupo de IA agotado por el mensaje que guarda BullMQ, por el código o por el tipo', () => {
    const quota = { code: 'SUBSCRIPTION_006', label: 'la tienda agotó el cupo de IA de su plan en el periodo' };
    expect(classifyPlanLimit('job_failed', 'Error: AI quota exceeded for this billing period')).toEqual(quota);
    expect(classifyPlanLimit('HTTP_500', 'falló con SUBSCRIPTION_006 en el proveedor')).toEqual(quota);
    expect(classifyPlanLimit('SUBSCRIPTION_006', null)).toEqual(quota);
    expect(classifyPlanLimit('job_failed', 'Error: Feature not included in your current plan')?.code).toBe(
      'SUBSCRIPTION_005',
    );
    expect(classifyPlanLimit('WORKFLOW_PLAN_LIMIT_REACHED', '')?.code).toBe('WORKFLOW_PLAN_LIMIT_REACHED');
  });

  it('un fallo técnico no es límite de plan (ni un código parecido)', () => {
    expect(classifyPlanLimit('job_failed', 'Error: connect ECONNREFUSED 10.0.0.1:5432')).toBeNull();
    expect(classifyPlanLimit('HTTP_500', 'SUBSCRIPTION_0060 no existe')).toBeNull();
    expect(classifyPlanLimit('SUBSCRIPTION_007', 'otra cosa')).toBeNull();
    expect(classifyPlanLimit(null, null)).toBeNull();
  });

  it('periodo en UTC: mes para los cupos mensuales, día para el chat', () => {
    const at = new Date('2026-11-30T23:30:00-05:00'); // ya es 1 de diciembre en UTC
    expect(planLimitPeriod(at, 'rag_embeddings')).toBe('202612');
    expect(planLimitPeriod(at)).toBe('202612');
    expect(planLimitPeriod(at, 'streaming_chat')).toBe('20261201');
  });
});
