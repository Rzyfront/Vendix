# Claude Code Instructions

> **Auto-generated from AGENTS.md** - Do not edit directly.
> Run `./skills/setup.sh --claude` to regenerate.

# Vendix AI Agent Skills System

> **Single Source of Truth** - This file is the master for all AI assistants.
> Run `./skills/setup.sh --sync` to synchronize skills to provider-specific locations.

This repository provides AI agent skills for working with Vendix.
Skills provide on-demand context and patterns for this codebase.

### Auto-invoke Skills

When performing these actions, ALWAYS invoke the corresponding skill FIRST:

| Action | Skill |
|--------|-------|
| -- | `git-workflow` |
| -- | `vendix-ai-agent-tools` |
| -- | `vendix-ai-chat` |
| -- | `vendix-ai-embeddings-rag` |
| -- | `vendix-ai-engine` |
| -- | `vendix-ai-platform-core` |
| -- | `vendix-ai-queue` |
| -- | `vendix-ai-streaming` |
| -- | `vendix-auto-entries` |
| -- | `vendix-currency-formatting` |
| -- | `vendix-date-timezone` |
| -- | `vendix-inventory-stock` |
| -- | `vendix-mcp-server` |
| -- | `vendix-monorepo-workspaces` |
| -- | `vendix-panel-ui` |
| -- | `vendix-prisma-scopes` |
| -- | `vendix-zoneless-signals` |
| Adding MCP resources or tools | `vendix-mcp-server` |
| Adding a new AI provider | `vendix-ai-platform-core` |
| Adding chat features | `vendix-ai-chat` |
| Adding modules or submodules to the sidebar | `vendix-panel-ui` |
| Adding money inputs to forms | `vendix-currency-formatting` |
| Adding new AI applications | `vendix-ai-engine` |
| Adding new DateTime fields to Prisma schema | `vendix-date-timezone` |
| Adding new automatic journal entries | `vendix-auto-entries` |
| Adding new entity types to embeddings | `vendix-ai-embeddings-rag` |
| Adding new mapping keys to accounting | `vendix-auto-entries` |
| Adding new menu items to admin layouts | `vendix-panel-ui` |
| Adding new models to domain scopes | `vendix-prisma-scopes` |
| Adding tool-use to AI features | `vendix-ai-agent-tools` |
| Adding/removing workspaces | `vendix-monorepo-workspaces` |
| After creating/modifying a skill | `skill-sync` |
| Auditing Zoneless compliance (zoneless-audit.sh) or enforcing CI grep rules | `vendix-zoneless-signals` |
| Configuring AI providers or applications | `vendix-ai-engine` |
| Configuring AI rate limiting | `vendix-ai-platform-core` |
| Configuring CI/CD | `vendix-monorepo-workspaces` |
| Configuring MCP authentication | `vendix-mcp-server` |
| Configuring middleware | `vendix-backend-middleware` |
| Configuring panel_ui visibility | `vendix-panel-ui` |
| Creating AI queue processors | `vendix-ai-queue` |
| Creating AI-powered features | `vendix-ai-engine` |
| Creating API endpoints | `vendix-backend-api` |
| Creating API tests (Bruno) | `vendix-bruno-test` |
| Creating Angular components | `vendix-frontend-component` |
| Creating Dockerfiles | `vendix-monorepo-workspaces` |
| Creating Frontend Modules | `vendix-frontend-module` |
| Creating Seeds | `vendix-prisma-seed` |
| Creating date inputs in forms | `vendix-date-timezone` |
| Creating migrations, editing migration SQL, deploying migrations to production, recovering from P3009, failed migration recovery, ALTER TYPE ADD VALUE, checksum mismatch, modified migration after apply | `vendix-prisma-migrations` |
| Creating new AI tools | `vendix-ai-agent-tools` |
| Creating or modifying modals in frontend | `vendix-frontend-modal` |
| Creating or refactoring standard admin modules (stats + table) | `vendix-frontend-standard-module` |
| Creating streaming UI components | `vendix-ai-streaming` |
| Debugging AI job failures | `vendix-ai-queue` |
| Debugging AI request failures | `vendix-ai-platform-core` |
| Debugging Forbidden errors in Prisma queries | `vendix-prisma-scopes` |
| Debugging agent loop issues | `vendix-ai-agent-tools` |
| Debugging embedding generation | `vendix-ai-embeddings-rag` |
| Debugging missing accounting entries | `vendix-auto-entries` |
| Debugging stale templates, missing re-renders, or change detection issues | `vendix-zoneless-signals` |
| Designing UI screens, mobile-first layouts, accessibility review, landing pages, UX patterns | `vendix-ui-ux` |
| Displaying or formatting dates in frontend | `vendix-date-timezone` |
| Displaying or formatting money/currency values | `vendix-currency-formatting` |
| Editing Schema | `vendix-prisma-schema` |
| Editing or creating any Angular component under apps/frontend (Zoneless patterns apply) | `vendix-zoneless-signals` |
| Exposing Vendix data to AI clients | `vendix-mcp-server` |
| Fixing Forbidden/403 errors in scoped services | `vendix-multi-tenant-context` |
| Fixing currency display issues or hardcoded $ symbols | `vendix-currency-formatting` |
| Fixing date display off-by-one bugs | `vendix-date-timezone` |
| Fixing signal-used-without-invoking bugs (!this.flag vs !this.flag()) | `vendix-zoneless-signals` |
| Formatting chart axis labels with dates | `vendix-date-timezone` |
| General Development | `vendix-development-rules` |
| Handling Errors | `vendix-error-handling` |
| Handling store context | `vendix-multi-tenant-context` |
| Implementing AI streaming | `vendix-ai-streaming` |
| Implementing ControlValueAccessor (CVA) in custom form components | `vendix-zoneless-signals` |
| Implementing authentication | `vendix-backend-auth` |
| Implementing multi-tenant logic | `vendix-multi-tenant-context` |
| Implementing semantic search | `vendix-ai-embeddings-rag` |
| Implementing stats cards or dashboard metrics with mobile scroll | `vendix-frontend-stats-cards` |
| Installing dependencies | `vendix-monorepo-workspaces` |
| Integrating AI Engine into a domain | `vendix-ai-engine` |
| Managing Routes | `vendix-frontend-routing` |
| Managing State | `vendix-frontend-state` |
| Migrating legacy Angular patterns (BehaviorSubject, take(1).subscribe) to Signals | `vendix-zoneless-signals` |
| Modifying StockLevelManager service | `vendix-inventory-stock` |
| Modifying auto-entry event handlers | `vendix-auto-entries` |
| Modifying package.json | `vendix-monorepo-workspaces` |
| Modifying the AI chat widget | `vendix-ai-chat` |
| Parsing date strings from query parameters | `vendix-date-timezone` |
| Printing documents with date fields | `vendix-date-timezone` |
| Querying by date ranges in backend | `vendix-date-timezone` |
| Regenerate AGENTS.md Auto-invoke tables (sync.sh) | `skill-sync` |
| Reserving or releasing stock | `vendix-inventory-stock` |
| Reviewing or replacing NgZone, markForCheck, detectChanges, @Input, @Output, EventEmitter | `vendix-zoneless-signals` |
| Styling AI interaction buttons or loading states | `vendix-ai-engine` |
| Styling and Theming | `vendix-frontend-theme` |
| Transitioning products between simple and variant modes | `vendix-inventory-stock` |
| Troubleshoot why a skill is missing from AGENTS.md auto-invoke | `skill-sync` |
| Understanding AI cost tracking | `vendix-ai-platform-core` |
| Understanding Public/Private Apps and Domains | `vendix-app-architecture` |
| Uploading files, handling S3 URLs, or saving image URLs to database | `vendix-s3-storage` |
| Using input(), output(), model(), signal(), computed(), effect(), or toSignal() | `vendix-zoneless-signals` |
| Using toSignal() in facades — validating initialValue presence | `vendix-zoneless-signals` |
| Verifying Build | `buildcheck-dev` |
| Working on backend domains | `vendix-backend-domain` |
| Working on frontend domains | `vendix-frontend-domain` |
| Working with @defer, @if, @for control flow blocks in templates | `vendix-zoneless-signals` |
| Working with AI agent or tool-use | `vendix-ai-engine` |
| Working with AI async processing | `vendix-ai-queue` |
| Working with AI chat NgRx state | `vendix-ai-chat` |
| Working with AI chat conversations | `vendix-ai-engine` |
| Working with AI conversations | `vendix-ai-chat` |
| Working with AI embeddings or RAG | `vendix-ai-engine` |
| Working with AI logging and observability | `vendix-ai-platform-core` |
| Working with AI streaming | `vendix-ai-engine` |
| Working with AIAgentService | `vendix-ai-agent-tools` |
| Working with AIChatService | `vendix-ai-chat` |
| Working with AIEngineService core methods | `vendix-ai-platform-core` |
| Working with AIStreamController | `vendix-ai-streaming` |
| Working with AIToolRegistry | `vendix-ai-agent-tools` |
| Working with AccountingEventsListener or AutoEntryService | `vendix-auto-entries` |
| Working with BullMQ for AI | `vendix-ai-queue` |
| Working with CurrencyPipe or CurrencyFormatService | `vendix-currency-formatting` |
| Working with EventSource for AI | `vendix-ai-streaming` |
| Working with MCP server | `vendix-ai-engine` |
| Working with MCP server | `vendix-mcp-server` |
| Working with McpController | `vendix-mcp-server` |
| Working with MenuFilterService or menu filtering | `vendix-panel-ui` |
| Working with Prisma scoped services | `vendix-prisma-scopes` |
| Working with RAG pipeline | `vendix-ai-embeddings-rag` |
| Working with SSE endpoints for AI | `vendix-ai-streaming` |
| Working with ai_engine service or AIEngineService | `vendix-ai-engine` |
| Working with date.util.ts utilities | `vendix-date-timezone` |
| Working with embeddings or pgvector | `vendix-ai-embeddings-rag` |
| Working with inventory transactions or movements | `vendix-inventory-stock` |
| Working with stock levels, inventory adjustments, or stock transfers | `vendix-inventory-stock` |
| Working with toLocaleDateString or DatePipe | `vendix-date-timezone` |
| Writing Code (Naming) | `vendix-naming-conventions` |
| Writing Validation Logic | `vendix-validation` |
| changes with database migrations | `git-workflow` |
| git commit, git push, create PR, create branch | `git-workflow` |
| resolve merge conflicts | `git-workflow` |

