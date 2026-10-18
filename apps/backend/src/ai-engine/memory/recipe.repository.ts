import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { RequestContextService } from '../../common/context/request-context.service';
import { buildActiveUserRolesWhere } from '../../common/utils/role-scope.util';
import { requireObjectiveScope } from '../tasks/agent-objective.repository';
import type { ObjectiveScope } from '../tasks/interfaces/agent-objective.interface';
import { catalogHash } from '../tools/tool-catalog';
import {
  AgentRecipe,
  RecipeTemplate,
  RecipeReview,
  RecipeStatus,
} from './recipe.interface';

const json = (value: unknown) => Prisma.sql`${JSON.stringify(value)}::jsonb`;
const owner = (s: ObjectiveScope) =>
  Prisma.sql`knowledge_scope='store' AND store_id=${s.store_id} AND organization_id=${s.organization_id} AND user_id=${s.user_id}`;
const published = Prisma.sql`status='approved' AND approved_at IS NOT NULL AND expires_at>CURRENT_TIMESTAMP AND review IS NOT NULL`;

/** Tenant calls use explicit ALS + owner predicates even though StorePrisma is also scoped.
 * Global reads/publication are separate, system-controlled APIs; no OR tenant0 SQL. */
@Injectable()
export class RecipeRepository {
  constructor(
    private readonly store: StorePrismaService,
    private readonly system: GlobalPrismaService,
  ) {}

  async currentOwnerPermissions(
    snapshot: string[],
  ): Promise<{ permissions: string[]; industries: string[] }> {
    const scope = requireObjectiveScope();
    const [user, shop, member, assignments] = await Promise.all([
      this.system.users.findFirst({
        where: { id: scope.user_id, organization_id: scope.organization_id },
        select: { state: true, locked_until: true },
      }),
      this.system.stores.findFirst({
        where: {
          id: scope.store_id,
          organization_id: scope.organization_id,
          is_active: true,
        },
        select: { industries: true },
      }),
      this.system.store_users.findUnique({
        where: {
          store_id_user_id: {
            store_id: scope.store_id,
            user_id: scope.user_id,
          },
        },
        select: { id: true },
      }),
      this.system.user_roles.findMany({
        where: buildActiveUserRolesWhere(scope.user_id, scope.store_id),
        include: {
          roles: {
            include: { role_permissions: { include: { permissions: true } } },
          },
        },
      }),
    ]);
    // Deliberately conservative: F requires direct store membership, including for owners.
    if (
      !user ||
      user.state !== 'active' ||
      (user.locked_until && user.locked_until > new Date()) ||
      !shop ||
      !member
    )
      throw new NotFoundException('Recipe not found');
    const granted = new Set(
      assignments.flatMap((a) =>
        (a.roles?.role_permissions ?? [])
          .filter((p) => p.granted && p.permissions.status === 'active')
          .map((p) => p.permissions.name),
      ),
    );
    return {
      permissions: snapshot.filter((p) => granted.has(p)),
      industries: shop.industries,
    };
  }

  async candidate(
    template: RecipeTemplate,
    provenance: {
      objective_id: string;
      evidence_refs: string[];
      trace_ids: string[];
      script_refs: string[];
    },
  ): Promise<AgentRecipe> {
    const scope = requireObjectiveScope();
    const hash = catalogHash(template),
      key = `workflow:${template.workflow}`,
      version = `f1-${hash.slice(0, 40)}`;
    const identity = catalogHash([scope, key, version]);
    const rows = await this.store.$queryRaw<AgentRecipe[]>(Prisma.sql`
      INSERT INTO ai_agent_recipes(identity_key,knowledge_scope,store_id,organization_id,user_id,recipe_key,version,template,content_hash,
        source_trace_ids,source_objective_ids,source_evidence_refs,source_script_refs)
      VALUES(${identity},'store',${scope.store_id},${scope.organization_id},${scope.user_id},${key},${version},${json(template)},${hash},
        ${json(provenance.trace_ids)},${json([provenance.objective_id])},${json(provenance.evidence_refs)},${json(provenance.script_refs)})
      ON CONFLICT(identity_key) DO NOTHING RETURNING *`);
    if (rows[0]) return rows[0];
    const existing = await this.store.$queryRaw<AgentRecipe[]>(
      Prisma.sql`SELECT * FROM ai_agent_recipes WHERE identity_key=${identity} AND ${owner(scope)}`,
    );
    if (!existing[0]) throw new NotFoundException('Recipe not found');
    return existing[0]; // replay is idempotent; never erase failures/review or republish.
  }

