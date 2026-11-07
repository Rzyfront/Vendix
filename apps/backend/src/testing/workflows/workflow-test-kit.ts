import { AsyncLocalStorage } from 'async_hooks';
import { RequestContextService } from '@common/context/request-context.service';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import { WorkflowAdvanceService } from '../../domains/store/workflows/engine/workflow-advance.service';
import { WorkflowAssignmentService } from '../../domains/store/workflows/engine/workflow-assignment.service';
import { WorkflowCompleteService } from '../../domains/store/workflows/engine/workflow-complete.service';
import { WorkflowEngineService } from '../../domains/store/workflows/engine/workflow-engine.service';
import { WorkflowWebhookEmitter } from '../../domains/store/workflows/webhooks/workflow-webhook-emitter.service';
import { WorkflowEventsService } from '../../domains/store/workflows/engine/workflow-events.service';
import { WorkflowLoaderService } from '../../domains/store/workflows/engine/workflow-loader.service';
import { WorkflowReferenceService } from '../../domains/store/workflows/engine/workflow-reference.service';
import { DossierWorkflowRequirementsService } from '../../domains/store/workflows/engine/workflow-requirements.service';
import { WorkflowStageService } from '../../domains/store/workflows/engine/workflow-stage.service';
import { WorkflowStartService } from '../../domains/store/workflows/engine/workflow-start.service';
import { WorkflowTickService } from '../../domains/store/workflows/engine/workflow-tick.service';
import { DossiersService } from '../../domains/store/documents/dossiers.service';
import { StoredFilesService } from '../../domains/store/documents/stored-files.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { WorkflowCommentsService } from '../../domains/store/workflows/instances/workflow-comments.service';
import { WorkflowInboxService } from '../../domains/store/workflows/inbox/workflow-inbox.service';
import { WorkflowBoardService } from '../../domains/store/workflows/board/workflow-board.service';
import { WorkflowPublicLinksService } from '../../domains/store/workflows/public-link/workflow-public-links.service';
import { WorkflowPublicFormService } from '../../domains/ecommerce/workflows-public/workflow-public-form.service';
import { WorkflowFilesService } from '../../domains/store/workflows/files/workflow-files.service';
import { WorkflowInstancesService } from '../../domains/store/workflows/instances/workflow-instances.service';
import { WorkGroupsService } from '../../domains/store/workflows/work-groups.service';
import { FakeWorkflowDb } from './fake-workflow-prisma';

export interface TestCtx {
  store_id: number;
  organization_id: number;
  user_id?: number;
  is_owner?: boolean;
  is_super_admin?: boolean;
  permissions?: string[];
}

