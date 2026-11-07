import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { WorkflowLinks, WorkflowLinksApiService } from '../../services/workflow-links-api.service';
import { WorkflowEntityLinkComponent } from './workflow-entity-link.component';

const gate = (over: Partial<WorkflowLinks['gates'][number]> = {}): WorkflowLinks['gates'][number] => ({
  id: 1,
  operation: 'purchase_order.approve',
  operation_label: 'Compras: aprobar orden de compra',
  status: 'pending',
  reason: null,
  amount: '3000000',
  created_at: '2026-11-07T10:00:00Z',
  resolved_at: null,
  instance: { id: 9, reference: 'FLU-000123', status: 'active', stage_name: 'Aprobación gerente' },
  ...over,
});

@Component({
  standalone: true,
  imports: [WorkflowEntityLinkComponent],
  template: `<app-workflow-entity-link entityType="purchase_order" [entityId]="id()" [(pending)]="held" />`,
})
class HostComponent {
  readonly id = signal<number | null>(5);
  readonly held = signal(false);
}

describe('WorkflowEntityLinkComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let api: jasmine.SpyObj<WorkflowLinksApiService>;

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const render = async (links: Observable<WorkflowLinks>) => {
    api.getLinks.and.returnValue(links);
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    api = jasmine.createSpyObj('WorkflowLinksApiService', ['getLinks']);
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: WorkflowLinksApiService, useValue: api },
      ],
    });
  });

  it('shows the pending gate with its request and stage, and reports pending', async () => {
    await render(of({ pending: true, gates: [gate()], instances: [] }));
    expect(api.getLinks).toHaveBeenCalledWith('purchase_order', 5);
    expect(text()).toContain('Pendiente de aprobación');
    expect(text()).toContain('Solicitud FLU-000123');
    expect(text()).toContain('etapa Aprobación gerente');
    const link = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="workflow-gate-instance"]');
    expect(link?.getAttribute('href')).toBe('/admin/workflows/instances/9');
    expect(fixture.componentInstance.held()).toBeTrue();
  });

  it('shows the rejection reason and does not hold the record', async () => {
    await render(of({ pending: false, gates: [gate({ status: 'rejected', reason: 'Excede el presupuesto' })], instances: [] }));
    expect(text()).toContain('Rechazada: Excede el presupuesto');
    expect(fixture.componentInstance.held()).toBeFalse();
  });

  it('shows "Aprobada" for an approved gate', async () => {
    await render(of({ pending: false, gates: [gate({ status: 'approved' })], instances: [] }));
    expect(text()).toContain('Aprobada');
  });

  it('lists the related requests', async () => {
    await render(
      of({
        pending: false,
        gates: [],
        instances: [{ id: 4, reference: 'FLU-000004', status: 'active', stage_name: 'Revisión', definition_name: 'Compras' }],
      }),
    );
    expect(text()).toContain('Solicitudes relacionadas');
    expect(text()).toContain('FLU-000004');
  });

  it('renders nothing when there are no links or the request fails', async () => {
    await render(of({ pending: false, gates: [], instances: [] }));
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="workflow-entity-link"]')).toBeNull();
    await render(throwError(() => new Error('boom')));
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="workflow-entity-link"]')).toBeNull();
    expect(fixture.componentInstance.held()).toBeFalse();
  });

  it('does not call the API without an id', async () => {
    api.getLinks.and.returnValue(of({ pending: false, gates: [], instances: [] }));
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.id.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.getLinks).not.toHaveBeenCalled();
  });
});