  async privateGet(id: number): Promise<AgentRecipe> {
    const scope = requireObjectiveScope();
    const rows = await this.store.$queryRaw<AgentRecipe[]>(
      Prisma.sql`SELECT * FROM ai_agent_recipes WHERE id=${id} AND ${owner(scope)}`,
    );
    if (!rows[0]) throw new NotFoundException('Recipe not found');
    return rows[0];
  }
  async available(): Promise<AgentRecipe[]> {
    const scope = requireObjectiveScope();
    const local = await this.store.$queryRaw<AgentRecipe[]>(
      Prisma.sql`SELECT * FROM ai_agent_recipes WHERE ${owner(scope)} AND status='approved' AND approved_at IS NOT NULL AND review IS NOT NULL ORDER BY id DESC LIMIT 100`,
    );
    const global = await this.system.$queryRaw<AgentRecipe[]>(
      Prisma.sql`SELECT * FROM ai_agent_recipes WHERE knowledge_scope='global' AND store_id IS NULL AND organization_id IS NULL AND user_id IS NULL AND status='approved' AND approved_at IS NOT NULL AND review IS NOT NULL ORDER BY id DESC LIMIT 100`,
    );
    return [...local, ...global];
  }
  async live(id: number, hash: string): Promise<AgentRecipe | null> {
    return (
      (await this.available()).find(
        (r) =>
          r.id === id &&
          r.content_hash === hash &&
          !!r.expires_at &&
          new Date(r.expires_at).getTime() > Date.now(),
      ) ?? null
    );
  }

