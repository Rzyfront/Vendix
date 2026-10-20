import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { EvalMode, EvalReceipt } from '../test/agentic/contracts';
import {
  compareReports,
  EvalOptions,
  EvalReport,
  loadCorpus,
  replayAdapter,
  runEvaluation,
  TreatmentField,
  validateOptions,
} from '../test/agentic/runner';

const HELP = `Usage: npm run eval:agentic -- [--mode replay|shadow|live] [--split all|dev|holdout]
  [--agent all|vex|vexi (alias --surface)] [--channel all|text|pipeline|realtime]
  [--dataset test/agentic/requests.es.jsonl] [--max-concurrency 1]
  [--repeats 3] [--records /path/synthetic-receipts.jsonl] [--output /tmp/report.json]
  [--max-cost-usd 0 (alias --budget-usd)] [--max-case-cost-usd 0] [--compare /path/baseline.json]
  [--allow-treatment flags,catalog] (explicit comparison treatment; never model/prompt/config/cache)
Live golden conversations: --mode live --suite test/agentic/golden-conversations.es.jsonl
  --label <baseline|dynamic> --out <dir> --db-url-file <file> [--or-key-file <file>]
  [--base http://localhost:3100/api] [--cases g01,g05] [--min-credit-usd 0.4] [--psql psql]
  (local backend + cloned e2e DB only; spends real provider money; see live-http.adapter.ts).
Otherwise no application, provider or DB is imported.
Replay reads existing synthetic receipts only (no spending); absent records produce not_run.
Budgets authorize no execution by themselves. Never point recordings at real customer data.`;

export interface CliOptions extends EvalOptions {
  records?: string;
  output?: string;
  compare?: string;
  help: boolean;
  treatmentFields: TreatmentField[];
  dataset: string;
  maxConcurrency: 1;
}
export function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: 'replay',
    split: 'all',
    repeats: 3,
    maxCostUsd: 0,
    maxCaseCostUsd: 0,
    help: false,
    treatmentFields: [],
    dataset: resolve(__dirname, '../test/agentic/requests.es.jsonl'),
    maxConcurrency: 1,
  };
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const original = argv[i];
    const arg =
      original === '--surface'
        ? '--agent'
        : original === '--budget-usd'
          ? '--max-cost-usd'
          : original;
    if (arg === '--help') {
      options.help = true;
      continue;
    }
    if (
      ![
        '--mode',
        '--split',
        '--agent',
        '--channel',
        '--dataset',
        '--max-concurrency',
        '--repeats',
        '--max-cost-usd',
        '--max-case-cost-usd',
        '--records',
        '--output',
        '--compare',
        '--allow-treatment',
      ].includes(arg)
    ) {
      throw new Error(`Unknown option ${arg}`);
    }
    if (seen.has(arg)) throw new Error(`Duplicate option ${arg}`);
    seen.add(arg);
    const value = argv[++i];
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value ${arg}`);
    switch (arg) {
      case '--mode':
        options.mode = value as EvalMode;
        break;
      case '--split':
        options.split = value as CliOptions['split'];
        break;
      case '--agent':
        options.agent = value as CliOptions['agent'];
        break;
      case '--channel':
        options.channel = value as CliOptions['channel'];
        break;
      case '--dataset':
        options.dataset = resolve(value);
        break;
      case '--max-concurrency':
        if (value !== '1')
          throw new Error('Concurrency must be exactly 1 on this machine');
        break;
      case '--repeats':
        if (!/^[1-9]\d*$/.test(value))
          throw new Error('Repeats must be an integer');
        options.repeats = Number(value);
        break;
      case '--max-cost-usd':
      case '--max-case-cost-usd':
        if (!/^\d+(?:\.\d+)?$/.test(value))
          throw new Error('Budget must be a nonnegative decimal');
        if (arg === '--max-cost-usd') options.maxCostUsd = Number(value);
        else options.maxCaseCostUsd = Number(value);
        break;
      case '--records':
        options.records = resolve(value);
        break;
      case '--output':
        options.output = resolve(value);
        break;
      case '--compare':
        options.compare = resolve(value);
        break;
      case '--allow-treatment': {
        const treatments = value.split(',');
        if (
          treatments.some((field) => !['flags', 'catalog'].includes(field)) ||
          new Set(treatments).size !== treatments.length
        ) {
          throw new Error(
            'Treatment must be flags,catalog or one of those fields',
          );
        }
        options.treatmentFields = treatments.flatMap(
          (field): TreatmentField[] =>
            field === 'flags'
              ? ['featureFlagsHash']
              : ['catalogHash', 'catalogVersion'],
        );
        break;
      }
    }
  }
  validateOptions(options);
  if (options.mode !== 'replay' && options.records)
    throw new Error('--records is replay-only');
  if (
    options.output &&
    [options.records, options.compare, options.dataset].includes(options.output)
  )
    throw new Error('Output must not overwrite input');
  return options;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  // Live golden conversations (F6): real local backend + cloned DB, real spend.
  if (argv.includes('--suite')) {
    const mode = argv[argv.indexOf('--mode') + 1];
    if (mode !== 'live') throw new Error('--suite requires --mode live');
    const { runLiveFromArgv } =
      await import('../test/agentic/live-http.adapter');
    return runLiveFromArgv(argv);
  }
  const options = parseCli(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const corpus = loadCorpus(options.dataset);
  const receipts = options.records
    ? readFileSync(options.records, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as EvalReceipt)
    : [];
  const adapter =
    options.mode === 'replay' && options.records
      ? replayAdapter(receipts)
      : undefined;
  const report = await runEvaluation(corpus, options, adapter);
  const comparison = options.compare
    ? compareReports(
        JSON.parse(readFileSync(options.compare, 'utf8')) as EvalReport,
        report,
        options.treatmentFields,
      )
    : undefined;
  const serialized = `${JSON.stringify({ ...report, comparison }, null, 2)}\n`;
  if (options.output) writeFileSync(options.output, serialized, { flag: 'wx' });
  else process.stdout.write(serialized);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // Validation errors name fields, not full payloads/prompts/secrets.
    process.stderr.write(
      `agentic-eval: ${error instanceof Error ? error.message : 'invalid evaluation'}\n`,
    );
    process.exitCode = 1;
  });
}