---

## 🗣️ Language & Communication

**CRITICAL PROTOCOL:** The model must **ALWAYS** detect the language used by the user and respond in the same language.

- **User speaks English** → Respond in English.
- **User speaks Spanish** → Respond in Spanish.
- **User speaks French** → Respond in French.
- _(Adapt to any language used by the user)_

## 🚀 Quick Start

### How Skills Work

1. **Auto-detection:** AI detects context and loads appropriate skills
2. **Composition:** Multiple skills can be active simultaneously
3. **Priority:** CORE skills have absolute priority and must ALWAYS be respected

## 🚨 CORE SKILLS - Always Active

**These skills contain the MOST CRITICAL rules that must ALWAYS be respected:**

| Skill                             | Trigger                       | Priority     | Description                                                                 |
| --------------------------------- | ----------------------------- | ------------ | --------------------------------------------------------------------------- |
| **`how-to-dev`**                  | **ALWAYS**                    | **CRITICAL** | Mandatory ultra-obligatory dev flow                                         |
| **`Vendix-core`**                  | **ALWAYS**                    | **CRITICAL** | Core patterns and conventions                                               |
| **`git-workflow`**                | **ALWAYS**                    | **CRITICAL** | Git commit, PR, branching and conflict rules                                |
| **`vendix-zoneless-signals`**     | **ANY FRONTEND FILE**         | **CRITICAL** | Zoneless + Signals (Angular 20) — violaciones producen bugs silenciosos     |
| **`knowledge-gap`**               | **UNKNOWN PATTERN**           | **HIGH**     | Protocol for new/undefined patterns                                         |

