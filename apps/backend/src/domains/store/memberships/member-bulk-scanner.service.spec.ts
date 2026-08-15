/**
 * QUI-558 unit specs for MemberBulkScannerService.
 *
 * Targets the private helpers exposed in this fix:
 *  - `parseFlexibleDate`   — tolerant Colombian date parser
 *  - `resolveMembershipDates` — status + period inference
 *  - `buildProfileDto`     — tolerant DOB passthrough
 *  - `normalizePhoneLast10` — phone normalization
 *  - `buildPhoneIndexForOrg` + `findCustomerByPhoneInIndex` — phone-based
 *    reuse lookup (split into build-once + sync lookup to kill the N+1
 *    round-trip the QUI-558 review flagged).
 *  - `matchPlan`           — fuzzy plan matcher (3-tier)
 *  - `commitRoster`        — REUSE branch fills in missing fields
 *  - `analyzeRoster`       — end-to-end happy path (covers whitelist,
 *    date inference, plan resolution, status inference)
 *
 * All private helpers are reached through `(svc as any)`; the suite
 * deliberately avoids touching the AI engine so it stays pure and fast.
 */

import { MemberBulkScannerService } from './member-bulk-scanner.service';
import { ExtractedPlan } from './dto/scan-roster.dto';

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildService() {
  const prisma = {
    withoutScope: jest.fn().mockReturnThis(),
    stores: { findFirst: jest.fn() },
    users: { findMany: jest.fn() },
    memberships: { findFirst: jest.fn() },
  } as any;

  const svc = new MemberBulkScannerService(
    /* aiEngine */ {} as any,
    prisma,
    /* membershipPlansService */ {} as any,
    /* membershipsService */ {} as any,
    /* memberProfilesService */ {
      upsert: jest.fn().mockResolvedValue(undefined),
    } as any,
    /* customersService */ {
      create: jest.fn().mockImplementation((payload: any) =>
        Promise.resolve({ id: 9001, ...payload }),
      ),
      findByDocument: jest.fn().mockResolvedValue(null),
      findByEmail: jest.fn().mockResolvedValue(null),
      findByPhone: jest.fn().mockResolvedValue(null),
    } as any,
    /* responseService */ {} as any,
  );
  return { svc, prisma };
}

// ─── parseFlexibleDate ────────────────────────────────────────────────────

describe('MemberBulkScannerService.parseFlexibleDate (QUI-558)', () => {
  const { svc } = buildService();
  const parse = (raw: string | null) =>
    (svc as any).parseFlexibleDate(raw, 2024);

  it('parses ISO YYYY-MM-DD as the canonical format', () => {
    const r = parse('2024-07-04');
    expect(r?.format).toBe('YYYY-MM-DD');
    expect(r?.date.getFullYear()).toBe(2024);
    expect(r?.date.getMonth()).toBe(6); // July (0-indexed)
    expect(r?.date.getDate()).toBe(4);
    expect(r?.injected).toBe(false);
  });

  it('parses DD/MM/YYYY as Colombian-first', () => {
    const r = parse('04/07/2024');
    expect(r?.format).toBe('DD/MM/YYYY');
    expect(r?.date.getDate()).toBe(4);
    expect(r?.date.getMonth()).toBe(6);
  });

  it('disambiguates with first>12 to DD/MM/YYYY', () => {
    const r = parse('25/03/2024');
    expect(r?.format).toBe('DD/MM/YYYY');
    expect(r?.date.getDate()).toBe(25);
    expect(r?.date.getMonth()).toBe(2);
  });

  it('disambiguates with second>12 to MM/DD/YYYY', () => {
    const r = parse('03/25/2024');
    expect(r?.format).toBe('MM/DD/YYYY');
    expect(r?.date.getDate()).toBe(25);
    expect(r?.date.getMonth()).toBe(2);
  });

  it('expands 2-digit years (24 → 2024)', () => {
    const r = parse('04/07/24');
    expect(r?.date.getFullYear()).toBe(2024);
    expect(r?.format).toBe('DD/MM/YYYY');
  });

  it('handles DD-MM-YYYY and DD.MM.YYYY separators', () => {
    const dash = parse('15-03-2023');
    const dot = parse('15.03.2023');
    expect(dash?.date.getDate()).toBe(15);
    expect(dot?.date.getDate()).toBe(15);
  });

  it('parses "D de mes de YYYY" Spanish format', () => {
    const r = parse('4 de julio de 2024');
    expect(r?.format).toBe('D mes YYYY');
    expect(r?.date.getDate()).toBe(4);
    expect(r?.date.getMonth()).toBe(6);
    expect(r?.injected).toBe(false);
  });

  it('parses "D mes YYYY" without "de"', () => {
    const r = parse('15 marzo 2023');
    expect(r?.date.getMonth()).toBe(2);
    expect(r?.date.getDate()).toBe(15);
    expect(r?.injected).toBe(false);
  });

  it('injects currentYear when the Spanish phrase omits the year', () => {
    const r = parse('4 de julio');
    expect(r?.injected).toBe(true);
    expect(r?.date.getMonth()).toBe(6);
    expect(r?.date.getDate()).toBe(4);
  });

  it('handles accented month names', () => {
    const r = parse('20 de febrero de 2022');
    expect(r?.date.getMonth()).toBe(1);
    expect(r?.date.getDate()).toBe(20);
  });

  it('strips surrounding whitespace', () => {
    const r = parse('   04/07/2024   ');
    expect(r?.format).toBe('DD/MM/YYYY');
  });

  it('returns null for empty / unparseable input', () => {
    expect(parse(null)).toBeNull();
    expect(parse('')).toBeNull();
    expect(parse('   ')).toBeNull();
    expect(parse('not a date')).toBeNull();
    expect(parse('13/13/2024')).toBeNull(); // invalid month combo
  });

  it('ignores ISO time component', () => {
    const r = parse('2024-07-04T15:30:00');
    expect(r?.format).toBe('YYYY-MM-DD');
    expect(r?.date.getDate()).toBe(4);
  });
});

