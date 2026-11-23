/**
 * Offline measurement of the T5 `suggest_followup` labeled set.
 *
 *   npx ts-node src/ai-engine/evals/followups/measure-followups.ts \
 *     --predictions <file.json> [--dataset <file.json>]
 *
 * Exit code 0 when acierto >= 85 % and no-false-positives >= 80 %, 1 otherwise
 * (also 1 on invalid input). No model, DB or network is used.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  FollowupEvalInputError,
  FollowupPrediction,
  LabeledTurn,
  computeFollowupMetrics,
} from './followup-metrics';

const HELP = `Uso: ts-node measure-followups.ts --predictions <file.json> [--dataset <file.json>]
Cada predicción: {"id":"f01","called":true,"kind":"reminder","has_date":true}.`;

interface Cli {
  predictions?: string;
  dataset: string;
  help: boolean;
}

function parseCli(argv: string[]): Cli {
  const cli: Cli = {
    dataset: resolve(__dirname, 'followup-labeled-turns.json'),
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') cli.help = true;
    else if (arg === '--predictions' || arg === '--dataset') {
      const value = argv[++i];
      if (!value) throw new FollowupEvalInputError(`${arg} requiere un valor.`);
      if (arg === '--predictions') cli.predictions = resolve(value);
      else cli.dataset = resolve(value);
    } else {
      throw new FollowupEvalInputError(`Opción desconocida: ${arg}`);
    }
  }
  return cli;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new FollowupEvalInputError(
      `No se pudo leer ${path}: ${(error as Error).message}`,
    );
  }
}

function loadTurns(path: string): LabeledTurn[] {
  const raw = readJson(path) as { turns?: LabeledTurn[] };
  if (!raw || !Array.isArray(raw.turns)) {
    throw new FollowupEvalInputError(`${path} no tiene la lista "turns".`);
  }
  return raw.turns;
}

function loadPredictions(path: string): FollowupPrediction[] {
  const raw = readJson(path) as
    | FollowupPrediction[]
    | { predictions?: FollowupPrediction[] };
  const list = Array.isArray(raw) ? raw : raw?.predictions;
  if (!Array.isArray(list)) {
    throw new FollowupEvalInputError(
      `${path} debe ser un arreglo o {"predictions": [...]}.`,
    );
  }
  return list;
}

const pct = (value: number): string => `${(value * 100).toFixed(1)} %`;

function main(): number {
  const cli = parseCli(process.argv.slice(2));
  if (cli.help || !cli.predictions) {
    console.log(HELP);
    return cli.help ? 0 : 1;
  }
  const metrics = computeFollowupMetrics(
    loadTurns(cli.dataset),
    loadPredictions(cli.predictions),
  );
  const c = metrics.confusion;
  console.log(`Turnos: ${metrics.positives} positivos, ${metrics.negatives} negativos`);
  console.log(`Confusión: TP=${c.tp} (kind errado=${c.wrongKind}) FN=${c.fn} FP=${c.fp} TN=${c.tn}`);
  console.log(`Acierto (positivos con kind correcto): ${pct(metrics.acierto)}  (mínimo 85 %)`);
  console.log(`No-falsos-positivos (negativos sin ficha): ${pct(metrics.noFalsePositive)}  (mínimo 80 %)`);
  console.log(`Precisión: ${pct(metrics.precision)}  Recall: ${pct(metrics.recall)}`);
  if (metrics.dateMismatches.length > 0) {
    console.log(`Informativo, fecha distinta a la esperada: ${metrics.dateMismatches.join(', ')}`);
  }
  if (metrics.misses.length > 0) {
    console.log('\nid\tmotivo\tesperado\tpredicho');
    for (const miss of metrics.misses) {
      console.log(`${miss.id}\t${miss.reason}\t${miss.expected}\t${miss.predicted}`);
    }
  }
  if (metrics.passed) {
    console.log('\nRESULTADO: PASA');
    return 0;
  }
  console.log(`\nRESULTADO: FALLA -> ${metrics.failures.join('; ')}`);
  return 1;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof FollowupEvalInputError) {
    console.error(`Entrada inválida: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
