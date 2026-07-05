# Flow Components Reference

Copy-paste snippets for building user-story flows. Classes and CSS variables are
defined in `flow-artifact-template.html` — these snippets assume that stylesheet
is present. Content in Spanish; technical tokens (endpoints, codes, fields) in mono.

> **Golden rule:** every node maps to something real in the code — an action, an
> endpoint, a guard, an event, or a status-enum value. If you cannot cite it, it is
> an open question, not a node.

---

## Skeleton of a story

```html
<div class="story">
  <div class="story-top">
    <span class="hu-id">HU-1.1</span>
    <h4>Título corto de la historia</h4>
  </div>
  <p class="as-a">Como <em>actor</em> quiero <em>capacidad</em> para beneficio.</p>

  <div class="track"><div class="flow">
    <!-- nodes + connectors go here -->
  </div></div>

  <div class="evidence">
    <span class="chip">regla o invariante</span>
    <span class="chip ok">evidencia verificada</span>
  </div>
</div>
```

- `.track` provides horizontal scroll on desktop; `.flow` collapses to vertical on mobile.
- The `--i` stagger for scroll-reveal is set by the template's JS automatically over
  the direct children of `.flow` — you do not set it by hand.

---

## Node types

### Action — the actor does something
Solid ink border. Use for the human/actor step.
```html
<div class="node action"><span class="tag">Acción</span>Abre "Nuevo plan"</div>
```

### System — backend / endpoint / service
Accent-tint background. Put the HTTP verb in the tag, the route in `<code>`.
```html
<div class="node system"><span class="tag">POST</span><code>/store/memberships</code></div>
<div class="node system"><span class="tag">Sistema</span>Pliega topes en <code>features</code></div>
```

### Decision — a branch / validation
Dashed border; renders a ◇ before the tag. Always followed by a `.branch` group.
```html
<div class="node decision"><span class="tag">Decisión</span>¿DTO válido?</div>
```

---

## Connector

Faint base line + a flowing "comet" (animated) + a chevron glyph. `aria-hidden`
because it carries no text meaning. Place ONE between every pair of nodes.
```html
<span class="connector" aria-hidden="true"><span class="chev">&rarr;</span></span>
```
On mobile the whole connector rotates 90° so the arrow points down. The comet only
animates once the story is revealed (`.story.in`) and is disabled under reduced-motion.

---

## Branch group — 2 to 4 outcomes of a decision

Each outcome is a `.branch-item`: a mono `.cond` label + an outcome pill/error.
```html
<div class="branch">
  <div class="branch-item">
    <span class="cond">membresía vigente</span>
    <div class="pill s-active" style="width:150px"><span class="tag">Resultado</span>granted:true + log</div>
  </div>
  <div class="branch-item">
    <span class="cond">vencida / pending</span>
    <div class="pill s-deny" style="width:150px"><span class="tag">Resultado</span>denied · expired + log</div>
  </div>
</div>
```
Narrow the pills (`style="width:150px"`) inside branches so the column stays compact.

---

## State pills — the REAL status palette

Map each class to the app's real status color (retune the `--*-t/-b/-l` vars in the
template `:root`). `.s-active` and `.s-pend` also get a subtle live pulse.

| Class | Meaning | Example |
| --- | --- | --- |
| `s-active` | ok / vigente / granted | `<div class="pill s-active"><span class="tag">Estado</span>active + period_end</div>` |
| `s-pend`   | pendiente / en espera | `<div class="pill s-pend"><span class="tag">Estado</span>pending_payment · period_end null</div>` |
| `s-deny`   | error / denegado / suspended | `<div class="pill s-deny"><span class="tag">Error</span><code>404 SYS_NOT_FOUND_001</code></div>` |
| `s-froz`   | info / frozen | `<div class="pill s-froz"><span class="tag">Estado</span>frozen</div>` |
| `s-exp`    | neutral / final / expired / cancelled | `<div class="pill s-exp"><span class="tag">Estado</span>expired</div>` |

---

## Evidence chips

Short mono tags that tie a story to reality — a guard, a fix id, a verified check.
```html
<div class="evidence">
  <span class="chip">H3b — nace sin vigencia</span>   <!-- neutral rule -->
  <span class="chip ok">verificado E2E</span>          <!-- confirmed -->
  <span class="chip acc">fix F1 — payload alineado</span> <!-- accent / code note -->
</div>
```

---

## Epic section + nav anchor

```html
<!-- in nav.toc -->
<a href="#ep2">02 · Socios</a>

<!-- the section -->
<section class="epic" id="ep2">
  <div class="epic-head"><span class="epic-num">02</span><h2>Socios y membresías</h2></div>
  <p class="epic-purpose">/admin/memberships/members — el socio es un users con rol customer.</p>
  <!-- story cards … -->
</section>
```
Keep the nav `href` id in sync with the section `id`. The template JS highlights the
active nav pill as each section scrolls into view.

---

## Animation hooks (do not hand-roll)

The template already wires these; you only author markup:

| Effect | Trigger | Reduced-motion |
| --- | --- | --- |
| Story + node reveal | `.story.in` added by IntersectionObserver; `--i` staggers children | content shown, no transition |
| Flowing connector comet | `.story.in .connector::after` keyframe | comet hidden/static |
| Live-state pulse | `.story.in .pill.s-active/.s-pend` keyframe | no pulse |
| Nav active highlight | IntersectionObserver on `section.epic` | unaffected (not motion) |

All keyframe rules live inside `@media (prefers-reduced-motion: no-preference)`, and
the JS bails out when `matchMedia('(prefers-reduced-motion: reduce)')` matches — so the
document is fully readable and static for users who opt out of motion.