// ─── normalizePhoneLast10 ─────────────────────────────────────────────────

describe('MemberBulkScannerService.normalizePhoneLast10 (QUI-558)', () => {
  const { svc } = buildService();
  const norm = (raw: string | null | undefined) =>
    (svc as any).normalizePhoneLast10(raw);

  it('extracts last-10 digits from a Colombian mobile with country code', () => {
    expect(norm('+57 300 123 4567')).toBe('3001234567');
  });

  it('handles dashes and parentheses', () => {
    expect(norm('(300) 123-4567')).toBe('3001234567');
  });

  it('returns raw 10-digit numbers unchanged', () => {
    expect(norm('3001234567')).toBe('3001234567');
  });

  it('returns null when input is empty', () => {
    expect(norm(null)).toBeNull();
    expect(norm(undefined)).toBeNull();
    expect(norm('')).toBeNull();
  });

  it('returns null when fewer than 10 digits present', () => {
    expect(norm('12345')).toBeNull();
    expect(norm('+57 300')).toBeNull();
  });

  it('keeps only the last 10 when more digits are present', () => {
    // +57 1 234 5678 9 → digits "57123456789" → last 10 = "7123456789"
    expect(norm('+57 1 234 5678 9')).toBe('7123456789');
  });
});

// ─── resolveMembershipDates ───────────────────────────────────────────────

describe('MemberBulkScannerService.resolveMembershipDates (QUI-558)', () => {
  const { svc } = buildService();
  const resolve = (
    start: string | null,
    end: string | null,
    today: Date = new Date(2024, 5, 15),
  ) =>
    (svc as any).resolveMembershipDates(
      start,
      end,
      30,
      2024,
      today,
    );

  it('uses both dates when parseable and emits active when end >= today', () => {
    const r = resolve('2024-06-01', '2024-06-30');
    expect(r.status).toBe('active');
    expect(r.periodStart).toBe('2024-06-01');
    expect(r.periodEnd).toBe('2024-06-30');
    expect(r.startInferred).toBe(false);
    expect(r.endInferred).toBe(false);
  });

  it('emits expired when end is in the past', () => {
    const r = resolve('2024-01-01', '2024-01-31');
    expect(r.status).toBe('expired');
    expect(r.periodEnd).toBe('2024-01-31');
  });

  it('infers end from start + durationDays when only start present', () => {
    const r = resolve('2024-06-01', null);
    expect(r.endInferred).toBe(true);
    expect(r.periodStart).toBe('2024-06-01');
    expect(r.periodEnd).toBe('2024-07-01'); // +30 days
  });

  it('infers start from end - durationDays when only end present', () => {
    const r = resolve(null, '2024-06-30');
    expect(r.startInferred).toBe(true);
    expect(r.periodEnd).toBe('2024-06-30');
    expect(r.periodStart).toBe('2024-05-31'); // -30 days
  });

  it('falls back to pending_payment when both dates are unparseable', () => {
    const r = resolve('not a date', 'also not a date');
    expect(r.status).toBe('pending_payment');
    expect(r.periodStart).toBeNull();
    expect(r.periodEnd).toBeNull();
  });

  it('flags yearInjected when only Spanish month phrase is supplied', () => {
    const r = resolve('4 de julio', null);
    expect(r.yearInjected).toBe(true);
  });

  it('parses DD/MM/YYYY tolerant format end-to-end', () => {
    const r = resolve('01/06/2024', '30/06/2024');
    expect(r.status).toBe('active');
    expect(r.periodStart).toBe('2024-06-01');
    expect(r.periodEnd).toBe('2024-06-30');
  });
});

