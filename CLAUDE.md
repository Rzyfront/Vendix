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

| Action                                                         | Skill                       |
| -------------------------------------------------------------- | --------------------------- |
| After creating/modifying a skill                               | `skill-sync`                |
| Configuring middleware                                         | `vendix-backend-middleware` |
| Creating API endpoints                                         | `vendix-backend-api`        |
| Creating API tests (Bruno)                                     | `vendix-bruno-test`         |
| Creating Angular components                                    | `vendix-frontend-component` |
| Creating Frontend Modules                                      | `vendix-frontend-module`    |
| Creating Seeds                                                 | `vendix-prisma-seed`        |
| Editing Schema                                                 | `vendix-prisma-schema`      |
| General Development                                            | `vendix-development-rules`  |
| Handling Errors                                                | `vendix-error-handling`     |
| Implementing authentication                                    | `vendix-backend-auth`       |
| Managing Routes                                                | `vendix-frontend-routing`   |
| Managing State                                                 | `vendix-frontend-state`     |
| Regenerate AGENTS.md Auto-invoke tables (sync.sh)              | `skill-sync`                |
| Styling and Theming                                            | `vendix-frontend-theme`     |
| Troubleshoot why a skill is missing from AGENTS.md auto-invoke | `skill-sync`                |
| Verifying Build                                                | `vendix-build-verification` |
| Working on backend domains                                     | `vendix-backend-domain`     |
| Working on frontend domains                                    | `vendix-frontend-domain`    |
| Understanding Public/Private Apps and Domains                  | `vendix-app-architecture`   |
| Working with Prisma services                                   | `vendix-backend-prisma`     |
| Writing Code (Naming)                                          | `vendix-naming-conventions` |
| Writing Validation Logic                                       | `vendix-validation`         |

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
| **`Vendix-core`**     | **ALWAYS**          | **CRITICAL** | Core patterns and conventions         |
| **`git-conventions`** | **ALWAYS**          | **CRITICAL** | Git commit message style and workflow |
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

| Skill         | Description                   | Location (Source)                                          |
| ------------- | ----------------------------- | ---------------------------------------------------------- |
| `Vendix-core` | Core patterns and conventions | [skills/Vendix-core/SKILL.md](skills/Vendix-core/SKILL.md) |

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
