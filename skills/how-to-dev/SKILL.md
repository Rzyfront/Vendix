---
name: how-to-dev
description: >
  Establishes the mandatory software development flow using the skills system.
  Trigger: ALWAYS when the user requests changes, new features, or general development.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
---

## When to Use

This skill must govern **EVERY** development interaction in the Vendix repository. It is the master guide for how the AI agent should approach user requests.

## Development Flow (Standard Changes)

When the user requests specific changes or improvements:

1.  **Analyze the Request**: Deeply understand what the user wants.
2.  **Search the Skills Routing**: Check `AGENTS.md` or the provider configuration file (`GEMINI.md`, `CLAUDE.md`) to find skills related to the change.
3.  **Acquire Context**: Read the identified skills BEFORE performing any action to ensure the project's patterns are followed.
4.  **Execute with Context**: Make the change applying the knowledge from the skills.
5.  **Handle Knowledge Gaps**: If the change follows a new undocumented pattern, ask the user whether a new skill should be created.

## Development Flow (Structural Changes / Plans)

When the request involves structural changes, complete flows, broad scope, or a development plan:

1.  **Pre-analysis**: Read and perform a pre-analysis of the user's request.
2.  **Code Analysis**: Create a small code analysis plan based on the request and then plan it out.
3.  **Stage-based Planning**: Break down the plan into various stages and development points.
4.  **Skills Search and Mapping**: Go to the skills listing (`AGENTS.md` or skills routing) to find the correct information based on skills per stage or development point. You must finish ALL skills without exception that may be useful at each stage of the plan, leaving them specifically highlighted in the plan or development below.
5.  **Strict Execution**: During execution or development phases, you must ALWAYS use this same pre-designed strategy based on the plan's points and skills.
6.  **Gap Closure**: At the end, if any stage of the plan did not have a skill to follow this pattern, then design that pattern and propose to the user the possibility of creating a new skill to address the knowledge gap.

## ULTRA-MANDATORY RULES

- **NEVER** create or start a plan without referencing in detail the required skills by stages and points.
- **NEVER, ABSOLUTELY NEVER** start the development of a plan that does not yet have references to skills in its stages or points. Always, _before_ starting to plan or develop, you must verify which skills cover each stage or point and reference them correctly in each one.
- **Always use this pre-designed standard** for all development.
- **Check before Acting**: Never assume a pattern or proceed without mapping the relevant skill to the change points.

## Verification Commands

```bash
# Sync skills after creating/modifying one
./skills/setup.sh --sync

# Check container logs to ensure the development did not break the build
docker logs --tail 40 vendix_backend
docker logs --tail 40 vendix_frontend
```