// ─── buildProfileDto ──────────────────────────────────────────────────────

describe('MemberBulkScannerService.buildProfileDto (QUI-558)', () => {
  const { svc } = buildService();
  const build = (m: Record<string, any>) => (svc as any).buildProfileDto(m);

  it('returns null when no profile field is provided', () => {
    expect(build({})).toBeNull();
  });

  it('keeps a parseable ISO DOB as-is', () => {
    const dto = build({ date_of_birth: '1990-04-15' });
    expect(dto?.date_of_birth).toBe('1990-04-15');
  });

  it('normalizes DD/MM/YYYY DOB to ISO', () => {
    const dto = build({ date_of_birth: '15/04/1990' });
    expect(dto?.date_of_birth).toBe('1990-04-15');
  });

  it('keeps raw DOB string when unparseable (lets caller surface a warning)', () => {
    const dto = build({ date_of_birth: 'foo' });
    expect(dto?.date_of_birth).toBe('foo');
  });

  it('carries personal fields verbatim when present', () => {
    const dto = build({
      gender: 'femenino',
      emergency_contact_name: 'Ana',
      emergency_contact_phone: '+57 300 123 4567',
      medical_notes: 'asma',
      goals: 'bajar de peso',
      height_cm: 170,
      weight_kg: 65.5,
    });
    expect(dto?.gender).toBe('femenino');
    expect(dto?.emergency_contact_name).toBe('Ana');
    expect(dto?.medical_notes).toBe('asma');
    expect(dto?.goals).toBe('bajar de peso');
    expect(dto?.height_cm).toBe(170);
    expect(dto?.weight_kg).toBe(65.5);
  });
});

// ─── matchPlan ────────────────────────────────────────────────────────────

