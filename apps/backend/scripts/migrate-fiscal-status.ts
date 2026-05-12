import 'dotenv/config';

import { GlobalPrismaService } from '../src/prisma/services/global-prisma.service';
import { FiscalStatusMigrationService } from '../src/common/services/fiscal-status-migration.service';

function parseArgs(argv: string[]) {
  return {
    dryRun: !argv.includes('--run'),
    force: argv.includes('--force'),
    organizationId: Number(
      argv.find((arg) => arg.startsWith('--organization-id='))?.split('=')[1],
    ),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prisma = new GlobalPrismaService();
  await prisma.$connect();

  try {
    const service = new FiscalStatusMigrationService(prisma);
    const report = await service.migrate({
      dryRun: options.dryRun,
      force: options.force,
      organizationId: Number.isFinite(options.organizationId)
        ? options.organizationId
        : undefined,
    });

    console.log(JSON.stringify(report, null, 2));
    if (report.dryRun) {
      console.log(
        'DRY RUN: use --run to persist fiscal_status changes and audit rows.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
