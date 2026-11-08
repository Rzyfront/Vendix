import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, throwError } from 'rxjs';
import { HttpActionApiService, HttpTestResult } from './http-action-api.service';
import { HttpActionTestComponent } from './http-action-test.component';

describe('HttpActionTestComponent: plan limit (P7.1)', () => {
  let fixture: ComponentFixture<HttpActionTestComponent>;
  const api = { test: jasmine.createSpy('test') };

  function setup(result: Observable<HttpTestResult>) {
    api.test.and.returnValue(result);
    TestBed.configureTestingModule({
      imports: [HttpActionTestComponent],
      providers: [provideZonelessChangeDetection(), { provide: HttpActionApiService, useValue: api }],
    });
    fixture = TestBed.createComponent(HttpActionTestComponent);
    fixture.componentRef.setInput('map', { method: 'GET', url: 'https://api.example.com/x' });
    fixture.detectChanges();
  }

  const failureOf = () => fixture.componentInstance.failure();

  it('a 402 plan limit shows no inline error (the paywall explains it)', () => {
    setup(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 402,
            error: { error_code: 'WORKFLOW_PLAN_LIMIT_REACHED', message: 'Llegaste al límite' },
          }),
      ),
    );
    fixture.componentInstance.run();
    fixture.detectChanges();
    expect(failureOf()).toBe('');
    expect(fixture.componentInstance.busy()).toBeFalse();
  });

  it('any other failure still shows its message', () => {
    setup(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: { error_code: 'WORKFLOW_FORM_INVALID', message: 'Falta la URL' },
          }),
      ),
    );
    fixture.componentInstance.run();
    expect(failureOf()).not.toBe('');
  });
});
