import { WorkflowStageDef } from '@common/workflows/contract';
import { DossiersService } from '../../documents/dossiers.service';
import { DossierWorkflowRequirementsService } from './workflow-requirements.service';

/**
 * P4.1 / P4.2: `issued_document` and `signature` requirements are evaluated
 * against the instance's current issued document (no longer always pending).
 */
describe('DossierWorkflowRequirementsService · documentos emitidos y firma', () => {
  const instance = { id: 7, data: {}, current_stage_key: 'contrato' };
  const stage = {
    key: 'contrato',
    name: 'Contrato',
    type: 'task',
    requirements: [
      {
        kind: 'issued_document',
        key: 'contrato',
        label: 'Contrato laboral',
        template_key: 'contrato-laboral',
      },
      { kind: 'signature', key: 'firma', label: 'Firma del contrato', of: 'contrato' },
    ],
  } as unknown as WorkflowStageDef;

  function serviceWith(status: string | null) {
    const dossiers = {
      currentIssuedStatus: jest.fn().mockResolvedValue(status),
      getByInstance: jest.fn(),
    } as unknown as DossiersService;
    return {
      svc: new DossierWorkflowRequirementsService(dossiers),
      dossiers: dossiers as unknown as { currentIssuedStatus: jest.Mock },
    };
  }

  it('without an issued document both stay pending', async () => {
    const { svc } = serviceWith(null);
    const pending = await svc.pendingRequirements(instance, stage);
    expect(pending.map((p) => p.key)).toEqual(['contrato', 'firma']);
  });

  it.each(['rendering', 'failed'])('a %s document keeps the requirement pending', async (status) => {
    const { svc } = serviceWith(status);
    const pending = await svc.pendingRequirements(instance, stage);
    expect(pending.map((p) => p.key)).toEqual(['contrato', 'firma']);
  });

  it.each(['issued', 'pending_signature'])(
    'a %s document satisfies issued_document; the signature stays pending',
    async (status) => {
      const { svc, dossiers } = serviceWith(status);
      const pending = await svc.pendingRequirements(instance, stage);
      expect(pending.map((p) => p.key)).toEqual(['firma']);
      expect(dossiers.currentIssuedStatus).toHaveBeenCalledWith(7, 'contrato', undefined);
    },
  );

  it('a signed document satisfies both', async () => {
    const { svc } = serviceWith('signed');
    expect(await svc.pendingRequirements(instance, stage)).toEqual([]);
  });

  it('a signature with blocks_exit false never blocks', async () => {
    const { svc } = serviceWith('issued');
    const nonBlocking = {
      ...stage,
      requirements: [
        stage.requirements![0],
        { kind: 'signature', key: 'firma', label: 'Firma', of: 'contrato', blocks_exit: false },
      ],
    } as unknown as WorkflowStageDef;
    expect(await svc.pendingRequirements(instance, nonBlocking)).toEqual([]);
  });
});
