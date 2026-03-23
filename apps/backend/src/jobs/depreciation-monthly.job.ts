import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class DepreciationMonthlyJob {
  private readonly logger = new Logger(DepreciationMonthlyJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  @Cron('0 6 1 * *') // 1st of each month at 6 AM
  async handleMonthlyDepreciation() {
    this.logger.log('Running monthly depreciation job...');

    // Calculate for previous month
    const now = new Date();
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const month = now.getMonth() === 0 ? 12 : now.getMonth(); // previous month
    const period_date = new Date(year, month - 1, 1);

    try {
      // Find all active fixed assets across all organizations
      const active_assets = await this.prisma.fixed_assets.findMany({
        where: {
          status: 'active',
          depreciation_start_date: { lte: period_date },
        },
      });

      let processed = 0;
      let skipped = 0;

      for (const asset of active_assets) {
        try {
          // Check if entry already exists
          const existing = await this.prisma.depreciation_entries.findFirst({
            where: {
              fixed_asset_id: asset.id,
              period_date,
            },
          });

          if (existing) {
            skipped++;
            continue;
          }

          // Calculate monthly depreciation
          const cost = Number(asset.acquisition_cost);
          const salvage = Number(asset.salvage_value);
          const accumulated = Number(asset.accumulated_depreciation);
          const months = asset.useful_life_months;

          let monthly_amount: number;
          if (asset.depreciation_method === 'declining_balance') {
            const useful_life_years = months / 12;
            const rate = 2 / useful_life_years;
            const book_value = cost - accumulated;
            if (book_value <= salvage) continue;
            monthly_amount = Math.min((rate * book_value) / 12, book_value - salvage);
          } else {
            // straight_line
            if (cost - accumulated <= salvage) continue;
            monthly_amount = (cost - salvage) / months;
            const max_remaining = cost - accumulated - salvage;
            monthly_amount = Math.min(monthly_amount, max_remaining);
          }

          if (monthly_amount <= 0) continue;

          monthly_amount = Math.round(monthly_amount * 100) / 100;
          const new_accumulated = Math.round((accumulated + monthly_amount) * 100) / 100;
          const new_book_value = Math.round((cost - new_accumulated) * 100) / 100;

          // Create entry and update asset
          await this.prisma.$transaction(async (tx: any) => {
            await tx.depreciation_entries.create({
              data: {
                fixed_asset_id: asset.id,
                period_date,
                depreciation_amount: new Prisma.Decimal(monthly_amount),
                accumulated_total: new Prisma.Decimal(new_accumulated),
                book_value: new Prisma.Decimal(new_book_value),
                status: 'posted',
              },
            });

            const update_data: any = {
              accumulated_depreciation: new Prisma.Decimal(new_accumulated),
              updated_at: new Date(),
            };

            if (new_book_value <= salvage) {
              update_data.status = 'fully_depreciated';
            }

            await tx.fixed_assets.update({
              where: { id: asset.id },
              data: update_data,
            });
          });

          // Emit event for auto accounting entry
          this.event_emitter.emit('depreciation.posted', {
            asset_id: asset.id,
            asset_number: asset.asset_number,
            organization_id: asset.organization_id,
            store_id: asset.store_id,
            amount: monthly_amount,
            period_date,
          });

          processed++;
        } catch (error) {
          this.logger.error(
            `Error processing depreciation for asset ${asset.asset_number}: ${error.message}`,
            error.stack,
          );
        }
      }

      this.logger.log(
        `Monthly depreciation complete: ${processed} processed, ${skipped} skipped (already existed)`,
      );
    } catch (error) {
      this.logger.error('Error in monthly depreciation job', error);
    }
  }
}
