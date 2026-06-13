/**
 * Stage registry + orchestrator.
 */

import { makeRng } from '../lib/random';
import { stage01Foundation } from './01-foundation';
import { stage02Catalog } from './02-catalog';
import { stage03Inventory } from './03-inventory';
import { stage04Parties } from './04-parties';
import { stage05Purchasing } from './05-purchasing';
import { stage06Sales } from './06-sales';
import { stage07PosCash } from './07-pos-cash';
import { stage08Accounting } from './08-accounting';
import { stage09Payroll } from './09-payroll';
import { stage10Withholdings } from './10-withholdings';
import { stage11FiscalDian } from './11-fiscal-dian';
import { stage12Obligations } from './12-obligations';
import { stage13Exogenous } from './13-exogenous';
import { stage14Misc } from './14-misc';
import type { Stage, StageContext, StageResult } from './context';

export { type StageContext, type CliOptions, type StageData, type StageResult } from './context';

export const ALL_STAGES: Stage[] = [
  stage01Foundation,
  stage02Catalog,
  stage03Inventory,
  stage04Parties,
  stage05Purchasing,
  stage06Sales,
  stage07PosCash,
  stage08Accounting,
  stage09Payroll,
  stage10Withholdings,
  stage11FiscalDian,
  stage12Obligations,
  stage13Exogenous,
  stage14Misc,
];

export async function runStages(ctx: StageContext): Promise<StageResult[]> {
  ctx.rng = makeRng(ctx.options.seed);
  const results: StageResult[] = [];

  const only = ctx.options.only?.length
    ? new Set(ctx.options.only.map((s) => s.replace(/^0+/, '')))
    : null;
  const skip = new Set((ctx.options.skip ?? []).map((s) => s.replace(/^0+/, '')));

  for (const stage of ALL_STAGES) {
    const stageKey = stage.id.replace(/^0+/, '');
    if (only && !only.has(stageKey)) {
      results.push({ name: stage.name, ok: true, counts: {}, error: 'skipped (--only)' });
      ctx.log(`⏭️  [${stage.id}] ${stage.name} — skipped (--only)`);
      continue;
    }
    if (skip.has(stageKey)) {
      results.push({ name: stage.name, ok: true, counts: {}, error: 'skipped (--skip)' });
      ctx.log(`⏭️  [${stage.id}] ${stage.name} — skipped (--skip)`);
      continue;
    }
    ctx.log(`▶️  [${stage.id}] ${stage.name}`);
    ctx.log(`    ${stage.description}`);
    try {
      const counts = await stage.run(ctx);
      results.push({ name: stage.name, ok: true, counts });
      const stats = Object.entries(counts)
        .filter(([, v]) => typeof v === 'number' && v > 0)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      ctx.log(`✅ [${stage.id}] ${stage.name}${stats ? ` (${stats})` : ''}`);
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      const stack = error?.stack ? `\n${error.stack.split('\n').slice(0, 4).join('\n')}` : '';
      results.push({ name: stage.name, ok: false, error: msg, counts: {} });
      ctx.log(`❌ [${stage.id}] ${stage.name}: ${msg}${stack}`);
      // Don't abort: continue with remaining stages.
    }
    ctx.log('');
  }

  return results;
}