/** Whole engine wired on the in-memory fake. */
/** `unscopedTx` simulates a missing extension: only explicit predicates isolate. */
export function buildWorkflowKit(opts: { unscopedTx?: boolean } = {}) {
  const db = new FakeWorkflowDb();
  const prisma = db.asStorePrisma({ txScoped: !opts.unscopedTx });
  const groups = new WorkGroupsService(prisma);
  const loader = new WorkflowLoaderService();
  const events = new WorkflowEventsService(new WorkflowWebhookEmitter());
  const references = new WorkflowReferenceService();
  const assignment = new WorkflowAssignmentService(groups);
  const stages = new WorkflowStageService(assignment, events, prisma);
  const advancer = new WorkflowAdvanceService(stages, events);
  const dossiers = new DossiersService(prisma);
  const requirements = new DossierWorkflowRequirementsService(dossiers);
  const starter = new WorkflowStartService(loader, stages, events, references, dossiers, advancer);
  // S3 and audit are mocks: specs assert on `s3.uploadFile` / `deleteFile` / `getPresignedUrl`.
  const s3 = {
    uploadFile: jest.fn(async (_b: Buffer, key: string) => key),
    deleteFile: jest.fn(async () => undefined),
    getPresignedUrl: jest.fn(async (key: string, ttl: number) => `https://signed.example/${key}?ttl=${ttl}`),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const storedFiles = new StoredFilesService(prisma, s3 as any, new S3PathHelper(), audit as any);
  const completer = new WorkflowCompleteService(
    loader,
    assignment,
    requirements,
    advancer,
    events,
    stages,
  );
  const ticker = new WorkflowTickService(
    prisma,
    loader,
    assignment,
    advancer,
    stages,
    events,
  );
  const engine = new WorkflowEngineService(
    prisma,
    loader,
    assignment,
    starter,
    completer,
    advancer,
    stages,
    events,
    ticker,
  );
  const instances = new WorkflowInstancesService(prisma, assignment, requirements, dossiers, events);
  const workflowFiles = new WorkflowFilesService(
    prisma,
    loader,
    assignment,
    dossiers,
    storedFiles,
    instances,
  );
  const comments = new WorkflowCommentsService(prisma, instances, events);
  const inbox = new WorkflowInboxService(prisma);
  const board = new WorkflowBoardService(prisma, instances, requirements);
  const publicLinks = new WorkflowPublicLinksService(prisma);
  const publicForm = new WorkflowPublicFormService(prisma, engine);
  let ctx: TestCtx = {
    store_id: 1,
    organization_id: 1,
    user_id: 1,
    permissions: ['store:workflows:task'],
  };
  const scoped = new AsyncLocalStorage<TestCtx>();
  jest.spyOn(RequestContextService, 'getContext').mockImplementation(
    () => ({ is_super_admin: false, is_owner: false, ...(scoped.getStore() ?? RequestContextService.asyncLocalStorage.getStore() ?? ctx) }) as any,
  );
  return {
    db,
    prisma,
    engine,
    groups,
    dossiers,
    requirements,
    storedFiles,
    workflowFiles,
    instances,
    comments,
    inbox,
    board,
    publicLinks,
    publicForm,
    s3,
    audit,
    assignment,
    ticker,
    events,
    stages,
    as(next: Partial<TestCtx>) {
      ctx = { ...ctx, ...next };
    },
    ctx: () => ctx,
    /** Runs `fn` as another caller without touching the shared context (for concurrency). */
    runAs<T>(next: Partial<TestCtx>, fn: () => T): T {
      return scoped.run({ ...ctx, ...next }, fn);
    },
  };
}

/** Two stores, roles owner/manager, six users in store 1 (u1..u6), one in store 2. */
export function seedPeople(db: FakeWorkflowDb) {
  db.insert('stores', { id: 1, organization_id: 1, industries: ['administration'] });
  db.insert('stores', { id: 2, organization_id: 1, industries: ['administration'] });
  db.insert('roles', { id: 1, name: 'owner', organization_id: null, store_id: null });
  db.insert('roles', { id: 2, name: 'manager', organization_id: null, store_id: null });
  for (const id of [1, 2, 3, 4, 5, 6]) db.insert('store_users', { id, store_id: 1, user_id: id });
  db.insert('store_users', { id: 7, store_id: 2, user_id: 7 });
  db.insert('user_roles', { user_id: 2, role_id: 2, store_id: 1 });
  db.insert('user_roles', { user_id: 3, role_id: 2, store_id: 1 });
  db.insert('user_roles', { user_id: 1, role_id: 1, store_id: 1 });
}

export function seedWorkGroup(
  db: FakeWorkflowDb,
  key: string,
  userIds: number[],
  opts: { storeId?: number; unavailable?: number[] } = {},
) {
  const storeId = opts.storeId ?? 1;
  const g = db.insert('work_groups', {
    store_id: storeId,
    organization_id: 1,
    key,
    name: key,
  });
  userIds.forEach((user_id) =>
    db.insert('work_group_members', {
      store_id: storeId,
      work_group_id: g.id,
      user_id,
      is_available: !opts.unavailable?.includes(user_id),
    }),
  );
  return g;
}

/** Inserts an active definition with its published version; returns ids. */
export function seedDefinition(
  db: FakeWorkflowDb,
  definition: WorkflowDefinitionV1,
  storeId = 1,
) {
  const def = db.insert('workflow_definitions', {
    organization_id: 1,
    store_id: storeId,
    key: definition.key,
    name: definition.name,
    status: 'active',
    created_by_user_id: 1,
  });
  const version = db.insert('workflow_versions', {
    store_id: storeId,
    definition_id: def.id,
    version: 1,
    schema_version: 'vendix.workflow/v1',
    definition,
    definition_hash: 'x'.repeat(64),
    published_by_user_id: 1,
  });
  def.published_version_id = version.id;
  return { definitionId: def.id, versionId: version.id };
}

export const SAMPLE_FIELDS = [
  { key: 'amount', type: 'money', label: 'Monto', required: true },
  { key: 'reason', type: 'textarea', label: 'Motivo' },
  { key: 'invoice', type: 'file', label: 'Factura' },
] as const;

/** request(form) → amount branches → manager / board(quorum 2) / done. */
export function purchaseDefinition(
  overrides: Partial<WorkflowDefinitionV1> = {},
): WorkflowDefinitionV1 {
  return {
    schema: 'vendix.workflow/v1',
    key: 'purchase',
    name: 'Compra',
    fields: [...SAMPLE_FIELDS] as any,
    stages: [
      {
        key: 'request',
        name: 'Solicitud',
        type: 'form',
        start: true,
        assignee: { kind: 'initiator' },
        form: { fields: ['amount', 'reason'] },
        transitions: [
          { on: 'submit', to: 'board', when: { all: [{ field: 'amount', op: 'gt', value: 10000 }] } },
          { on: 'submit', to: 'manager', when: { all: [{ field: 'amount', op: 'gt', value: 1000 }] } },
          { on: 'submit', to: 'done' },
        ],
      },
      {
        key: 'manager',
        name: 'Aprobación del gerente',
        type: 'approval',
        assignee: { kind: 'role', role_key: 'manager' },
        transitions: [
          { on: 'approve', to: 'done' },
          { on: 'reject', to: 'rejected', require_comment: true },
        ],
      },
      {
        key: 'board',
        name: 'Junta',
        type: 'approval',
        assignee: { kind: 'group', group_key: 'board', strategy: 'any' },
        quorum: { required: 2 },
        transitions: [
          { on: 'approve', to: 'done' },
          { on: 'reject', to: 'rejected' },
        ],
      },
      { key: 'done', name: 'Aprobada', type: 'end', outcome: 'completed' },
      { key: 'rejected', name: 'Rechazada', type: 'end', outcome: 'rejected' },
    ],
    ...overrides,
  } as WorkflowDefinitionV1;
}

/** Public form: formulario (initiator) → revisión (manager) → listo / cerrado. */
export function publicFormDefinition(overrides: Partial<WorkflowDefinitionV1> = {}): WorkflowDefinitionV1 {
  return {
    schema: 'vendix.workflow/v1',
    key: 'pqr',
    name: 'Solicitud de servicio',
    description: 'Cuéntanos qué necesitas.',
    triggers: [{ kind: 'public_form' }],
    fields: [
      { key: 'asunto', type: 'text', label: 'Asunto', required: true },
      { key: 'tipo', type: 'select', label: 'Tipo', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
      { key: 'adjunto', type: 'file', label: 'Adjunto' },
    ],
    stages: [
      {
        key: 'formulario', name: 'Formulario', type: 'form', start: true,
        assignee: { kind: 'initiator' },
        form: { fields: ['asunto', 'tipo', 'adjunto'] },
        transitions: [{ on: 'submit', to: 'revision' }],
      },
      {
        key: 'revision', name: 'Revisión', type: 'approval',
        assignee: { kind: 'role', role_key: 'manager' },
        transitions: [{ on: 'approve', to: 'listo' }, { on: 'reject', to: 'cerrado' }],
      },
      { key: 'listo', name: 'Listo', type: 'end', outcome: 'completed' },
      { key: 'cerrado', name: 'Cerrado', type: 'end', outcome: 'rejected' },
    ],
    ...overrides,
  } as WorkflowDefinitionV1;
}
