import { PrismaClient } from '@prisma/client';

/**
 * Migration Script: Transform user_settings panel_ui format
 *
 * OLD FORMAT (incorrect):
 * {
 *   app: "ORG_ADMIN",
 *   panel_ui: { dashboard: true, stores: true, ... }
 * }
 *
 * NEW FORMAT (correct):
 * {
 *   panel_ui: {
 *     ORG_ADMIN: { dashboard: true, stores: true, ... }
 *   }
 * }
 *
 * This script transforms all existing user_settings from old format to new format
 */

export async function transformPanelUIFormat(prisma: PrismaClient) {
  console.log('🔄 Starting panel_ui format migration...');

  const userSettings = await prisma.user_settings.findMany();

  let transformed = 0;
  let skipped = 0;
  let errors = 0;

  for (const userSetting of userSettings) {
    try {
      const config = userSetting.config as any;

      // Check if using old format
      // Old format has: config.app AND config.panel_ui (without nested app type)
      // New format has: config.panel_ui.ORG_ADMIN or config.panel_ui.STORE_ADMIN
      if (
        config?.app &&
        config?.panel_ui &&
        !config.panel_ui.ORG_ADMIN &&
        !config.panel_ui.STORE_ADMIN &&
        !config.panel_ui.STORE_ECOMMERCE &&
        !config.panel_ui.VENDIX_LANDING
      ) {
        const appType = config.app;

        // Validate app type
        const validAppTypes = ['ORG_ADMIN', 'STORE_ADMIN', 'STORE_ECOMMERCE', 'VENDIX_LANDING'];
        if (!validAppTypes.includes(appType)) {
          console.warn(`⚠️  Invalid app type '${appType}' for user_setting ${userSetting.id}, skipping`);
          skipped++;
          continue;
        }

        // Transform to new format
        const newConfig = {
          panel_ui: {
            [appType]: config.panel_ui,
          },
        };

        await prisma.user_settings.update({
          where: { id: userSetting.id },
          data: { config: newConfig },
        });

        transformed++;
        console.log(`✅ Transformed user_setting ${userSetting.id} (user_id: ${userSetting.user_id}, app: ${appType})`);
      } else {
        // Already in new format or no config
        skipped++;
      }
    } catch (error: any) {
      errors++;
      console.error(`❌ Error transforming user_setting ${userSetting.id}:`, error.message);
    }
  }

  console.log('\n📊 Migration Summary:');
  console.log(`   Total records: ${userSettings.length}`);
  console.log(`   ✅ Transformed: ${transformed}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);

  if (transformed > 0) {
    console.log('\n✅ Migration completed successfully!');
  } else if (skipped === userSettings.length) {
    console.log('\nℹ️  All records already in new format - no migration needed');
  }

  return { transformed, skipped, errors };
}

/**
 * Rollback function to revert migration if needed
 */
export async function rollbackPanelUIFormat(prisma: PrismaClient) {
  console.log('🔄 Starting panel_ui format rollback...');

  const userSettings = await prisma.user_settings.findMany();

  let rolledBack = 0;
  let skipped = 0;
  let errors = 0;

  for (const userSetting of userSettings) {
    try {
      const config = userSetting.config as any;

      // Check if using new format (has panel_ui with app type)
      if (config?.panel_ui) {
        // Find the app type (first key in panel_ui)
        const appType = Object.keys(config.panel_ui)[0];

        if (
          appType &&
          ['ORG_ADMIN', 'STORE_ADMIN', 'STORE_ECOMMERCE', 'VENDIX_LANDING'].includes(appType)
        ) {
          // Rollback to old format
          const oldConfig = {
            app: appType,
            panel_ui: config.panel_ui[appType],
          };

          await prisma.user_settings.update({
            where: { id: userSetting.id },
            data: { config: oldConfig },
          });

          rolledBack++;
          console.log(`✅ Rolled back user_setting ${userSetting.id} (user_id: ${userSetting.user_id}, app: ${appType})`);
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    } catch (error: any) {
      errors++;
      console.error(`❌ Error rolling back user_setting ${userSetting.id}:`, error.message);
    }
  }

  console.log('\n📊 Rollback Summary:');
  console.log(`   Total records: ${userSettings.length}`);
  console.log(`   ✅ Rolled back: ${rolledBack}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);

  return { rolledBack, skipped, errors };
}

// Run migration if executed directly
if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  transformPanelUIFormat(prisma)
    .then((result) => {
      console.log('\n🎉 Migration process completed');
      process.exit(result.errors > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('💥 Fatal error during migration:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