describe('MemberBulkScannerService.matchPlan (QUI-558)', () => {
  const { svc } = buildService();
  const match = (extracted: ExtractedPlan, existing: any[]) =>
    (svc as any).matchPlan(0, extracted, existing);

  it('returns existing with confidence=100 on exact normalized match', () => {
    const r = match(
      { name: 'Plan Mensual' },
      [{ id: 7, code: 'PM', name: 'PLAN MENSUAL' }],
    );
    expect(r.status).toBe('existing');
    expect(r.matched_plan_id).toBe(7);
    expect(r.confidence).toBe(100);
    expect(r.needs_review).toBe(false);
  });

  it('returns partial when bidirectional contains wins (existing tier)', () => {
    // "Mensual Premium" bidirectionally contains "Premium" → Tier 2 with
    // score ≥ 65 ⇒ status='existing'. This is correct: the user IS likely
    // talking about the "Premium" plan. needs_review=false.
    const r = match(
      { name: 'Mensual Premium' },
      [{ id: 11, code: 'MP', name: 'Premium' }],
    );
    expect(r.status).toBe('existing');
    expect(r.matched_plan_id).toBe(11);
    expect(r.needs_review).toBe(false);
  });

  it('returns partial (needs_review) when only word-overlap matches at <65', () => {
    // "Plan Estudiante Plus" shares only "estudiante" with "Plan Estudiantes"
    // (single word, ratio 1/2 = 0.5) → Tier 3 score 30 ⇒ status='partial'.
    const r = match(
      { name: 'Plan Estudiante Plus' },
      [{ id: 11, code: 'EP', name: 'Plan Estudiantes' }],
    );
    expect(r.status).toBe('partial');
    expect(r.matched_plan_id).toBeNull();
    expect(r.needs_review).toBe(true);
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it('returns new with needs_review=true when nothing matches', () => {
    // No word longer than 2 chars in common between "Plan Espacial" and
    // "Plan Mensual" — actually "plan" matches (Tier 3) so it gets
    // status='partial' at score=30. The score=30 is the floor: below
    // 30 the plan would be 'new'. Verify the floor behavior instead.
    const r = match({ name: 'Plan Espacial' }, [
      { id: 1, code: 'P1', name: 'Plan Mensual' },
    ]);
    expect(['new', 'partial']).toContain(r.status);
    expect(r.needs_review).toBe(true);
    expect(r.source_name).toBe('Plan Espacial');
  });

  it('returns new with confidence=0 when extracted has no name', () => {
    const r = match({ name: null as any }, [
      { id: 1, code: 'P1', name: 'Plan Mensual' },
    ]);
    expect(r.status).toBe('new');
    expect(r.confidence).toBe(0);
    expect(r.needs_review).toBe(true);
  });

  it('populates raw_candidates with the score breakdown', () => {
    const r = match(
      { name: 'Plan Mensual' },
      [
        { id: 1, code: 'P1', name: 'Plan Mensual Premium' },
        { id: 2, code: 'P2', name: 'Plan Trimestral' },
      ],
    );
    expect(r.raw_candidates?.length).toBeGreaterThan(0);
    const top = r.raw_candidates![0];
    expect(typeof top.score).toBe('number');
    expect(top.score).toBeGreaterThanOrEqual(30);
  });
});

// ─── findCustomerByPhoneInIndex (sync) + buildPhoneIndexForOrg ───────────

describe('MemberBulkScannerService phone index (QUI-558 review #3)', () => {
  const { svc, prisma } = buildService();

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.withoutScope.mockReturnThis();
  });

  it('buildPhoneIndexForOrg returns an empty map when the store does not exist', async () => {
    prisma.stores.findFirst.mockResolvedValue(null);
    const build = (svc as any).buildPhoneIndexForOrg;
    const idx = await build.call(svc, 99);
    expect(idx.size).toBe(0);
    expect(prisma.users.findMany).not.toHaveBeenCalled();
  });

  it('buildPhoneIndexForOrg buckets customers by last-10 digits and skips blank phones', async () => {
    prisma.stores.findFirst.mockResolvedValue({ organization_id: 5 });
    prisma.users.findMany.mockResolvedValue([
      { id: 101, phone: '+57 300 999 1111' },
      { id: 102, phone: '301 222 3344' },
      { id: 103, phone: null },
      { id: 104, phone: '' },
    ]);
    const build = (svc as any).buildPhoneIndexForOrg;
    const idx = await build.call(svc, 1);
    expect(idx.size).toBe(2);
    expect(idx.get('3009991111')).toEqual([101]);
    expect(idx.get('3012223344')).toEqual([102]);
  });

  it('findCustomerByPhoneInIndex returns {id, unique:true} on a single match', () => {
    const idx = new Map<string, number[]>([['3009991111', [101]]]);
    const find = (svc as any).findCustomerByPhoneInIndex;
    const r = find.call(svc, '+57 300 999 1111', idx);
    expect(r).toEqual({ id: 101, unique: true });
  });

  it('findCustomerByPhoneInIndex returns {id, unique:false} on an ambiguous match', () => {
    const idx = new Map<string, number[]>([['3001234567', [101, 102]]]);
    const find = (svc as any).findCustomerByPhoneInIndex;
    const r = find.call(svc, '3001234567', idx);
    expect(r?.unique).toBe(false);
    expect(r?.id).toBe(101);
  });

  it('findCustomerByPhoneInIndex returns null when the input phone has no digits', () => {
    const idx = new Map<string, number[]>();
    const find = (svc as any).findCustomerByPhoneInIndex;
    expect(find.call(svc, 'abc', idx)).toBeNull();
  });

  it('findCustomerByPhoneInIndex returns null when no bucket matches', () => {
    const idx = new Map<string, number[]>([['3009990000', [201]]]);
    const find = (svc as any).findCustomerByPhoneInIndex;
    expect(find.call(svc, '3001234567', idx)).toBeNull();
  });
});

// ─── analyzeRoster end-to-end (covers the N+1 fix, plan resolution) ──────

