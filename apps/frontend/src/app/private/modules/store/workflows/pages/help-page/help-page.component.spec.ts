import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import {
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_STAGE_TYPES,
  WORKFLOW_VENDIX_ACTIONS,
} from '../../../../../../shared/workflows/contract/workflow-contract';
import { STAGE_TYPE_LABEL } from '../../editor/workflow-editor.utils';
import {
  WorkflowLimitsApiService,
  WorkflowUsageSnapshot,
} from '../../services/workflow-limits-api.service';
import { workflowsRoutes } from '../../routes/workflows.routes';
import { HELP_ENTRIES, HELP_GROUPS, NOT_DOING } from './help-page.data';
import { HelpPageComponent } from './help-page.component';
import { matchesQuery, normalizeText } from './help-page.util';

const SNAPSHOT: WorkflowUsageSnapshot = {
  period: '2026-11',
  metrics: [
    { key: 'monthly_instances', used: 3, cap: 3, percent: 100, state: 'blocked' },
    { key: 'monthly_http_calls', used: 40, cap: null, percent: null, state: 'unlimited' },
    { key: 'storage_bytes', used: 5 * 1024 * 1024, cap: 10 * 1024 * 1024 * 1024, percent: 0, state: 'ok' },
    { key: 'monthly_ai_tokens', used: 0, cap: null, percent: null, state: 'unavailable' },
  ],
};

/** Screens registered by the parent for P7 (not yet in workflows.routes.ts). */
const P7_PATHS = ['usage', 'audit', 'exports', 'help'];

