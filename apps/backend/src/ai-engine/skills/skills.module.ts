import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { createSkillTools } from '../tools/domains/skill.tools';
import { SkillIndexerService } from './skill-indexer.service';
import { SkillRepository } from './skill.repository';
import { SkillSearchService } from './skill-search.service';
import { SkillValidator } from './skill-validator';

/**
 * Skills in the database (F4 T32). `AIEngineModule` is @Global and exports the
 * tool registry, the knowledge search/embedding services, so this module only
 * adds the skill providers and registers `search_skills` / `load_skill`.
 * Import it ONCE (superadmin ai-engine module owns the admin side).
 */
@Module({
  imports: [PrismaModule],
  providers: [
    SkillRepository,
    SkillValidator,
    SkillSearchService,
    SkillIndexerService,
  ],
  exports: [
    SkillRepository,
    SkillValidator,
    SkillSearchService,
    SkillIndexerService,
  ],
})
export class SkillsModule implements OnModuleInit {
  constructor(
    private readonly registry: AIToolRegistry,
    private readonly search: SkillSearchService,
  ) {}

  onModuleInit(): void {
    this.registry.registerMany(
      createSkillTools({
        search: (query, limit) => this.search.search(query, { limit }),
        load: (key) => this.search.load(key),
      }),
    );
  }
}
