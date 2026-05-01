---
name: skill-creator
description: >
  Creates or updates Vendix AI agent skills using the repository skill standard.
  Trigger: When creating a new skill, updating skill guidance, documenting repeatable AI patterns, or resolving a knowledge gap.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Creating a new skill"
    - "Updating skill guidance or documenting repeatable AI patterns"
    - "Resolving a knowledge gap by creating or updating a skill"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch, Task
---

# Skill Creator

## Purpose

Use this skill to create or update reusable AI guidance for Vendix. Skills should be compact, accurate, scoped to one responsibility, and synchronized through `skill-sync`.

## When To Create Or Update A Skill

Create or update a skill when:

- A pattern is repeated across tasks and agents need consistent guidance.
- Vendix behavior differs from generic framework defaults.
- A workflow needs explicit decision rules, commands, or safety constraints.
- A plan step exposes a knowledge gap that should become reusable guidance.

Do not create a skill for one-off instructions, obvious conventions, or content already covered by an accurate existing skill.

## Skill Standard

Each skill should have:

- One clear owner scope and purpose.
- Frontmatter with `name`, `description`, `license`, `metadata.author`, `metadata.version`, and usually `metadata.scope` plus `metadata.auto_invoke`.
- Critical rules first.
- Minimal examples only when they prevent mistakes.
- References to related skills instead of duplicating their rules.
- No stale project names, provider-specific assumptions, or absolute user paths.

## Frontmatter Template

```yaml
---
name: vendix-example-skill
description: >
  Short description of what this skill governs.
  Trigger: Specific action, file type, domain, or workflow that should load it.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Specific action that should load this skill"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---
```

`allowed-tools` is optional and belongs at the top level. Keep `metadata.auto_invoke` specific enough to avoid loading unrelated skills.

## Content Template

```markdown
# Skill Title

## Purpose
[What this skill governs and what it does not govern]

## Core Rules
- [Most important rules]

## Workflow
1. [Only if this skill requires sequence]

## Decision Rules
| Situation | Use |
| --- | --- |
| [Condition] | [Action] |

## Related Skills
- `other-skill` - [why it is related]
```

## Update Workflow

1. Check whether an existing skill should be updated instead of creating a new one.
2. Read related skills to avoid duplication.
3. Edit only the source skill under `skills/`.
4. Keep guidance compact and current with the real codebase.
5. Run `./skills/skill-sync/assets/sync.sh`.
6. Run `./skills/setup.sh --sync`.
7. Verify generated provider copies and `AGENTS.md` auto-invoke entries.

## Naming Rules

| Skill Type | Pattern | Examples |
| --- | --- | --- |
| Workflow | `{action}-{target}` | `skill-creator`, `buildcheck-dev` |
| Vendix domain | `vendix-{domain}` | `vendix-subscription-gate` |
| Vendix app/layer | `vendix-{layer}-{topic}` | `vendix-frontend-routing` |
| AI platform | `vendix-ai-{topic}` | `vendix-ai-streaming` |

## Related Skills

- `skill-sync` - Required after creating or modifying skills
- `how-to-plan` - Marks knowledge gaps that may become skills
- `how-to-dev` - Requires loading relevant skills before development
