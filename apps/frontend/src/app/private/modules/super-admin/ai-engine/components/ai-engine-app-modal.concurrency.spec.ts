import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { AIEngineAppModalComponent } from './ai-engine-app-modal.component';

describe('AIEngineAppModalComponent speech concurrency', () => {
  it('compiles and saves only a valid concurrency, keeping other keys', () => {
    TestBed.configureTestingModule({
      imports: [AIEngineAppModalComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideMockStore({ initialState: {} })],
    });
    const fixture = TestBed.createComponent(AIEngineAppModalComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('app', {
      key: 'vexi_voice_tts',
      model_type: 'speech',
      metadata: { speech: { voice: 'v', extra: 1 } },
    } as any);
    const c = fixture.componentInstance as any;
    c.currentModelType.set('speech');
    fixture.detectChanges();
    expect(c.buildMetadata({ speech: { voice: 'v', max_concurrency: '2' } }).speech).toEqual(
      jasmine.objectContaining({ voice: 'v', extra: 1, max_concurrency: 2 }),
    );
    expect(c.buildMetadata({ speech: { voice: 'v', max_concurrency: '1.5' } }).speech.max_concurrency).toBeUndefined();
    expect(c.buildMetadata({ speech: { voice: 'v', max_concurrency: 20 } }).speech.max_concurrency).toBeUndefined();
    expect(document.body.textContent).toContain('Llamadas simultáneas');
  });
});
