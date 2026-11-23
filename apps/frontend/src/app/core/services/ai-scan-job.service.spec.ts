import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { AiJobProgressListener, AiScanJobService } from './ai-scan-job.service';
import { AiScanJobError } from '../utils/ai-job-error';
import { ERROR_MESSAGES } from '../utils/error-messages';
import { TenantFacade } from '../store/tenant/tenant.facade';
import { environment } from '../../../environments/environment';

/**
 * QUI-1020 — cliente de la cola `ai-scan`: backoff 1→2→4→10 s, reenganche tras
 * recargar, barra de progreso y error por categoría.
 *
 * El arnés de Karma es zoneless (`test-init.ts`): sin Zone.js no hay
 * `fakeAsync`, así que el tiempo se controla con el reloj de Jasmine.
 */
describe('AiScanJobService (QUI-1020)', () => {
  const URL = '/api/x/scan/async';
  const POLL = `${environment.apiUrl}/ai-scan-jobs/job-1`;
  const RESUME_KEY = 'vendix:ai-scan-job:9:rut';
  let service: AiScanJobService;
  let http: HttpTestingController;
  let storeId = 9;

  beforeEach(() => {
    storeId = 9;
    localStorage.removeItem(RESUME_KEY);
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-17T10:00:00Z'));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TenantFacade, useValue: { getCurrentStoreId: () => storeId } },
      ],
    });
    service = TestBed.inject(AiScanJobService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    jasmine.clock().uninstall();
    localStorage.removeItem(RESUME_KEY);
  });

  function enqueue(data: Record<string, unknown> = { job_id: 'job-1' }) {
    http.expectOne(URL).flush({ success: true, data });
  }

  function listener(): jasmine.SpyObj<Required<AiJobProgressListener>> {
    return jasmine.createSpyObj('progress', [
      'onUploadStart',
      'onResumable',
      'onEnqueued',
      'onResumed',
      'onStatus',
      'onCompleted',
      'onFailed',
    ]);
  }

  it('emite el resultado una vez y sondea con espera progresiva 1 → 2 → 4 s', () => {
    const out: unknown[] = [];
    service
      .enqueueAndWait<{ a: number }>(URL, new FormData())
      .subscribe((r) => out.push(r));
    enqueue();
    http.expectOne(POLL).flush({ status: 'waiting' });

    jasmine.clock().tick(999);
    http.expectNone(POLL);
    jasmine.clock().tick(1);
    http.expectOne(POLL).flush({ status: 'active' });

    jasmine.clock().tick(1_999);
    http.expectNone(POLL);
    jasmine.clock().tick(1);
    http.expectOne(POLL).flush({ status: 'active' });

    jasmine.clock().tick(4_000);
    http.expectOne(POLL).flush({ status: 'completed', result: { a: 1 } });
    jasmine.clock().tick(20_000);
    http.expectNone(POLL);
    expect(out).toEqual([{ a: 1 }]);
  });

  it('pasa el data del encolado a onEnqueued (QUI-1004)', () => {
    const seen: Record<string, unknown>[] = [];
    service
      .enqueueAndWait(URL, new FormData(), { onEnqueued: (d) => seen.push(d) })
      .subscribe();
    enqueue({ job_id: 'job-1', file_hash: 'h', file_name: 'f.pdf' });
    http.expectOne(POLL).flush({ status: 'completed', result: {} });
    expect(seen).toEqual([{ job_id: 'job-1', file_hash: 'h', file_name: 'f.pdf' }]);
  });

  it('falla si el encolado no trae job_id', () => {
    let err: Error | undefined;
    service.enqueueAndWait(URL, {}).subscribe({ error: (e) => (err = e) });
    enqueue({});
    expect(err?.message).toBe('No se pudo iniciar el escaneo');
  });

  it('sin job_id y con resultWithoutJob (documento ya procesado) termina de inmediato sin sondear', () => {
    const progress = listener();
    const out: unknown[] = [];
    service
      .enqueueAndWait(URL, {}, {
        progress,
        resumeKey: 'rut',
        resultWithoutJob: (d) => (d['already_processed'] ? { document_id: d['document_id'] } : undefined),
      })
      .subscribe((r) => out.push(r));
    enqueue({ job_id: null, already_processed: true, document_id: 7 });

    expect(out).toEqual([{ document_id: 7 }]);
    expect(progress.onCompleted).toHaveBeenCalledTimes(1);
    expect(progress.onEnqueued).not.toHaveBeenCalled();
    expect(service.hasPending('rut')).toBeFalse();
    jasmine.clock().tick(10_000);
    http.expectNone(() => true);
  });

  it('sin job_id y resultWithoutJob devuelve undefined: sigue siendo un fallo', () => {
    let err: Error | undefined;
    service
      .enqueueAndWait(URL, {}, { resultWithoutJob: () => undefined })
      .subscribe({ error: (e) => (err = e) });
    enqueue({ job_id: null });
    expect(err?.message).toBe('No se pudo iniciar el escaneo');
  });

  describe('categoría del fallo', () => {
    function failWith(status: Record<string, unknown>): AiScanJobError {
      let err: AiScanJobError | undefined;
      service.enqueueAndWait(URL, {}).subscribe({ error: (e) => (err = e) });
      enqueue();
      http.expectOne(POLL).flush({ status: 'failed', ...status });
      expect(err).toEqual(jasmine.any(AiScanJobError));
      return err as AiScanJobError;
    }

    it('documento ilegible -> categoría document con el texto del código', () => {
      const err = failWith({ error: 'RUT_SCAN_PARSE_FAIL', error_category: 'document' });
      expect(err.category).toBe('document');
      expect(err.message).toBe(ERROR_MESSAGES['RUT_SCAN_PARSE_FAIL']);
      expect(err.teamNotified).toBeFalse();
    });

    it('fallo de Vendix -> technical, sin culpar al documento y avisando al equipo', () => {
      const err = failWith({ error: 'RUT_SCAN_AI_FAIL', error_category: 'technical' });
      expect(err.category).toBe('technical');
      expect(err.message).toContain('no es un problema de tu documento');
      expect(err.teamNotified).toBeTrue();
    });

    it('IA sin créditos -> ai_unavailable/credits con mensaje claro', () => {
      const err = failWith({
        error: 'AI_PROVIDER_003',
        error_category: 'ai_unavailable',
        error_reason: 'credits',
      });
      expect(err.category).toBe('ai_unavailable');
      expect(err.reason).toBe('credits');
      expect(err.message).toContain('El servicio de IA no está respondiendo');
      expect(err.teamNotified).toBeTrue();
    });

    it('estado sin error_category (endpoint antiguo) -> se clasifica por el código', () => {
      expect(failWith({ error: 'MEMBER_SCAN_PARSE_FAIL' }).category).toBe('document');
      expect(failWith({ error: 'boom raw' }).category).toBe('technical');
    });
  });

  it('404 en el poll -> «ya no está disponible», sin reintentos', () => {
    let err: Error | undefined;
    service.enqueueAndWait(URL, {}).subscribe({ error: (e) => (err = e) });
    enqueue();
    http.expectOne(POLL).flush({}, { status: 404, statusText: 'Not Found' });
    jasmine.clock().tick(10_000);
    http.expectNone(POLL);
    expect(err?.message).toBe('El escaneo ya no está disponible. Vuelve a intentarlo.');
  });

  it('reintenta un 500 transitorio y luego completa', () => {
    const out: unknown[] = [];
    service.enqueueAndWait(URL, {}).subscribe((r) => out.push(r));
    enqueue();
    http.expectOne(POLL).flush({}, { status: 500, statusText: 'Server Error' });
    jasmine.clock().tick(1_000);
    http.expectOne(POLL).flush({ status: 'completed', result: { ok: true } });
    expect(out).toEqual([{ ok: true }]);
  });

  it('se rinde al tope del cliente y lo reporta como atascado', () => {
    let err: AiScanJobError | undefined;
    service
      .enqueueAndWait(URL, {}, { timeoutMs: 4_500, pollIntervalMs: 1_000 })
      .subscribe({ error: (e) => (err = e) });
    enqueue();
    jasmine.clock().tick(0);
    for (let i = 0; i < 4; i++) {
      http.expectOne(POLL).flush({ status: 'active' });
      jasmine.clock().tick(1_000);
    }
    jasmine.clock().tick(500);
    expect(err?.category).toBe('stalled');
    expect(err?.teamNotified).toBeFalse();
  });

  it('un poll con stalled:true deja de esperar, avisa que el equipo ya sabe y CONSERVA la clave de reenganche', () => {
    const progress = listener();
    let err: AiScanJobError | undefined;
    service
      .enqueueAndWait(URL, {}, { resumeKey: 'rut', progress })
      .subscribe({ error: (e) => (err = e) });
    enqueue();
    http.expectOne(POLL).flush({ status: 'active', stalled: true });
    expect(err?.category).toBe('stalled');
    expect(err?.teamNotified).toBeTrue();
    expect(err?.message).toContain('ya avisamos al equipo');
    expect(progress.onFailed).toHaveBeenCalledWith(err);
    expect(service.hasPending('rut')).toBeTrue();
    // No further polls are scheduled.
    jasmine.clock().tick(20_000);
    http.expectNone(POLL);
  });

  it('dispara onStall una sola vez', () => {
    let stalls = 0;
    service
      .enqueueAndWait(URL, {}, {
        onStall: () => stalls++,
        stallMs: 3_000,
        pollIntervalMs: 1_000,
      })
      .subscribe();
    enqueue();
    jasmine.clock().tick(0);
    http.expectOne(POLL).flush({ status: 'active' });
    for (let i = 0; i < 5; i++) {
      jasmine.clock().tick(1_000);
      http.expectOne(POLL).flush({ status: 'active' });
    }
    expect(stalls).toBe(1);
    jasmine.clock().tick(1_000);
    http.expectOne(POLL).flush({ status: 'completed', result: {} });
    expect(stalls).toBe(1);
  });

  it('alimenta la barra: subida, encolado, cada estado y el final', () => {
    const progress = listener();
    service.enqueueAndWait(URL, {}, { progress }).subscribe();
    expect(progress.onUploadStart).toHaveBeenCalledTimes(1);
    enqueue();
    expect(progress.onEnqueued).toHaveBeenCalledWith('job-1');
    const active = { status: 'active', progress: { done: 1, total: 3 } };
    http.expectOne(POLL).flush(active);
    expect(progress.onStatus).toHaveBeenCalledWith(jasmine.objectContaining(active));
    jasmine.clock().tick(1_000);
    http.expectOne(POLL).flush({ status: 'completed', result: {} });
    expect(progress.onCompleted).toHaveBeenCalledTimes(1);
    expect(progress.onFailed).not.toHaveBeenCalled();
  });

  it('un fallo llega a la barra ya clasificado', () => {
    const progress = listener();
    service.enqueueAndWait(URL, {}, { progress }).subscribe({ error: () => undefined });
    enqueue();
    http.expectOne(POLL).flush({ status: 'failed', error: 'AI_PROVIDER_003' });
    const [err] = progress.onFailed.calls.mostRecent().args as [AiScanJobError];
    expect(err.category).toBe('ai_unavailable');
    expect(progress.onCompleted).not.toHaveBeenCalled();
  });

  it('cola propia del dominio: sondea su statusUrl y desenvuelve { success, data }', () => {
    const legacyPoll = `${environment.apiUrl}/store/expenses/scan/job-1`;
    const out: unknown[] = [];
    const progress = listener();
    service
      .enqueueAndWait(URL, {}, {
        statusUrl: (id) => `${environment.apiUrl}/store/expenses/scan/${id}`,
        progress,
      })
      .subscribe((r) => out.push(r));
    enqueue();
    http.expectOne(legacyPoll).flush({ success: true, data: { status: 'active' } });
    expect(progress.onStatus).toHaveBeenCalledWith(jasmine.objectContaining({ status: 'active' }));
    jasmine.clock().tick(1_000);
    http
      .expectOne(legacyPoll)
      .flush({ success: true, data: { status: 'completed', result: { total: 5 } } });
    expect(out).toEqual([{ total: 5 }]);
  });

  describe('reenganche (resumeKey)', () => {
    it('recuerda el trabajo por tienda mientras corre y lo olvida al terminar', () => {
      service.enqueueAndWait(URL, {}, { resumeKey: 'rut' }).subscribe();
      enqueue();
      http.expectOne(POLL).flush({ status: 'active' });
      expect(JSON.parse(localStorage.getItem(RESUME_KEY) ?? '{}').jobId).toBe('job-1');
      expect(service.hasPending('rut')).toBeTrue();

      storeId = 12;
      expect(service.hasPending('rut')).toBeFalse();
      storeId = 9;

      jasmine.clock().tick(1_000);
      http.expectOne(POLL).flush({ status: 'completed', result: {} });
      expect(localStorage.getItem(RESUME_KEY)).toBeNull();
    });

    it('cerrar la pantalla a mitad deja el trabajo recordado y resume() lo retoma con su hora de inicio', () => {
      const first = service.enqueueAndWait(URL, {}, { resumeKey: 'rut' }).subscribe();
      enqueue();
      http.expectOne(POLL).flush({ status: 'active' });
      first.unsubscribe();
      expect(service.hasPending('rut')).toBeTrue();

      jasmine.clock().tick(30_000);
      const progress = listener();
      const out: unknown[] = [];
      const resumed = service.resume<{ ok: boolean }>('rut', { progress });
      expect(resumed).not.toBeNull();
      resumed!.subscribe((r) => out.push(r));
      expect(progress.onResumed).toHaveBeenCalledWith(
        Date.parse('2026-11-17T10:00:00Z'),
      );
      http.expectOne(POLL).flush({ status: 'completed', result: { ok: true } });
      expect(out).toEqual([{ ok: true }]);
      expect(progress.onCompleted).toHaveBeenCalledTimes(1);
      expect(service.hasPending('rut')).toBeFalse();
    });

    it('sin trabajo recordado, o vencido, resume() devuelve null', () => {
      expect(service.resume('rut')).toBeNull();
      localStorage.setItem(
        RESUME_KEY,
        JSON.stringify({ jobId: 'job-1', startedAt: Date.now() - 3 * 60 * 60 * 1000 }),
      );
      expect(service.resume('rut')).toBeNull();
      expect(localStorage.getItem(RESUME_KEY)).toBeNull();
    });

    it('un trabajo ajeno o borrado (404) se olvida', () => {
      localStorage.setItem(
        RESUME_KEY,
        JSON.stringify({ jobId: 'job-1', startedAt: Date.now() }),
      );
      let err: Error | undefined;
      service.resume('rut')!.subscribe({ error: (e) => (err = e) });
      http.expectOne(POLL).flush({}, { status: 404, statusText: 'Not Found' });
      expect(err).toEqual(jasmine.any(AiScanJobError));
      expect(localStorage.getItem(RESUME_KEY)).toBeNull();
    });

    it('guarda el data del encolado y el resumeMeta; pendingResume los lee sin retomar', () => {
      service
        .enqueueAndWait(URL, {}, {
          resumeKey: 'rut',
          resumeMeta: { target: 'img-3' },
        })
        .subscribe();
      enqueue({ job_id: 'job-1', duplicate_of: null, file_hash: 'abc' });
      http.expectOne(POLL).flush({ status: 'active' });
      expect(
        service.pendingResume<{ target: string }>('rut'),
      ).toEqual({
        data: { job_id: 'job-1', duplicate_of: null, file_hash: 'abc' },
        meta: { target: 'img-3' },
      });
      http.expectNone(POLL);
    });

    it('una entrada antigua (sin data ni meta) da data vacío y meta null', () => {
      localStorage.setItem(
        RESUME_KEY,
        JSON.stringify({ jobId: 'job-1', startedAt: Date.now() }),
      );
      expect(service.pendingResume('rut')).toEqual({ data: {}, meta: null });
      expect(service.pendingResume('otra')).toBeNull();
    });

    it('resume() llama onEnqueued con el data guardado antes de esperar', () => {
      localStorage.setItem(
        RESUME_KEY,
        JSON.stringify({
          jobId: 'job-1',
          startedAt: Date.now(),
          data: { job_id: 'job-1', file_hash: 'abc' },
          meta: null,
        }),
      );
      const onEnqueued = jasmine.createSpy('onEnqueued');
      service.resume('rut', { onEnqueued })!.subscribe();
      expect(onEnqueued).toHaveBeenCalledWith({ job_id: 'job-1', file_hash: 'abc' });
      http.expectOne(POLL).flush({ status: 'active' });
    });

    it('la espera del trabajo A no borra la clave de un trabajo B más nuevo', () => {
      service.enqueueAndWait(URL, {}, { resumeKey: 'rut' }).subscribe();
      enqueue();
      const pollA = http.expectOne(POLL);
      // The user launches another job under the same key.
      service
        .enqueueAndWait(URL, {}, { resumeKey: 'rut' })
        .subscribe();
      enqueue({ job_id: 'job-2' });
      pollA.flush({ status: 'completed', result: {} });
      expect(JSON.parse(localStorage.getItem(RESUME_KEY) ?? '{}').jobId).toBe('job-2');
      http.expectOne(`${environment.apiUrl}/ai-scan-jobs/job-2`).flush({ status: 'active' });
    });

    it('forget(key) sin jobId sigue borrando la clave', () => {
      service.enqueueAndWait(URL, {}, { resumeKey: 'rut' }).subscribe();
      enqueue();
      http.expectOne(POLL).flush({ status: 'active' });
      service.forget('rut');
      expect(service.hasPending('rut')).toBeFalse();
    });

    it('avisa a la barra que la espera es retomable (enqueueAndWait y resume), y solo con resumeKey', () => {
      const withKey = listener();
      service.enqueueAndWait(URL, {}, { resumeKey: 'rut', progress: withKey }).subscribe();
      expect(withKey.onResumable).toHaveBeenCalledTimes(1);
      enqueue();
      http.expectOne(POLL).flush({ status: 'completed', result: {} });

      const without = listener();
      service.enqueueAndWait(URL, {}, { progress: without }).subscribe();
      expect(without.onResumable).not.toHaveBeenCalled();
      enqueue();
      http.expectOne(POLL).flush({ status: 'completed', result: {} });

      localStorage.setItem(
        RESUME_KEY,
        JSON.stringify({ jobId: 'job-1', startedAt: Date.now() }),
      );
      const resumed = listener();
      service.resume('rut', { progress: resumed })!.subscribe();
      expect(resumed.onResumable).toHaveBeenCalledTimes(1);
      http.expectOne(POLL).flush({ status: 'completed', result: {} });
    });

    it('un fallo final también olvida el trabajo', () => {
      service.enqueueAndWait(URL, {}, { resumeKey: 'rut' }).subscribe({ error: () => undefined });
      enqueue();
      http.expectOne(POLL).flush({ status: 'failed', error: 'RUT_SCAN_AI_FAIL' });
      expect(localStorage.getItem(RESUME_KEY)).toBeNull();
    });
  });
});