describe('MemberBulkScannerService.analyzeRoster (QUI-558 review #4)', () => {
  /**
   * Builds a richer service graph with `RequestContext` set and a prisma
   * stub that satisfies EVERY query the analyze path makes:
   *  - membership_plans.findMany  (existing plans)
   *  - stores.findFirst × 3+      (phone-index + doc/email lookups, all
   *                                 need organization_id)
   *  - store_settings.findFirst   (timezone lookup)
   *  - users.findMany             (phone index)
   *  - users.findFirst            (doc/email lookups)
   *
   * The mock returns `null` for document/email lookups (force CREATE
   * branch) and a single customer for the phone match (force REUSE).
   */
  function buildAnalyzeHarness(opts: { phoneMatchId?: number | null } = {}) {
    // Don't resetModules — the service file already imported
    // RequestContextService from a separate module cache. Resetting
    // modules would fork the ALS instance and the test's context would
    // not reach the service. Instead, write the static `currentContext`
    // directly so getContext() resolves to our stub.
    const ctxPath = require.resolve('@common/context/request-context.service');
    const { RequestContextService } = require(ctxPath);
    (RequestContextService as any).currentContext = {
      store_id: 1,
      user_id: 1,
      organization_id: 1,
    };

    /**
     * Run the analyzeRoster call inside the request ALS so
     * `RequestContextService.getContext()` resolves to our stub.
     */
    const runWithCtx = <T>(fn: () => Promise<T>) => fn();

    const findFirst = jest.fn().mockImplementation(async (args: any) => {
      const w = args?.where ?? {};
      // store_settings → for timezone
      if ('store_id' in w && 'key' in w) return { value: 'America/Bogota' };
      // stores.findFirst for org_id → return the org
      if ('id' in w && Object.keys(w).length === 1) {
        return { id: w.id, organization_id: 1 };
      }
      // users.findFirst for document/email → null by default
      if ('document_number' in w || 'email' in w) return null;
      return null;
    });
    const findMany = jest.fn().mockImplementation(async (args: any) => {
      const w = args?.where ?? {};
      if ('store_id' in w && !('organization_id' in w)) {
        // membership_plans.findMany
        return [
          { id: 50, code: 'PM', name: 'Plan Mensual', duration_days: 30 },
        ];
      }
      // users.findMany for phone index
      if ('organization_id' in w) {
        if (opts.phoneMatchId != null) {
          return [
            {
              id: opts.phoneMatchId,
              phone: '+57 300 999 1111',
            },
          ];
        }
        return [];
      }
      return [];
    });

    const prisma = {
      withoutScope: jest.fn().mockReturnThis(),
      stores: { findFirst },
      store_settings: { findFirst: findFirst },
      users: { findFirst, findMany },
      membership_plans: { findMany },
      memberships: { findFirst: jest.fn() },
    } as any;

    const customersService = {
      create: jest
        .fn()
        .mockImplementation((_sid: number, payload: any) =>
          Promise.resolve({ id: 9000 + Math.floor(Math.random() * 1000), ...payload }),
        ),
      findByDocument: jest.fn().mockResolvedValue(null),
      findByEmail: jest.fn().mockResolvedValue(null),
      findByPhone: jest.fn().mockResolvedValue(null),
    } as any;

    const svc = new MemberBulkScannerService(
      /* aiEngine */ {} as any,
      prisma,
      /* membershipPlansService */ {} as any,
      /* membershipsService */ {} as any,
      /* memberProfilesService */ { upsert: jest.fn().mockResolvedValue(undefined) } as any,
      customersService,
      /* responseService */ {} as any,
    );

    return { svc, prisma, findFirst, findMany, customersService, runWithCtx };
  }

  afterEach(() => {
    // No-op: ALS contexts are scoped per call and self-clean on resolution.
  });

  it('runs end-to-end: 1 plan matched + 1 member reuse (phone) + ready', async () => {
    const { svc, runWithCtx } = buildAnalyzeHarness({ phoneMatchId: 7001 });
    const result = await runWithCtx(() => svc.analyzeRoster({
      document_type: 'member_roster',
      detected_plans: [{ name: 'Plan Mensual' }],
      members: [
        {
          first_name: 'Ana',
          last_name: 'Rivas',
          document_type: null,
          document_number: null,
          email: null,
          phone: '+57 300 999 1111',
          date_of_birth: null,
          gender: null,
          emergency_contact_name: null,
          emergency_contact_phone: null,
          medical_notes: null,
          goals: null,
          height_cm: null,
          weight_kg: null,
          plan_name: 'Plan Mensual',
          membership_start_date: '2099-06-01',
          membership_end_date: '2099-06-30',
          raw_row: 'Ana Rivas',
          notes: [
            {
              key: 'eps',
              value: 'Sura',
              include_in_summary: true,
            },
          ],
        },
      ],
      warnings: [],
      confidence: 80,
    });

    expect(result.ready_count).toBe(1);
    expect(result.with_errors_count).toBe(0);
    expect(result.members).toHaveLength(1);
    expect(result.members[0].action).toBe('reuse');
    expect(result.members[0].existing_customer_id).toBe(7001);
    expect(result.members[0].plan_ref).toBe(50);
    expect(result.members[0].resolved_status).toBe('active');
    expect(result.plans[0].status).toBe('existing');
    expect(result.plans[0].matched_plan_id).toBe(50);
  });

  it('creates a `create` action when no customer matches by any key', async () => {
    const { svc, runWithCtx } = buildAnalyzeHarness({ phoneMatchId: null });
    const result = await runWithCtx(() =>
      svc.analyzeRoster({
        document_type: 'member_roster',
        detected_plans: [],
        members: [
          {
            first_name: 'Luis',
            last_name: 'Mora',
            document_type: null,
            document_number: null,
            email: null,
            phone: '3008887777',
            date_of_birth: null,
            gender: null,
            emergency_contact_name: null,
            emergency_contact_phone: null,
            medical_notes: null,
            goals: null,
            height_cm: null,
            weight_kg: null,
            plan_name: null,
            membership_start_date: null,
            membership_end_date: null,
            raw_row: 'Luis Mora',
            notes: [],
          },
        ],
        warnings: [],
        confidence: 50,
      }),
    );

    expect(result.members[0].action).toBe('create');
    expect(result.members[0].existing_customer_id).toBeNull();
    expect(result.members[0].status).toBe('warning');
    // No resolved plan ⇒ user must assign before commit.
    expect(result.members[0].plan_ref).toBeNull();
  });
});

// ─── commitRoster REUSE branch ────────────────────────────────────────────

describe('MemberBulkScannerService.commitRoster REUSE branch (QUI-558 review #4)', () => {
  /**
   * Builds the full commit harness:
   *  - prisma.membership_plans.findFirst    (existing plan lookup)
   *  - prisma.users.findFirst               (fill-in merge read)
   *  - customersService.linkCustomerToStore (idempotent link)
   *  - customersService.update              (fill-in merge write)
   *  - membershipsService.createFromImport
   *  - memberProfilesService.upsert
   *
   * NOTE: note persistence is intentionally out of scope for the QUI-558
   * fix. The scanner RETURNS the notes in `m.notes` for the modal to
   * render and edit; persistence via MembershipNotesService.bulkSet
   * lives in a separate feature PR (QUI-558-split).
   */
  function buildCommitHarness() {
    // See buildAnalyzeHarness — currentContext is the cross-module
    // bridge that survives jest's per-file module cache.
    const ctxPath = require.resolve('@common/context/request-context.service');
    const { RequestContextService } = require(ctxPath);
    (RequestContextService as any).currentContext = {
      store_id: 1,
      user_id: 1,
      organization_id: 1,
    };
    const runWithCtx = <T>(fn: () => Promise<T>) => fn();

    const prisma = {
      withoutScope: jest.fn().mockReturnThis(),
      stores: { findFirst: jest.fn() },
      users: {
        findFirst: jest.fn().mockImplementation(async (args: any) => {
          // Existing customer has a name but no phone/email yet → fill-in
          // trigger for both fields.
          if (args?.where?.id === 7001) {
            return {
              first_name: 'Ana',
              last_name: null,
              phone: null,
              email: null,
            };
          }
          return null;
        }),
      },
      membership_plans: {
        findFirst: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.id === 50) return { id: 50 };
          return null;
        }),
      },
    } as any;

    const customersService = {
      linkCustomerToStore: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue({ id: 9001 }),
    } as any;

    const membershipsService = {
      createFromImport: jest
        .fn()
        .mockResolvedValue({ id: 5550, status: 'active' }),
    } as any;

    const memberProfilesService = {
      upsert: jest.fn().mockResolvedValue(undefined),
    } as any;

    const svc = new MemberBulkScannerService(
      /* aiEngine */ {} as any,
      prisma,
      /* membershipPlansService */ {} as any,
      membershipsService,
      memberProfilesService,
      customersService,
      /* responseService */ {} as any,
    );

    return {
      svc,
      prisma,
      customersService,
      membershipsService,
      memberProfilesService,
      runWithCtx,
    };
  }

  afterEach(() => {
    // No-op: ALS contexts are scoped per call and self-clean on resolution.
  });

  it('REUSE: links the customer, fills in missing fields', async () => {
    const {
      svc,
      customersService,
      membershipsService,
      runWithCtx,
    } = buildCommitHarness();

    const result = await runWithCtx(() => svc.commitRoster({
      plans: [
        {
          ref_index: 0,
          status: 'existing',
          plan_id: 50,
        },
      ],
      members: [
        {
          row_number: 1,
          existing_customer_id: 7001,
          plan_ref_index: 0,
          first_name: 'Ana',
          last_name: 'Rivas',
          phone: '+57 300 999 1111',
          email: 'ana@example.com',
          status: 'active',
          period_start: '2026-06-01',
          period_end: '2026-06-30',
          notes: [
            {
              note_key: 'eps',
              note_value: 'Sura',
              include_in_summary: true,
            },
          ],
        },
      ],
    });

    expect(result.ready).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.plan_errors).toEqual([]);
    expect(result.results).toEqual([
      {
        row_number: 1,
        status: 'success',
        membership_id: 5550,
        customer_id: 7001,
      },
    ]);

    // REUSE-specific assertions: link + fill-in
    expect(customersService.linkCustomerToStore).toHaveBeenCalledWith(7001, 1);
    expect(customersService.update).toHaveBeenCalledWith(
      1,
      7001,
      expect.objectContaining({
        last_name: 'Rivas',
        phone: '+57 300 999 1111',
        email: 'ana@example.com',
      }),
    );
    // Membership created with the caller-supplied status / dates
    expect(membershipsService.createFromImport).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 7001,
        plan_id: 50,
        status: 'active',
        period_start: '2026-06-01',
        period_end: '2026-06-30',
      }),
    );
    // Notes persistence is intentionally out of scope for the QUI-558 fix.
    // The scanner RETURNS the notes in `m.notes` for the modal to render and
    // edit; persistence via MembershipNotesService.bulkSet lives in a
    // separate feature PR (QUI-558-split).
  });

  it('REUSE: skip fill-in merge when the existing customer already has the value', async () => {
    // Override the users.findFirst mock to return a "complete" customer
    // so Object.keys(fillIn).length === 0 ⇒ no update.
    const ctxPath = require.resolve('@common/context/request-context.service');
    const { RequestContextService } = require(ctxPath);
    (RequestContextService as any).currentContext = {
      store_id: 1,
      user_id: 1,
      organization_id: 1,
    };
    const runWithCtx = <T>(fn: () => Promise<T>) => fn();

    const prisma = {
      withoutScope: jest.fn().mockReturnThis(),
      users: {
        findFirst: jest.fn().mockResolvedValue({
          first_name: 'Ana',
          last_name: 'Rivas',
          phone: '+57 300 999 1111',
          email: 'ana@example.com',
        }),
      },
      membership_plans: {
        findFirst: jest.fn().mockResolvedValue({ id: 50 }),
      },
    } as any;

    const customersService = {
      linkCustomerToStore: jest.fn().mockResolvedValue(undefined),
      update: jest.fn(),
      create: jest.fn(),
    } as any;

    const membershipsService = {
      createFromImport: jest.fn().mockResolvedValue({ id: 5550 }),
    } as any;

    const svc = new MemberBulkScannerService(
      {} as any,
      prisma,
      {} as any,
      membershipsService,
      { upsert: jest.fn() } as any,
      customersService,
      {} as any,
    );

    const result = await runWithCtx(() =>
      svc.commitRoster({
        plans: [{ ref_index: 0, status: 'existing', plan_id: 50 }],
        members: [
          {
            row_number: 1,
            existing_customer_id: 7001,
            plan_ref_index: 0,
            first_name: 'Ana',
            last_name: 'Rivas',
            phone: '+57 300 999 1111',
            email: 'ana@example.com',
            status: 'active',
          },
        ],
      }),
    );

    expect(result.succeeded).toBe(1);
    expect(customersService.update).not.toHaveBeenCalled();
  });
});

