import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WORKFLOW_ACTION_CATALOG, WorkflowActionInputSpec } from '../../../../../../shared/workflows/contract/workflow-contract';
import { actionTokenOptions, vendixActionOptions } from '../workflow-editor-triggers.utils';
import { ActionMapEditorComponent } from './action-map-editor.component';

describe('ActionMapEditorComponent', () => {
  let fixture: ComponentFixture<ActionMapEditorComponent>;

  const render = (action: keyof typeof WORKFLOW_ACTION_CATALOG, map = {}) => {
    fixture = TestBed.createComponent(ActionMapEditorComponent);
    fixture.componentRef.setInput('action', action);
    fixture.componentRef.setInput('map', map);
    fixture.componentRef.setInput('fields', [{ key: 'monto', label: 'Monto', type: 'money' }]);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ActionMapEditorComponent],
      providers: [provideZonelessChangeDetection()],
    });
  });

  it('renders every registry input with its label and a required mark', () => {
    const el = render('vendix.customer.create');
    const inputs = WORKFLOW_ACTION_CATALOG['vendix.customer.create'].inputs as Record<string, WorkflowActionInputSpec>;
    const labels = Array.from(el.querySelectorAll('label')).map((l) => l.textContent ?? '');
    for (const spec of Object.values(inputs)) {
      expect(labels.some((l) => l.includes(spec.label))).toBeTrue();
    }
    const nameLabel = labels.find((l) => l.includes(inputs['first_name'].label)) ?? '';
    expect(nameLabel).toContain('*');
  });

  it('renders an enum input as a select of its values', () => {
    const entry = Object.entries(WORKFLOW_ACTION_CATALOG).find(([, spec]) =>
      Object.values(spec.inputs as Record<string, WorkflowActionInputSpec>).some((i) => i.type === 'enum'),
    );
    expect(entry).toBeDefined();
    const [name, spec] = entry!;
    const enumInput = Object.values(spec.inputs as Record<string, WorkflowActionInputSpec>).find((i) => i.type === 'enum')!;
    const el = render(name as keyof typeof WORKFLOW_ACTION_CATALOG);
    const optionTexts = Array.from(el.querySelectorAll('option')).map((o) => (o.textContent ?? '').trim());
    for (const value of enumInput.values ?? []) expect(optionTexts).toContain(value);
  });

  it('offers the request record token with its label', () => {
    const tokens = actionTokenOptions([]);
    expect(tokens).toContain({ value: '{{instance.subject_id}}', label: 'Registro de la solicitud' });
  });

  it('groups the action options by module', () => {
    const options = vendixActionOptions();
    expect(options[0].disabled).toBeTrue();
    expect(options.filter((o) => !o.disabled).length).toBe(Object.keys(WORKFLOW_ACTION_CATALOG).length);
  });
});
