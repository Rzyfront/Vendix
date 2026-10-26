---
name: skill-sync
description: >
  Checklist after creating, editing, renaming or deleting a Vendix skill: edit skills/<name>/SKILL.md, run ./skills/setup.sh, validate frontmatter.
  Trigger: /skill-sync, or right after changing anything under skills/.
disable-model-invocation: true
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Skill Sync

## Source of Truth

- The only editable copy is `skills/<name>/SKILL.md` (plus its `references/` and `assets/`).
- `.claude/skills/<name>` and `.agents/skills/<name>` are **symlinks** created by `./skills/setup.sh`.
  Never edit through them or copy files into them.
- `CLAUDE.md` and `GEMINI.md` are symlinks to `AGENTS.md`. There is no generated Auto-invoke table:
  agents discover skills through their `description`.

## Workflow

1. Create / edit / rename / delete under `skills/<name>/` only. Rename = `git mv` the folder and
   update `name:`; delete = `git rm -r skills/<name>`.
2. Run the setup script so the symlinks match `skills/`:

   ```bash
   ./skills/setup.sh            # = --all
   ./skills/setup.sh --claude   # .claude/skills/<name> -> skills/<name>
   ./skills/setup.sh --gemini   # .agents/skills/<name> -> skills/<name> (Gemini CLI reads it there)
   ```

   Both modes prune broken symlinks (renamed/deleted skills) and recreate `CLAUDE.md` / `GEMINI.md`
   → `AGENTS.md`.
3. Validate the frontmatter (below).
4. Search the other skills for references to a renamed or deleted skill and fix them:
   `grep -rn "<old-name>" skills/ AGENTS.md`.

## Frontmatter Rules

```yaml
---
name: my-skill                 # MUST equal the folder name
description: >
  What it is, in one sentence.
  Trigger: when to load it.
disable-model-invocation: true # optional, top level: hide it; usable only as /my-skill
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash   # optional, top level
---
```

- `description` = what it is + `Trigger: …`, **≤ 250 characters**. It is loaded in every session;
  detail belongs in the body, which loads only on invocation.
- Valid YAML (quote values containing `: `). `name` equal to the folder.
- Use `disable-model-invocation: true` for skills that should run only on explicit request.
- `metadata.scope` and `metadata.auto_invoke` are optional legacy fields: they no longer generate
  anything. Do not add them to new skills.

Quick check (name mismatch and folded `description` over 250 chars; no Node needed):

```bash
python3 - <<'PY'
import glob, os, re
for f in sorted(glob.glob('skills/*/SKILL.md')):
    d = os.path.basename(os.path.dirname(f))
    fm = open(f).read().split('---')[1]
    n = re.search(r'^name:\s*(\S+)', fm, re.M)
    if not n or n.group(1) != d: print('NAME MISMATCH:', d)
    m = re.search(r'^description:[ \t]*[>|]?-?[ \t]*\n?((?:[ \t]+.*\n?)+|.*)', fm, re.M)
    desc = ' '.join(l.strip() for l in (m.group(1) if m else '').splitlines()).strip()
    if len(desc) > 250: print('DESC', len(desc), d)
PY
```