describe('HelpPageComponent', () => {
  let fixture: ComponentFixture<HelpPageComponent>;
  let component: HelpPageComponent;
  let usage: jasmine.Spy<() => Observable<WorkflowUsageSnapshot>>;

  async function setup(response: Observable<WorkflowUsageSnapshot> = of(SNAPSHOT)): Promise<void> {
    usage = jasmine.createSpy('usage').and.returnValue(response);
    await TestBed.configureTestingModule({
      imports: [HelpPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: WorkflowLimitsApiService, useValue: { usage } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HelpPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = (id: string): HTMLElement | null => host().querySelector(`[data-testid="${id}"]`);

  async function search(text: string): Promise<void> {
    component.query.set(text);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function open(id: string): Promise<void> {
    (q(`question-${id}`) as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  describe('data', () => {
    it('has an FAQ entry for every stage type of the contract', () => {
      for (const type of WORKFLOW_STAGE_TYPES) {
        const entry = HELP_ENTRIES.find((e) => e.id === `stage-${type}`);
        expect(entry).withContext(type).toBeDefined();
        expect(entry?.question).toContain(STAGE_TYPE_LABEL[type]);
      }
    });

    it('routes every link to a registered screen or a P7 screen', () => {
      const registered = new Set([...workflowsRoutes.map((r) => r.path ?? ''), ...P7_PATHS]);
      const links = HELP_ENTRIES.flatMap((e) => e.links);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.path.startsWith('/admin/workflows')).withContext(link.path).toBeTrue();
        const relative = link.path.replace('/admin/workflows', '').replace(/^\//, '');
        expect(registered.has(relative)).withContext(link.path).toBeTrue();
      }
    });

    it('gives every entry a link, a known group and a unique id', () => {
      const groups = new Set(HELP_GROUPS.map((g) => g.id));
      const ids = HELP_ENTRIES.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const entry of HELP_ENTRIES) {
        expect(groups.has(entry.group)).withContext(entry.id).toBeTrue();
        expect(entry.links.length).withContext(entry.id).toBeGreaterThan(0);
      }
    });

    it('covers every requested group', () => {
      expect(HELP_GROUPS.map((g) => g.title)).toEqual([
        'Empezar',
        'Diseñar un flujo',
        'Etapas y tareas',
        'Formularios y enlaces públicos',
        'Documentos y firmas',
        'Integraciones',
        'IA',
        'Límites del plan',
        'Permisos y auditoría',
        'Exportación',
      ]);
      for (const group of HELP_GROUPS) {
        expect(HELP_ENTRIES.some((e) => e.group === group.id)).withContext(group.title).toBeTrue();
      }
    });
  });

  describe('search', () => {
    it('normalizes accents and case', () => {
      expect(normalizeText('  Aprobación ')).toBe('aprobacion');
    });

    it('finds the signature entry with and without accents or case', () => {
      const signature = HELP_ENTRIES.find((e) => e.id === 'signature');
      expect(signature).toBeDefined();
      for (const term of ['firma', 'FIRMA', 'firmas', 'electrónica', 'electronica']) {
        expect(matchesQuery(signature!, term)).withContext(term).toBeTrue();
      }
      expect(matchesQuery(signature!, 'zzzz')).toBeFalse();
    });

    it('shows only matching entries and groups on the page', async () => {
      await setup();
      expect(q('entry-signature')).not.toBeNull();
      await search('firma');
      expect(q('entry-signature')).not.toBeNull();
      expect(q('entry-what-is')).toBeNull();
      expect(q('group-export')).toBeNull();
      await search('APROBACION');
      expect(q('entry-stage-approval')).not.toBeNull();
      await search('aprobación');
      expect(q('entry-stage-approval')).not.toBeNull();
    });

    it('matches live catalog labels, for example an action of the registry', async () => {
      await setup();
      const label = WORKFLOW_ACTION_CATALOG[WORKFLOW_VENDIX_ACTIONS[0]].label;
      await search(label);
      expect(q('entry-actions')).not.toBeNull();
    });

    it('shows an empty message when nothing matches', async () => {
      await setup();
      await search('qwertyuiop');
      expect(q('help-empty')?.textContent).toContain('qwertyuiop');
      expect(q('not-doing')).toBeNull();
    });
  });

  describe('answers', () => {
    it('expands and collapses an answer', async () => {
      await setup();
      expect(host().textContent).not.toContain('Una persona llena un formulario');
      await open('stage-form');
      expect(host().textContent).toContain('Una persona llena un formulario');
      expect(q('question-stage-form')?.getAttribute('aria-expanded')).toBe('true');
      await open('stage-form');
      expect(host().textContent).not.toContain('Una persona llena un formulario');
    });

    it('lists the stage types of the contract in the live answer', async () => {
      await setup();
      await open('stage-types');
      const items = Array.from(host().querySelectorAll('[data-testid="live-stage_types"] li')).map(
        (li) => li.textContent?.trim(),
      );
      expect(items).toEqual(WORKFLOW_STAGE_TYPES.map((t) => STAGE_TYPE_LABEL[t]));
    });

    it('links an answer to its real screen', async () => {
      await setup();
      await open('my-tasks');
      const hrefs = Array.from(
        host().querySelectorAll('[data-testid="entry-my-tasks"] a'),
      ).map((a) => a.getAttribute('href'));
      expect(hrefs).toEqual(['/admin/workflows/inbox', '/admin/workflows/board']);
    });
  });

  describe('what Flujos does not do', () => {
    it('renders every honest limit', async () => {
      await setup();
      const section = q('not-doing');
      expect(section).not.toBeNull();
      expect(section!.querySelectorAll('li').length).toBe(NOT_DOING.length);
      const text = section!.textContent ?? '';
      for (const fragment of [
        'código arbitrario',
        'BPMN',
        'firma electrónica es simple',
        'Google Sheets',
        'aplicación móvil nativa',
      ]) {
        expect(text).withContext(fragment).toContain(fragment);
      }
      expect(host().textContent).toContain('Lo que Flujos no hace');
    });
  });

  describe('plan limits', () => {
    it('renders the live limits and the real limit behavior', async () => {
      await setup();
      await open('plan-limit');
      const text = host().textContent ?? '';
      expect(text).toContain('Mejorar plan');
      expect(text).toContain('nunca se detienen');
      expect(text).toContain('se avisa al dueño una vez al mes');
      expect(text).toContain('mensaje neutro');
      expect(q('limit-monthly_instances')?.textContent).toContain('3 de 3');
      expect(q('limit-monthly_http_calls')?.textContent).toContain('sin límite');
      expect(q('limit-storage_bytes')?.textContent).toContain('5 MB de 10 GB');
      expect(q('limit-monthly_ai_tokens')?.textContent).toContain('No incluido en tu plan');
      expect(usage).toHaveBeenCalledTimes(1);
    });

    it('keeps the answer and warns when the limits cannot be loaded', async () => {
      await setup(throwError(() => new Error('down')));
      await open('plan-limit');
      expect(host().textContent).toContain('Mejorar plan');
      expect(host().textContent).toContain('No se pudo cargar tu uso actual');
      expect(q('limits-live')).toBeNull();
    });
  });
});
