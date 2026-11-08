# Aurora Concept Designer — Design Standard (v0.3)

Status: [설계 제안] — internal standard for this prototype. Not a user-approved brand guide. Applied directly in code
(`src/ui/styles.css` v0.3 section, `src/ui/viewSettings.ts`). No Superdesign canvas drafts were generated (credit use
needs separate approval).

## Product & tone
- Product name **Aurora Concept Designer**, internal version shown as `v0.3.0-prototype` in the header.
- Neutral engineering tool chrome: flat panels, 1px borders, no gradients/shadows/marketing copy. Never claim
  "commercial complete", "verified", "real photo" or equipment safety.
- Always separate **success** from **assumption / undefined / not verified** (badges with text, not colour only).

## Layout
| region | size | rule |
|---|---|---|
| Header | 48px | brand · current project / step · save / export / undo / theme |
| Explorer (left, all 6 steps) | 248px (≥1700px: 280px), collapsible to 40px | open projects (dirty marker), new/sample/parallel/open/import, recent saves, Station › Substation › Device tree |
| Stepper | 64px | 6 wizard steps + goal + remaining items |
| Workspace | rest | step-specific centre; each list/table/log owns its scroll |
| Status bar | 26px | logic-simulation disclaimer, rev, run state, format/rule versions |
- Target check sizes: 1280×800 and 1920×1080 (app min-width 1180px). Canvas step: palette 196 | canvas | inspector 300.
  Run step: canvas | panel `minmax(380px, 42%)`.

## Tokens
- Type scale: 11 (meta/badge/log) · 12 (controls, tables) · 13 (body) · 14 (header title) · 15 (dialog title).
- Spacing: 4 / 8 / 12 / 16. Radius: 4 (controls) / 6 (cards, dialogs).
- Colours: theme variables only (`--bg --panel --canvas --border --text --muted --accent --selected --success --warning --danger`).
  Themes A (light engineering), B (dark control room), C (warm calm) are kept; contrast is unit-tested (tests/theme-contrast).

## Interaction
- Visible focus ring on every focusable element: `2px solid var(--accent)`, offset 1px.
- Tree items, cards, project list: focusable (`tabIndex=0`), Enter/Space selects.
- Disabled buttons keep a tooltip/reason; running state locks model edits (view-only notice).
- Empty states (`.empty`, `.tempty`) always state what is missing and the next action.

## Visuals
- Schematic is the default. "실사풍(AI)" shows AI-generated photorealistic-style images inside the **same box**
  (`object-fit: contain` / SVG `meet`), never changing geometry, anchors, IDs or selection.
- Every AI image shows an **AI 생성** chip/label and links to its generation metadata; previous third-party photos are
  history only (collapsed details).
