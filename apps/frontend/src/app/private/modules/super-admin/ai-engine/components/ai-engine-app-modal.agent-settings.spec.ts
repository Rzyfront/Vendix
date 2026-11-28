import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { AIEngineAppModalComponent } from './ai-engine-app-modal.component';

/**
 * Apps whose service reads its own JSON keys (Vex classifier and agent
 * guardrail): typed fields instead of JSON, merged so nothing else is lost.
 */
function open(app: Record<string, unknown>) {
  TestBed.configureTestingModule({
    imports: [AIEngineAppModalComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideMockStore({ initialState: {} }),
    ],
  });
  const fixture = TestBed.createComponent(AIEngineAppModalComponent);
  fixture.componentRef.setInput('isOpen', true);
  fixture.componentRef.setInput('app', {
    name: 'App',
    model_type: 'text',
    output_format: 'json',
    ai_feature_category: 'conversations',
    is_active: false,
    config_id: null,
    ...app,
  } as any);
  const component = fixture.componentInstance as any;
  component.ngOnChanges();
  fixture.detectChanges();
  const emitted: any[] = [];
  component.submit.subscribe((data: unknown) => emitted.push(data));
  return { fixture, component, emitted };
}

describe('AIEngineAppModalComponent agent settings', () => {
  it('guardrail: edits thresholds and scopes without JSON, keeping unknown keys', () => {
    const { component, emitted } = open({
      key: 'agent_guardrail',
      retry_config: { maxRetries: 0, timeout_ms: 1500 },
      metadata: {
        min_confidence: 0.6,
        cooldown_seconds: 600,
        extra_key: 'keep',
        agents: { vex: { enabled: true, scope: 'Alcance viejo' }, vexi: { enabled: true } },
      },
    });
    expect(document.body.textContent).toContain('Guardarraíl: cuándo cortar');
    expect(document.body.textContent).toContain('Revisar los mensajes de Vexi');
    expect(component.form.get('agent.cooldown_minutes').value).toBe(10);
    expect(component.form.get('agent.vex_scope').value).toBe('Alcance viejo');

    component.form.get('agent').patchValue({
      min_confidence: '0.8',
      cooldown_minutes: '5',
      strikes_before_cooldown: '',
      vex_scope: '',
      vexi_enabled: false,
      timeout_ms: '1200',
    });
    component.onSubmit();

    const data = emitted[0];
    expect(data.metadata).toEqual(
      jasmine.objectContaining({
        min_confidence: 0.8,
        cooldown_seconds: 300,
        extra_key: 'keep',
      }),
    );
    expect(data.metadata.strikes_before_cooldown).toBeUndefined();
    // Empty scope → key removed → the service applies its default.
    expect(data.metadata.agents.vex).toEqual({ enabled: true });
    expect(data.metadata.agents.vexi).toEqual({ enabled: false });
    // `Reintentos = 0` stays 0 (no longer saved as 3) and timeout_ms survives.
    expect(data.retry_config).toEqual(
      jasmine.objectContaining({ maxRetries: 0, timeout_ms: 1200 }),
    );
  });

  it('vex classifier: adapter, timeouts and turn cap land in their own columns', () => {
    const { component, emitted } = open({
      key: 'vex_classifier',
      rate_limit: { max_calls_per_turn: 3 },
      retry_config: { timeout_ms: 800, total_timeout_ms: 1200, max_retries: 1 },
      metadata: { adapter: 'auto', criteria_version: 'v1', min_confidence: 0 },
    });
    expect(document.body.textContent).toContain('Clasificador de Vex');
    component.form.get('agent').patchValue({
      adapter: 'chat',
      max_calls_per_turn: '2',
      total_timeout_ms: '',
    });
    component.onSubmit();
    const data = emitted[0];
    expect(data.metadata).toEqual({
      adapter: 'chat',
      criteria_version: 'v1',
      min_confidence: 0,
    });
    expect(data.rate_limit).toEqual({ max_calls_per_turn: 2 });
    expect(data.retry_config).toEqual({ timeout_ms: 800, max_retries: 1 });
  });

  it('responder: templates are edited as text; other apps show no agent section', () => {
    const { component, emitted } = open({
      key: 'agent_guardrail_responder',
      metadata: { max_chars: 400, templates: { vex: { off_topic: 'A' } } },
    });
    component.form.get('agent').patchValue({ vexi_abuse: '  Texto propio  ', vex_off_topic: '' });
    component.onSubmit();
    expect(emitted[0].metadata.templates).toEqual({
      vex: {},
      vexi: { abuse: 'Texto propio' },
    });
    TestBed.resetTestingModule();

    const other = open({ key: 'invoice_ocr', metadata: { foo: 1 } });
    expect(other.component.agentSettingsKind()).toBeNull();
    other.component.onSubmit();
    expect(other.emitted[0].metadata).toEqual({ foo: 1 });
  });
});
