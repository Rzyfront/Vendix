# Setup de agentes (Claude Code / Gemini) para Vendix

Se hace una vez por máquina. Deja a todo el equipo con el mismo flujo: ODD, revisión RDD y skills del repo.

## 1. Skills del repo
```bash
./skills/setup.sh   # enlaza skills/ en .claude/skills y .agents/skills, y CLAUDE.md/GEMINI.md → AGENTS.md
```
Corre esto de nuevo después de cada pull que agregue o borre skills.

## 2. gentle-ai (ODD + RDD)
```bash
brew install gentleman-programming/tap/gentle-ai
gentle-ai install --agents claude-code,gemini-cli --preset custom --persona custom \
  --components skills,permissions,persona --claude-orchestrator-modules
gentle-ai telemetry disable
```
- Componentes: `skills` (skills de review), `permissions` (bloquea `.ssh`, `.env`, `.pem` y otras credenciales) y persona `custom` (no cambia tu estilo).
- No instales `engram` (si ya lo tienes como plugin), `gga`, `context7` ni `theme`.
- La revisión RDD viene activa. Para apagarla en un repo: `gentle-ai review mode disable --scope clone`.

## 3. Flujo
Las reglas están en `AGENTS.md`: historia de usuario primero, ODD (lo pequeño inline, lo grande con `odd/tasks/<feature>.md` y aprobación) y solo los tests del cambio. El trabajo grande que delega usa el skill `sopus`.
