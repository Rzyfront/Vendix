---
name: {skill-name}
description: >
  {Short description of what this skill governs}.
  Trigger: {Specific action, file type, domain, or workflow that should load it}.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "{Specific action that should load this skill}"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# {Skill Title}

## Purpose

{What this skill governs and what it does not govern.}

## Core Rules

- {Critical rule 1}
- {Critical rule 2}
- {Critical rule 3}

## Workflow

1. {Step 1 if sequence matters}
2. {Step 2}
3. {Step 3}

## Decision Rules

| Situation | Use |
| --- | --- |
| {Condition} | {Action} |

## Related Skills

- `{related-skill}` - {Why it is related}
