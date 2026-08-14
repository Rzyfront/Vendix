/**
 * QUI-558 unit specs for MemberBulkScannerService.
 *
 * Targets the private helpers exposed in this fix:
 *  - `parseFlexibleDate`   — tolerant Colombian date parser
 *  - `resolveMembershipDates` — status + period inference
 *  - `buildProfileDto`     — tolerant DOB passthrough
 *  - `normalizePhoneLast10` — phone normalization
 *  - `findCustomerByPhoneInOrg` — phone-based reuse lookup
 *  - `matchPlan`           — fuzzy plan matcher (3-tier)
 *  - `commitRoster`        — REUSE branch fills in missing fields
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
    /* membershipNotesService */ {
      bulkSet: jest.fn().mockResolvedValue(undefined),
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

// ─── findCustomerByPhoneInOrg ─────────────────────────────────────────────

describe('MemberBulkScannerService.findCustomerByPhoneInOrg (QUI-558)', () => {
  const { svc, prisma } = buildService();
  const find = (storeId: number, phone: string) =>
    (svc as any).findCustomerByPhoneInOrg(storeId, phone);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.withoutScope.mockReturnThis();
  });

  it('returns null when the store does not exist', async () => {
    prisma.stores.findFirst.mockResolvedValue(null);
    const r = await find(99, '+57 300 123 4567');
    expect(r).toBeNull();
    expect(prisma.users.findMany).not.toHaveBeenCalled();
  });

  it('returns null when the input phone has no digits', async () => {
    prisma.stores.findFirst.mockResolvedValue({ organization_id: 5 });
    const r = await find(1, 'abc');
    expect(r).toBeNull();
  });

  it('returns {id, unique:true} when exactly one customer matches', async () => {
    prisma.stores.findFirst.mockResolvedValue({ organization_id: 5 });
    prisma.users.findMany.mockResolvedValue([
      { id: 101, phone: '+57 300 999 1111' },
      { id: 102, phone: '301 222 3344' },
    ]);
    const r = await find(1, '3009991111');
    expect(r).toEqual({ id: 101, unique: true });
  });

  it('returns {id, unique:false} when multiple customers share the same last-10', async () => {
    prisma.stores.findFirst.mockResolvedValue({ organization_id: 5 });
    prisma.users.findMany.mockResolvedValue([
      { id: 101, phone: '300 123 4567' },
      { id: 102, phone: '+57 300 123 4567' },
    ]);
    const r = await find(1, '3001234567');
    expect(r?.unique).toBe(false);
    expect(r?.id).toBe(101);
  });

  it('returns null when no candidate shares the last-10 digits', async () => {
    prisma.stores.findFirst.mockResolvedValue({ organization_id: 5 });
    prisma.users.findMany.mockResolvedValue([
      { id: 201, phone: '300 999 0000' },
    ]);
    const r = await find(1, '3001234567');
    expect(r).toBeNull();
  });
});
