import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Observable, Subject, of } from 'rxjs';

import { CrmMainPageComponent } from './crm-main-page.component';
import { CrmService } from '../../services/crm.service';
import { CrmLandingState } from '../../models/crm.model';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { AiScanJobService } from '../../../../../../core/services/ai-scan-job.service';
import { ToastService } from '../../../../../../shared/components';

/**
 * QUI-1020 — «Regenerar con IA» must not start a second generation while the
 * first one runs. The class is built in an injection context (no template:
 * the editor child is not needed for this rule).
 */
describe('CrmMainPageComponent — generación con IA (QUI-1020)', () => {
  const LANDING: CrmLandingState = {
    enabled: true,
    generation_status: 'ready',
    content_json: null,
    published_json: null,
    published_at: null,
    version: 1,
    last_job_id: null,
  };

  let job$: Subject<{ ready: boolean }>;
  const aiJobs = {
    enqueueAndWait: jasmine.createSpy('enqueueAndWait'),
    resume: jasmine.createSpy('resume'),
  };

  function build(): CrmMainPageComponent {
    return TestBed.runInInjectionContext(() => new CrmMainPageComponent());
  }

  const regenerateAction = (c: CrmMainPageComponent) =>
    c.headerActions().find((a) => a.id === 'regenerate');

  beforeEach(() => {
    job$ = new Subject<{ ready: boolean }>();
    aiJobs.enqueueAndWait.calls.reset();
    aiJobs.enqueueAndWait.and.callFake(
      (
        _url: string,
        _body: unknown,
        opts?: {
          progress?: { onUploadStart?: () => void };
          onEnqueued?: (data: Record<string, unknown>) => void;
        },
      ): Observable<unknown> => {
        // Same order as the real client: upload, then the enqueue response.
        opts?.progress?.onUploadStart?.();
        opts?.onEnqueued?.({ ...LANDING, job_id: 'job-1' });
        return job$.asObservable();
      },
    );
    aiJobs.resume.calls.reset();
    aiJobs.resume.and.returnValue(null);
    TestBed.configureTestingModule({
      providers: [
        { provide: AiScanJobService, useValue: aiJobs },
        {
          provide: CrmService,
          useValue: {
            getLanding: () => of({ success: true, data: LANDING }),
            activateUrl: '/api/store/crm/activate',
            generationStatusUrl: (id: string) => `/api/store/crm/gen/${id}`,
          },
        },
        {
          provide: AuthFacade,
          useValue: { userDomainHostname: signal<string | null>(null) },
        },
        {
          provide: ToastService,
          useValue: { success: () => undefined, error: () => undefined, info: () => undefined },
        },
      ],
    });
  });

  it('mientras una generación corre, «Regenerar» queda deshabilitado y no encola otra', () => {
    const page = build();
    expect(regenerateAction(page)?.disabled).toBeFalse();

    page.regenerate();
    expect(aiJobs.enqueueAndWait).toHaveBeenCalledTimes(1);
    expect(page.generationProgress.running()).toBeTrue();
    expect(regenerateAction(page)?.disabled).toBeTrue();

    page.regenerate();
    expect(aiJobs.enqueueAndWait).toHaveBeenCalledTimes(1);
  });

  it('al terminar la generación vuelve a permitir regenerar', () => {
    const page = build();
    page.regenerate();
    page.generationProgress.onCompleted();
    job$.next({ ready: true });
    // Finishing jumps to the design tab; «Regenerar» lives on the status tab.
    expect(page.tab()).toBe('diseno');
    page.tab.set('estado');
    expect(page.generationProgress.running()).toBeFalse();
    expect(regenerateAction(page)?.disabled).toBeFalse();
    page.regenerate();
    expect(aiJobs.enqueueAndWait).toHaveBeenCalledTimes(2);
  });

  it('una generación retomada tras recargar también bloquea «Regenerar»', () => {
    aiJobs.resume.and.callFake(
      (_key: string, opts?: { progress?: { onResumed?: (t: number) => void } }) => {
        opts?.progress?.onResumed?.(Date.now());
        return job$.asObservable();
      },
    );
    const page = build();
    expect(page.generationProgress.running()).toBeTrue();
    expect(regenerateAction(page)?.disabled).toBeTrue();
    page.regenerate();
    expect(aiJobs.enqueueAndWait).not.toHaveBeenCalled();
  });
});
