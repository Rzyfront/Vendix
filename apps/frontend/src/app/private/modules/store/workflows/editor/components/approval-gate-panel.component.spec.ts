import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { WorkflowDefinitionV1 } from '../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../workflow-editor.store';
import { ApprovalGatePanelComponent } from './approval-gate-panel.component';

const definition = (over: Partial<WorkflowDefinitionV1> = {}): WorkflowDefinitionV1 =>
  ({
    schema: 'vendix.workflow/v1',
    key: 'compras',
    name: 'Compras',
    fields: [{ key: 'proveedor', label: 'Proveedor', type: 'text' }],
    stages: [],
    ...over,
  }) as WorkflowDefinitionV1;

describe('ApprovalGatePanelComponent', () => {
  let fixture: ComponentFixture<ApprovalGatePanelComponent>;
  let component: ApprovalGatePanelComponent;
  const draft = signal<WorkflowDefinitionV1 | null>(null);
  const store = {
    draft,
    patchDefinition: jasmine.createSpy('patchDefinition').and.callFake((patch: Partial<WorkflowDefinitionV1>) =>
      draft.update((d) => ({ ...(d as WorkflowDefinitionV1), ...patch })),
    ),
  };

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(() => {
    store.patchDefinition.calls.reset();
    draft.set(definition());
    TestBed.configureTestingModule({
      imports: [ApprovalGatePanelComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({ initialState: { tenant: { domainConfig: null } } }),
        { provide: WorkflowEditorStore, useValue: store },
      ],
    });
    fixture = TestBed.createComponent(ApprovalGatePanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows no configuration while the lock is off', () => {
    expect(text()).toContain('Candado de aprobación');
    expect(fixture.nativeElement.querySelector('[data-testid="gate-config"]')).toBeNull();
  });

  it('turning it on governs the first operation, turning it off removes governs', () => {
    component.setEnabled(true);
    fixture.detectChanges();
    expect(draft()?.governs).toEqual({ operation: 'purchase_order.approve' });
    expect(fixture.nativeElement.querySelector('[data-testid="gate-config"]')).not.toBeNull();
    expect(text()).toContain('Total de la orden desde');
    component.setEnabled(false);
    fixture.detectChanges();
    expect(draft()?.governs).toBeUndefined();
  });

  it('stores the threshold and the field map with operation tokens', () => {
    component.setEnabled(true);
    component.setMinAmount(2000000);
    component.setMap('proveedor', '{{event.supplier_name}}');
    expect(draft()?.governs).toEqual({
      operation: 'purchase_order.approve',
      min_amount: 2000000,
      map: { proveedor: '{{event.supplier_name}}' },
    });
    component.setMap('proveedor', '');
    expect(draft()?.governs).toEqual({ operation: 'purchase_order.approve', min_amount: 2000000 });
    component.setMinAmount('');
    expect(draft()?.governs).toEqual({ operation: 'purchase_order.approve' });
  });

  it('changing the operation keeps the threshold and drops the map', () => {
    component.setEnabled(true);
    component.setMinAmount(500);
    component.setMap('proveedor', '{{event.supplier_name}}');
    component.setOperation('expense.approve');
    expect(draft()?.governs).toEqual({ operation: 'expense.approve', min_amount: 500 });
  });

  it('groups the operations by module with catalog labels', () => {
    const headers = component.operationOptions.filter((o) => o.disabled);
    expect(headers.map((h) => h.label)).toContain('— Compras —');
    expect(component.operationOptions.map((o) => o.label)).toContain('Compras: aprobar orden de compra');
  });
});
