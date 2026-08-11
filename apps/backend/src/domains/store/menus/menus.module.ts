import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { MenusController } from './menus.controller';
import { MenusService } from './menus.service';
import { MenuSectionsController } from './menu-sections.controller';
import { MenuSectionsService } from './menu-sections.service';
import { MenuAvailabilityController } from './menu-availability.controller';
import { MenuAvailabilityService } from './menu-availability.service';
import { MenuEngineeringController } from './menu-engineering.controller';
import { MenuEngineeringService } from './menu-engineering.service';
import { MenuAvailabilityCheckerService } from './menu-availability-checker.service';

/**
 * MenusModule — Restaurant Suite Fase G.
 *
 * Owns:
 *  - menus / menu_sections / menu_section_items CRUD
 *  - menu_availability_windows CRUD (menu-level + section-level)
 *  - Menu engineering analytics (estrella / caballo / puzzle / perro)
 *
 * No cross-store module import: tenant isolation comes from the
 * `StorePrismaService` auto-scope. The menu engineering service reads
 * recipes and order_items directly via the same scoped client.
 *
 * `S3Module` is imported because the carta responses expose product images:
 * the DB stores raw S3 keys, so every read has to sign them before answering
 * (see `vendix-s3-storage`).
 */
@Module({
  imports: [ResponseModule, PrismaModule, S3Module],
  controllers: [
    MenusController,
    MenuSectionsController,
    MenuAvailabilityController,
    MenuEngineeringController,
  ],
  providers: [
    MenusService,
    MenuSectionsService,
    MenuAvailabilityService,
    MenuEngineeringService,
    MenuAvailabilityCheckerService,
  ],
  exports: [
    MenusService,
    MenuSectionsService,
    MenuAvailabilityService,
    MenuEngineeringService,
    MenuAvailabilityCheckerService,
  ],
})
export class MenusModule {}