  /** Lifecycle updates are not tools. Caller must validate a signed, hash-bound human attestation. */
  async transition(
    id: number,
    hash: string,
    from: RecipeStatus,
    to: RecipeStatus,
    review: RecipeReview,
  ): Promise<void> {
    const scope = requireObjectiveScope();
    const changed = await this.store
      .$executeRaw(Prisma.sql`UPDATE ai_agent_recipes SET status=${to},review=${json(review)},review_history=review_history || ${json([review])},
      approved_at=${to === 'approved' ? new Date() : null},expires_at=${new Date(review.expires_at)},updated_at=CURRENT_TIMESTAMP
      WHERE id=${id} AND content_hash=${hash} AND status=${from} AND ${owner(scope)} AND (${from} <> 'quarantined' OR last_failure_code='expired')`);
    if (changed !== 1) throw new ConflictException('Recipe changed');
  }
  async retire(
    id: number,
    hash: string,
    reason:
      | 'contract_changed'
      | 'verifier_failed'
      | 'security_anomaly'
      | 'expired'
      | 'deprecated',
  ): Promise<void> {
    const scope = requireObjectiveScope();
    // A failed verifier may retire a global ONLY after a server-owned result pin in this objective is checked by the caller.
    const visibility = Prisma.sql`((${owner(scope)}) OR (knowledge_scope='global' AND store_id IS NULL AND organization_id IS NULL AND user_id IS NULL))`;
    await this.system
      .$executeRaw(Prisma.sql`UPDATE ai_agent_recipes SET status=${reason === 'deprecated' ? 'deprecated' : 'quarantined'},
      invalidation_count=invalidation_count+1,last_failure_code=${reason},updated_at=CURRENT_TIMESTAMP
      WHERE id=${id} AND content_hash=${hash} AND ${visibility} AND status IN ('approved','reviewed')`);
  }
  async event(
    id: number,
    hash: string,
    objectiveId: string,
    kind: 'used' | 'success' | 'failure',
    code?: 'verifier_failed' | 'security_anomaly',
  ): Promise<void> {
    const scope = requireObjectiveScope();
    const eventKey = catalogHash([scope, objectiveId, id, hash, kind]);
    await this.system.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: number }>
      >(Prisma.sql`INSERT INTO ai_agent_recipe_events(recipe_id,store_id,organization_id,user_id,objective_id,event_key,kind,code)
        SELECT id,${scope.store_id},${scope.organization_id},${scope.user_id},${objectiveId}::uuid,${eventKey},${kind},${code ?? null}
        FROM ai_agent_recipes WHERE id=${id} AND content_hash=${hash} AND ((${owner(scope)}) OR
          (knowledge_scope='global' AND store_id IS NULL AND organization_id IS NULL AND user_id IS NULL))
        ON CONFLICT(event_key) DO NOTHING RETURNING id`);
      if (!rows.length) return;
      await tx.$executeRaw(Prisma.sql`UPDATE ai_agent_recipes SET
        usage_count=usage_count+${kind === 'used' ? 1 : 0},success_count=success_count+${kind === 'success' ? 1 : 0},failure_count=failure_count+${kind === 'failure' ? 1 : 0},
        updated_at=CURRENT_TIMESTAMP WHERE id=${id} AND content_hash=${hash}`);
    });
  }
  async loadedPins(
    objectiveId: string,
  ): Promise<Array<{ id: number; hash: string }>> {
    const scope = requireObjectiveScope();
    const rows = await this.store.$queryRaw<
      Array<{ data: { recipe_id?: number; hash?: string } }>
    >(Prisma.sql`SELECT data FROM ai_agent_tool_results
      WHERE objective_id=${objectiveId}::uuid AND store_id=${scope.store_id} AND organization_id=${scope.organization_id} AND user_id=${scope.user_id}
        AND tool_name='load_recipe' AND receipt->>'status'='ok' AND stale_lease=false AND freshness='observed' ORDER BY created_at DESC LIMIT 100`);
    return rows
      .flatMap((r) =>
        Number.isSafeInteger(r.data?.recipe_id) &&
        Number(r.data.recipe_id) > 0 &&
        /^[a-f0-9]{64}$/.test(r.data?.hash ?? '')
          ? [{ id: r.data.recipe_id!, hash: r.data.hash! }]
          : [],
      )
      .filter(
        (r, i, a) =>
          a.findIndex((x) => x.id === r.id && x.hash === r.hash) === i,
      );
  }
  async traceIds(objectiveId: string): Promise<string[]> {
    const s = requireObjectiveScope();
    const rows = await this.store.$queryRaw<
      Array<{ trace_id: string }>
    >(Prisma.sql`SELECT DISTINCT trace_id FROM ai_agent_trace_spans WHERE objective_id=${objectiveId}::uuid
      AND store_id=${s.store_id} AND organization_id=${s.organization_id} AND user_id=${s.user_id} AND scope_kind='tenant' LIMIT 50`);
    return rows.map((r) => r.trace_id);
  }
  async scriptRefs(objectiveId: string): Promise<string[]> {
    const s = requireObjectiveScope();
    const rows = await this.system.$queryRaw<
      Array<{ id: string }>
    >(Prisma.sql`SELECT id FROM ai_agent_script_runs WHERE objective_id=${objectiveId}::uuid
      AND store_id=${s.store_id} AND organization_id=${s.organization_id} AND user_id=${s.user_id} LIMIT 2`);
    return rows.map((r) => `sandbox-run:${r.id}`); // no source/decryption; scripts are NOT approved by F.
  }

  /** Maintenance console only, explicit platform principal; never tenant arguments or store0 ALS. */
  async systemGet(id: number): Promise<AgentRecipe> {
    this.requireSystem();
    const rows = await this.system.$queryRaw<AgentRecipe[]>(
      Prisma.sql`SELECT * FROM ai_agent_recipes WHERE id=${id}`,
    );
    if (!rows[0]) throw new NotFoundException('Recipe not found');
    return rows[0];
  }
  async globalCandidate(source: AgentRecipe): Promise<number> {
    this.requireSystem();
    if (
      source.knowledge_scope !== 'store' ||
      source.status !== 'approved' ||
      !source.review ||
      !source.expires_at ||
      new Date(source.expires_at).getTime() <= Date.now()
    )
      throw new ForbiddenException('Approved source required');
    const identity = catalogHash(['global', source.recipe_key, source.version]);
    const rows = await this.system.$queryRaw<
      Array<{ id: number }>
    >(Prisma.sql`INSERT INTO ai_agent_recipes(identity_key,knowledge_scope,recipe_key,version,template,content_hash)
      VALUES(${identity},'global',${source.recipe_key},${source.version},${json(source.template)},${source.content_hash})
      ON CONFLICT(identity_key) DO NOTHING RETURNING id`);
    if (!rows[0])
      throw new ConflictException('Global recipe version already exists');
    return rows[0].id;
  }
  async approvedGlobal(id: number): Promise<AgentRecipe | null> {
    const rows = await this.system.$queryRaw<
      AgentRecipe[]
    >(Prisma.sql`SELECT * FROM ai_agent_recipes WHERE id=${id} AND knowledge_scope='global'
      AND store_id IS NULL AND organization_id IS NULL AND user_id IS NULL AND ${published}`);
    return rows[0] ?? null;
  }
  async systemTransition(
    id: number,
    hash: string,
    from: RecipeStatus,
    to: RecipeStatus,
    review: RecipeReview,
  ): Promise<void> {
    this.requireSystem();
    if (
      RequestContextService.asyncLocalStorage.getStore()?.user_id !==
      review.reviewer_id
    )
      throw new ForbiddenException('Reviewer identity mismatch');
    const changed = await this.system
      .$executeRaw(Prisma.sql`UPDATE ai_agent_recipes SET status=${to},review=${json(review)},review_history=review_history || ${json([review])},
      approved_at=${to === 'approved' ? new Date() : null},expires_at=${new Date(review.expires_at)},updated_at=CURRENT_TIMESTAMP
      WHERE id=${id} AND content_hash=${hash} AND status=${from} AND knowledge_scope='global'
        AND store_id IS NULL AND organization_id IS NULL AND user_id IS NULL AND (${from} <> 'quarantined' OR last_failure_code='expired')`);
    if (changed !== 1) throw new ConflictException('Recipe changed');
  }
  private requireSystem(): void {
    const c = RequestContextService.asyncLocalStorage.getStore();
    if (
      c?.is_super_admin !== true ||
      !Number.isSafeInteger(c.user_id) ||
      Number(c.user_id) <= 0 ||
      c.store_id != null
    )
      throw new ForbiddenException('Explicit platform context required');
  }
}
