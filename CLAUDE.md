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
| -- | `vendix-ai-engine` |
| -- | `vendix-auto-entries` |
| -- | `vendix-monorepo-workspaces` |
| -- | `vendix-panel-ui` |
| -- | `vendix-prisma-scopes` |
| Adding modules or submodules to the sidebar | `vendix-panel-ui` |
| Adding new AI applications | `vendix-ai-engine` |
| Adding new automatic journal entries | `vendix-auto-entries` |
| Adding new mapping keys to accounting | `vendix-auto-entries` |
| Adding new menu items to admin layouts | `vendix-panel-ui` |
| Adding new models to domain scopes | `vendix-prisma-scopes` |
| Adding/removing workspaces | `vendix-monorepo-workspaces` |
| After creating/modifying a skill | `skill-sync` |
| Configuring AI providers or applications | `vendix-ai-engine` |
| Configuring CI/CD | `vendix-monorepo-workspaces` |
| Configuring middleware | `vendix-backend-middleware` |
| Configuring panel_ui visibility | `vendix-panel-ui` |
| Creating AI-powered features | `vendix-ai-engine` |
| Creating API endpoints | `vendix-backend-api` |
| Creating API tests (Bruno) | `vendix-bruno-test` |
| Creating Angular components | `vendix-frontend-component` |
| Creating Dockerfiles | `vendix-monorepo-workspaces` |
| Creating Frontend Modules | `vendix-frontend-module` |
| Creating Seeds | `vendix-prisma-seed` |
| Creating migrations, editing migration SQL, deploying migrations to production, recovering from P3009, failed migration recovery, ALTER TYPE ADD VALUE | `vendix-prisma-migrations` |
| Creating or modifying modals in frontend | `vendix-frontend-modal` |
| Creating or refactoring standard admin modules (stats + table) | `vendix-frontend-standard-module` |
| Debugging Forbidden errors in Prisma queries | `vendix-prisma-scopes` |
| Debugging missing accounting entries | `vendix-auto-entries` |
| Designing UI screens, mobile-first layouts, accessibility review, landing pages, UX patterns | `vendix-ui-ux` |
| Editing Schema | `vendix-prisma-schema` |
| Fixing Forbidden/403 errors in scoped services | `vendix-multi-tenant-context` |
| General Development | `vendix-development-rules` |
| Handling Errors | `vendix-error-handling` |
| Handling store context | `vendix-multi-tenant-context` |
| Implementing authentication | `vendix-backend-auth` |
| Implementing multi-tenant logic | `vendix-multi-tenant-context` |
| Implementing stats cards or dashboard metrics with mobile scroll | `vendix-frontend-stats-cards` |
| Installing dependencies | `vendix-monorepo-workspaces` |
| Integrating AI Engine into a domain | `vendix-ai-engine` |
| Managing Routes | `vendix-frontend-routing` |
| Managing State | `vendix-frontend-state` |
| Modifying auto-entry event handlers | `vendix-auto-entries` |
| Modifying package.json | `vendix-monorepo-workspaces` |
| Regenerate AGENTS.md Auto-invoke tables (sync.sh) | `skill-sync` |
| Styling AI interaction buttons or loading states | `vendix-ai-engine` |
| Styling and Theming | `vendix-frontend-theme` |
| Troubleshoot why a skill is missing from AGENTS.md auto-invoke | `skill-sync` |
| Understanding Public/Private Apps and Domains | `vendix-app-architecture` |
| Uploading files, handling S3 URLs, or saving image URLs to database | `vendix-s3-storage` |
| Verifying Build | `buildcheck-dev` |
| Working on backend domains | `vendix-backend-domain` |
| Working on frontend domains | `vendix-frontend-domain` |
| Working with AccountingEventsListener or AutoEntryService | `vendix-auto-entries` |
| Working with MenuFilterService or menu filtering | `vendix-panel-ui` |
| Working with Prisma scoped services | `vendix-prisma-scopes` |
| Working with ai_engine service or AIEngineService | `vendix-ai-engine` |
| Working with notifications, SSE, or adding new event-driven alerts | `vendix-notifications-system` |
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

| Skill                 | Trigger             | Priority     | Description                           |
| --------------------- | ------------------- | ------------ | ------------------------------------- |
| **`how-to-dev`**      | **ALWAYS**          | **CRITICAL** | Mandatory ultra-obligatory dev flow   |
| **`Vendix-core`**     | **ALWAYS**          | **CRITICAL** | Core patterns and conventions         |
| **`git-workflow`**    | **ALWAYS**          | **CRITICAL** | Git commit, PR, branching and conflict rules |
| **`knowledge-gap`**   | **UNKNOWN PATTERN** | **HIGH**     | Protocol for new/undefined patterns   |

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