**⚠️ IMPORTANT:** NEVER compromise these rules. They are the foundation of the project.

## 🧬 Protocol for New Patterns (MANDATORY)

**IF** you develop a new feature, architecture, or pattern that is **NOT** covered by existing skills or documentation:

1. **IDENTIFY:** Recognize that you are introducing a new standard or pattern.
2. **PROPOSE:** You **MUST** ask the user if they wish to create a new skill for this pattern.
3. **STANDARDIZE:** If agreed, suggest the structure for the new skill (Description, Trigger, Code Examples).

> **AI Instruction:** _"I notice we are implementing a new pattern for [Concept]. Should we create a skill for this to maintain future consistency?"_ (Translate this question to the user's language).

## 🔧 Architecture & Patterns

### Repository-Specific Skills

| Skill                    | Description                                             | Location (Source)                                                                |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Vendix-core`            | Core patterns and conventions                           | [skills/Vendix-core/SKILL.md](skills/Vendix-core/SKILL.md)                       |
| `vendix-product-pricing` | Advanced product pricing logic and rentability patterns | [skills/vendix-product-pricing/SKILL.md](skills/vendix-product-pricing/SKILL.md) |
| `agent-teams`            | Agent team orchestration for complex composite tasks    | [skills/agent-teams/SKILL.md](skills/agent-teams/SKILL.md)                       |

## ⚙️ Configuration & Sync

Each AI provider requires specific configuration paths. Run `./skills/setup.sh` to sync to these locations:

| Provider           | Config File                       | Skill Location                     |
| ------------------ | --------------------------------- | ---------------------------------- |
| **OpenCode**       | `opencode.json`                   | `.opencode/skills/<name>/SKILL.md` |
| **Claude Code**    | `CLAUDE.md`                       | `.claude/skills/<name>/SKILL.md`   |
| **Gemini**         | `GEMINI.md`                       | `.agent/skills/<name>/SKILL.md`    |
| **GitHub Copilot** | `.github/copilot-instructions.md` | N/A (Embedded in instructions)     |

## 🎯 Auto-Invoke Rules

### Development Workflow

**ALWAYS invoke skills in this order:**

1. **CORE Skills** (Always Active)
   - Check `Vendix-core` for fundamental rules

2. **Context-Specific Skills**
   - Check available skills in `skills/` (or provider-specific folders)

## 🔄 Sync & Setup

### Sync Skills to AI Tools

```bash
./skills/setup.sh --sync
```

### Regenerate Config Files

```bash
./skills/setup.sh --all        # All formats
./skills/setup.sh --claude     # Claude Code only
./skills/setup.sh --copilot    # GitHub Copilot only
./skills/setup.sh --gemini     # Gemini only
./skills/setup.sh --opencode   # OpenCode only
```
