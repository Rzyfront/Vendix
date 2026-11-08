import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { Observable, of } from 'rxjs';
import {
  WorkflowDefinitionV1,
  WorkflowStageDef,
} from '../../../../../../../../shared/workflows/contract/workflow-contract';
import { AiStepTestResult } from '../../../../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../../../../services/workflows-api.service';
import { WorkflowEditorStore } from '../../../workflow-editor.store';
import { StageAiTestComponent } from './stage-ai-test.component';

const draft = {
  schema: 'vendix.workflow/v1',
  key: 'pqr',
  name: 'PQR',
  fields: [
    { key: 'asunto', type: 'text', label: 'Asunto' },
    { key: 'tipo', type: 'select', label: 'Tipo', options: [{ value: 'queja', label: 'Queja' }] },
  ],
  stages: [],
} as unknown as WorkflowDefinitionV1;

const stage: WorkflowStageDef = {
  key: 'clasificar',
  name: 'Clasificar',
  type: 'ai',
  ai: { task: 'classify', instructions: 'Clasifica la PQR', inputs: ['asunto'], outputs: ['tipo'] },
};

const success: AiStepTestResult = {
  status: 'success',
  values: { tipo: 'queja' },
  confidence: 0.91,
  reason: 'Menciona un cobro doble',
  model: 'modelo-x',
  tokens: 120,
};

describe('StageAiTestComponent', () => {
  let fixture: ComponentFixture<StageAiTestComponent>;
  const api = { testAiStep: jasmine.createSpy('testAiStep') };
  const dirty = signal(false);
  const el = () => fixture.nativeElement as HTMLElement;
  const button = () => el().querySelector('app-button button') as HTMLButtonElement;

  function setup(result: Observable<AiStepTestResult>, current: WorkflowStageDef = stage) {
    api.testAiStep.calls.reset();
    api.testAiStep.and.returnValue(result);
    dirty.set(false);
    TestBed.configureTestingModule({
      imports: [StageAiTestComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({ initialState: { tenant: { domainConfig: null } } }),
        { provide: WorkflowsApiService, useValue: api },
        {
          provide: WorkflowEditorStore,
          useValue: { draft: signal(draft), dirty, savingNow: signal(false), definitionId: signal(7) },
        },
      ],
    });
    fixture = TestBed.createComponent(StageAiTestComponent);
    fixture.componentRef.setInput('stage', current);
    fixture.detectChanges();
  }

  it('avisa que usa cupo de IA del plan y pide un dato de ejemplo por campo que lee', () => {
    setup(of(success));
    expect(el().textContent).toContain('Usa cupo de IA del plan');
    expect(el().textContent).toContain('Asunto');
  });

  it('con cambios sin guardar no deja probar y dice por qué', () => {
    setup(of(success));
    dirty.set(true);
    fixture.detectChanges();
    expect(button().disabled).toBeTrue();
    expect(el().querySelector('[data-testid="ai-test-blocker"]')?.textContent).toContain(
      'Guarda el borrador para probar este paso',
    );
    fixture.componentInstance.run();
    expect(api.testAiStep).not.toHaveBeenCalled();
  });

  it('prueba el paso guardado y muestra los campos, la confianza, el motivo, el modelo y los tokens', () => {
    setup(of(success));
    fixture.componentInstance.setSample('asunto', 'Me cobraron dos veces');
    fixture.componentInstance.run();
    fixture.detectChanges();
    expect(api.testAiStep).toHaveBeenCalledWith(7, { stage_key: 'clasificar', data: { asunto: 'Me cobraron dos veces' } });
    const text = el().querySelector('[data-testid="ai-test-success"]')?.textContent ?? '';
    expect(text).toContain('Tipo');
    expect(text).toContain('queja');
    expect(el().querySelector('[data-testid="ai-test-confidence"]')?.textContent).toContain('91 %');
    expect(text).toContain('Menciona un cobro doble');
    expect(text).toContain('modelo-x');
    expect(text).toContain('120 tokens');
  });

  it('muestra el mensaje en español cuando no hay cupo', () => {
    setup(of({ status: 'skipped_quota', message: 'El plan no tiene cupo de IA' }));
    fixture.componentInstance.run();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="ai-test-message"]')?.textContent).toContain('El plan no tiene cupo de IA');
  });

  it('un paso sin configurar no se puede probar', () => {
    setup(of(success), { ...stage, ai: { task: 'classify', instructions: '', inputs: ['asunto'], outputs: ['tipo'] } });
    expect(button().disabled).toBeTrue();
  });
});
