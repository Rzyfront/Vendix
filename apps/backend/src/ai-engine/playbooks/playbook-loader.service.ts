import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { readdirSync, readFileSync, lstatSync } from 'fs';
import { join } from 'path';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import { ApiCatalogService } from '../tools/bridge/api-catalog.service';
import { catalogHash } from '../tools/tool-catalog';
import type { PlaybookDocument } from './playbook.interface';
import {
  parsePlaybookMarkdown,
  validatePlaybookCatalog,
} from './playbook-validator';

@Injectable()
export class PlaybookLoaderService implements OnApplicationBootstrap {
  private documents: PlaybookDocument[] = [];
  private initialized = false;
  private initialization?: Promise<void>;

  constructor(
    private readonly registry: AIToolRegistry,
    private readonly apiCatalog: ApiCatalogService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.initializeRelease();
  }

  /**
   * API catalog's synchronous bootstrap and decentralized onModuleInit hooks finish
   * before this microtask resumes. The indexer awaits this SAME promise, rather than
   * depending on provider declaration order among parallel bootstrap hooks.
   */
  async initializeRelease(): Promise<void> {
    if (!this.initialization)
      this.initialization = Promise.resolve().then(() => this.readRelease());
    await this.initialization;
  }

  /** Assets ship beside the compiled loader. No cwd, repo, tenant or URL fallback. */
  assetDirectory(): string {
    return join(__dirname, 'content');
  }

  getPlaybooks(): readonly PlaybookDocument[] {
    if (!this.initialized) throw new Error('PLAYBOOK_BOOT_BARRIER');
    // Callers never receive mutable references into the release snapshot.
    return structuredClone(this.documents);
  }

  getReleaseHash(): string {
    return catalogHash(
      this.getPlaybooks().map((document) => [
        document.id,
        document.metadata.version,
        document.hash,
      ]),
    );
  }

  private readRelease(): void {
    const directory = this.assetDirectory();
    let files: string[];
    try {
      const directoryInfo = lstatSync(directory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())
        throw new Error('UNSAFE_DIRECTORY');
      files = readdirSync(directory)
        .filter((file) => file.endsWith('.md'))
        .sort();
      if (!files.length) throw new Error('EMPTY_RELEASE');
    } catch {
      throw new Error('PLAYBOOK_ASSETS_UNAVAILABLE');
    }
    const candidates = files.map((file) => {
      if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(file))
        throw new Error('PLAYBOOK_ASSET_NAME_INVALID');
      const path = join(directory, file);
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024)
        throw new Error(`PLAYBOOK_ASSET_INVALID:${file}`);
      return parsePlaybookMarkdown(readFileSync(path, 'utf8'), file);
    });
    // Full release catalog, NOT caller scopes. This validates contracts, grants nothing.
    const endpoints = this.apiCatalog.listFor([
      ...this.apiCatalog.coveredPermissions(),
    ]);
    const validated = validatePlaybookCatalog(candidates, {
      tools: this.registry.getAll(),
      endpoints,
    });
    this.documents = validated.playbooks.map((document) => ({
      ...document,
      contract: {
        ...document.contract,
        gaps: [
          ...new Set([
            ...document.contract.gaps,
            ...validated.gaps
              .filter((gap) => gap.playbook_id === document.id)
              .map(
                (gap) =>
                  `${gap.code}:${gap.step_id ?? 'process'}:${gap.detail}`,
              ),
          ]),
        ],
      },
    }));
    this.initialized = true;
  }
}
