---
name: ae-scene-craft
description: How to plan scenes, apply effects safely, batch calls efficiently, and rig animations well using the ae_* After Effects tools (the ae-bridge MCP server) — matchName/property discovery instead of guessing, verifying changes actually rendered rather than trusting a clean response, and animation craft like null-based rigging, precomposing, and easing. Make sure to use this skill whenever building or modifying a scene in After Effects via ae_* tools, applying any effect, creating a multi-layer composition, or setting up parenting/rigging — even if the user doesn't explicitly ask for "best practices" or mention this skill by name. This is about HOW to build well, distinct from CLAUDE.md's project-specific bug list.
---

# AE scene craft

This skill is about judgment, not just tool syntax: how to plan before building, how to
find out what an effect actually needs instead of guessing, and how to rig a scene the
way a motion designer would rather than brute-forcing every layer by hand. The `ae_*`
tools will happily let you build something structurally sound but visually wrong (a
correctly-executed effect with a silently-wrong property name, white text on a white
background, an animation that's technically keyframed but reads as janky) — the habits
below exist because each one caught a real mistake during actual production use of this
toolset.

## 1. Effects: discover and verify, never guess

An effect's matchName and its properties are two separate unknowns, and each fails
differently, so treat them differently.

**Finding the effect**: call `ae_list_available_effects` with a keyword query before
applying anything, even an effect you're confident you know the name of. This also
tells you the effect's `category` — anything outside a native AE category (Generate,
Distort, Stylize, Blur & Sharpen, etc.) is a third-party plugin, which means there's no
Adobe scripting documentation for it. For those, a quick web search for "<plugin name>
parameters" before touching properties saves a lot of trial and error.

**Finding its properties**: this is where the two AE tools diverge in a way worth
knowing. `ae_apply_effect`'s `settings` map silently skips any property name it doesn't
recognize — no error, no signal, it just doesn't set it. `ae_set_effect_property`, by
contrast, throws a clear error naming the effect if the property doesn't exist. So when
you're not certain of a property's exact name, apply the effect bare and set each
property individually through `ae_set_effect_property` — a wrong guess tells you
immediately instead of silently producing nothing.

**When a value seems to do nothing**: don't conclude the property is broken just
because a subtle setting (a small exposure, a light amount) produces no visible change
in a render. Temporarily push the value to an extreme, re-export the frame, and look.
If the extreme is obviously visible, the mechanism works fine and your original value
was just genuinely subtle at that scale — set it back and move on. If even the extreme
shows nothing, the property name or the effect itself is wrong, and now you know to dig
further rather than ship something that silently does nothing.

**The one non-negotiable habit**: call `ae_export_frame` and actually look before
calling something done. A clean, error-free response describes what the API accepted,
not what it looks like. Every category of mistake above — wrong property, wrong color
against the wrong background, a value too subtle to matter — passes every API check and
only shows up in the render.

## 2. Plan the scene before calling any tool

Time spent thinking before the first tool call is cheaper than time spent debugging
after the tenth.

**Work out geometry on paper first.** For anything beyond a rectangle or circle —
custom shapes, multi-part layouts, anything with edges that need to line up — compute
the actual coordinates by hand before writing a single call. If adjacent pieces need to
share an edge (like bands of a segmented shape), verify algebraically that their shared
boundary coordinates actually match before you build either one. Discovering a
one-pixel gap after building five interlocking pieces costs far more than five minutes
of arithmetic up front.

**Decide layer structure deliberately, not by default.** The most consequential
question is usually: does this piece need to be its own layer, or can it live as a
group inside a shared layer? Groups within one shape layer share that layer's Opacity
and Transform — if two pieces need to animate on different timing, they need to be
separate layers. Deciding this after you've already built everything as one layer means
rebuilding it.

**Name layers for what they are, at creation time.** A layer created with
`name: "Pyramid L1"` can be found again by name after anything reshuffles the layer
order — and in AE, a lot reshuffles layer order (new layers insert at the top, deletes
shift everything above them down). A layer left with its default name is much harder to
re-identify safely later, which pushes you toward trusting a stale index instead of
re-listing — exactly the mistake that causes edits to land on the wrong layer.

**Check colors against what's actually behind them.** A color decision made in
isolation ("this text should be white") is only correct if you also know what's
underneath at that exact position. White text reads fine on a dark shape and disappears
completely on the plain white canvas next to it. Make the color call together with the
placement call, not separately.

**When elements must align across parents sitting at different positions or sizes
(a shared caption row under cards of different heights, a common baseline across a
staggered layout), give them one shared absolute reference — never a per-parent local
offset.** A local offset computed from "distance below this card's own bottom edge"
looks right for whichever card you tested it on, but a taller or differently-positioned
neighbor's version of that same offset can land inside a completely different card's
area. If the elements are visually meant to line up as a group regardless of what each
one is near, position them independently in absolute coordinates instead of inheriting
from whichever nearby object seems like the natural parent.

## 3. Batch related calls (limits verified)

`ae_batch` runs a sequence of tool calls in one round trip inside a single undo group,
and using it for a related group of calls (creating several layers, setting several
properties, adding several keyframes) is noticeably faster than firing them one at a
time.

Earlier versions of the bridge dropped large or many-call requests (fragmented reads, and responses
containing empty arrays being split on raw newlines). Both are fixed (see CLAUDE.md, ROOT CAUSES), and
the old "4-6 calls per batch" rule no longer applies: a 100-call batch and an 11-call batch with ~3KB of
text both succeed. What still matters is the timeout budget and verifying state after any failure,
covered next.

**Re-list before trusting an index across a batch boundary.** If a batch created,
deleted, or reordered layers, call `ae_list_layers` again before the next batch
addresses anything by index — the indices from before that batch are no longer
reliable. This is the same discipline as anywhere else in AE work, just easy to forget
mid-batch because it feels like one continuous operation.

**For genuinely bulk, repetitive construction, reach for `ae_run_macro` instead of
`ae_batch`.** Even at a safe batch size, `ae_batch` still pays a network round trip for
the whole batch and dispatches each call inside it separately. `ae_run_macro` runs a JS
snippet that calls `ops.*` (the same functions every `ae_*` tool calls internally — same
naming conversion as `ae_batch`'s tool names, just without the `ae_` prefix and with the
rest camelCased) in a loop, in one round trip, one undo group, with none of the per-call
overhead. Building N shapes with the same pattern is the clearest case: one macro script
with a `for` loop instead of N batches. It only has access to `ops` and a `results`
array to push return values onto — nothing else from the bridge's own internals, and a
blocklist rejects file/system/network/ScriptUI access. That's a guard against accidental
misuse, not a security sandbox, so treat it with the same trust boundary as every other
tool here: fine to use freely against your own bridge, not something to expose to a
network you don't control.

**`ae_run_macro` limits (verified 2026-10-07 after the transport fixes):** macros of ~1,600 ops run in
about 16s and 2,000 cheap ops in under half a second, so there is no "handful of ops" rule any more.
The real limits are the 60s client timeout per macro (15s for other calls, 5s for ping) and that AE
cannot interrupt a macro once it is running, so keep any single call well under 60s and split a long
build into logical steps. If a macro or batch times out or errors, `ae_ping` and then list what exists
before re-running it: it may have partly applied, and only read-only calls are safe to retry blindly.

**Routing between the bridge and a JSX script is governed by CLAUDE.md rule 7: bridge by default,
ask the user once before a large new build (JSX script vs bridge steps), remember the answer for
the session, and fall back to JSX automatically if the bridge is down.** (An older version of this
skill said to default to `-r` for every build; that predates the transport fixes and is withdrawn.)
What is still true of the JSX route: `AfterFX.exe -r "<script.jsx>"` runs against the already-open AE
and its current project with no 60-second ceiling and no socket layer, so it suits very large one-shot
builds. Three caveats: it has no blocklist at all (only run scripts you have read and trust), strip any
`alert()`/`confirm()`/`prompt()` first (a modal blocks AE waiting for a click that never comes), and do
not guess at other flags (an unrecognized one such as `-help` is misread as "import this file" and
throws a visible error dialog in the user’s AE window).

## 4. Animation and rigging craft

These are the patterns that separate "technically animated" from "animated the way a
motion designer would actually build it."

**Use a null to control a group, instead of keyframing each layer identically.** When
several layers need to move, scale, or rotate together, create a null
(`ae_create_null`) and parent (`ae_set_layer_parent`) the layers to it. Animate the
null once, and every child follows — and if the timing or easing needs to change later,
there's exactly one place to change it, instead of hunting down duplicate keyframes
across every layer.

**Precompose a self-contained unit once it's actually self-contained.** When a group of
layers forms one coherent thing (five pyramid bands that always move together, a logo
made of several shapes), collapsing it with `ae_precompose` turns it into a single
layer you can animate as one unit — fade the whole thing in with one Opacity keyframe
pair instead of five, and keep the top-level timeline readable as the scene grows.
To nest a comp that already exists inside another one, use `ae_add_comp_as_layer`
(give the source by name, not index).

**Give a camera a point-of-interest null.** The standard AE pattern is to parent the
camera to a null, so the look-at target can be repositioned independently of the
camera's own position — trying to animate both together on the camera layer directly
gets tangled fast.

**Keep parenting shallow unless the scene genuinely needs a chain.** A deep parenting
chain (A parents to B parents to C) compounds transforms at every level, which makes
position math progressively harder to reason about. Reserve real chains for cases that
actually need articulation — an arm parented to a shoulder parented to a torso — and
default to parenting everything to one master null otherwise.

**To change what a layer pivots around (e.g. scale from the bottom edge instead of the
center) without touching a single child's position, move Anchor Point and Position
together, keeping their difference constant.** A parented child's world position only
depends on the parent's `Position - Anchor` staying the same — not on the individual
values of either one. So to re-pivot a layer that already has children parented to it:
compute the new Anchor (e.g. `[0, height/2]` for the bottom edge, in the layer's own
local coordinate space) and set Position to the OLD `Position - OLD Anchor + NEW Anchor`
in the same call. Every child keeps rendering exactly where it already was, with zero
per-child math, and scale/rotation animated afterward now pivots around the new point.
Skipping this and only moving Anchor (or only Position) will visibly shift every child
by the difference.

**Turn on motion blur deliberately.** It's off by default, and anything moving fast
without it reads as a strobing jump rather than smooth motion. Easy to forget because
nothing errors if you skip it — the only sign is the render looking slightly wrong.

**Ease keyframes on purpose.** AE's default linear interpolation rarely looks
intentional, especially on an entrance or exit. `ae_set_keyframe_easing` with
`easyEase: true` (or explicit interpolation types) is a small addition that makes the
difference between motion that reads as "keyframed" and motion that reads as designed.

## 5. Look-and-feel recipes (verified on AE 26.5)

These were each learned the hard way while recreating reference designs; they save the
trial and error.

**Shape layers**
- **Group order: the first group added renders in FRONT.** Add the details (lines, badges,
  headers) first and the card/background group LAST. Within a group add the stroke before
  the fill, or the fill covers the inner half of the border.
- **Rounded corners on polygons:** add a stroke the same color as the fill (~12px) with Line
  Join = round (`ADBE Vector Stroke Line Join` = 2). The Round Corners operator does nothing.
- **Dashed lines:** under the stroke’s `ADBE Vector Stroke Dashes` group,
  `addProperty("ADBE Vector Stroke Dash 1")` and `("ADBE Vector Stroke Gap 1")`, then setValue.
- **Effects on a shape layer (blur, glow) are clipped to the shape’s bounding box**, giving
  hard straight edges. Add a near-invisible full-comp rectangle (fill opacity ~1%) to that
  layer, or build the element on a solid instead.
- **Real gradients:** gradient-fill stops can’t be scripted. Use a comp-size solid with
  Gradient Ramp (`ADBE Ramp`: Start of Ramp / Start Color / End of Ramp / End Color) matted by a
  shape layer: `shade.setTrackMatte(matte, TrackMatteType.ALPHA)`, `matte.enabled = false`, then
  `shade.moveBefore(shapeLayer)` so it sits above the shape but below the text.
- **Background gradients:** `ADBE 4ColorGradient` (Point 1-4, Color 1-4 as RGBA 0-1, Blend);
  animate the points for slow drift. Grain: `ADBE Noise` -> "Amount of Noise" (default 0; ~3).

**Parenting, text and stacking**
- **Opacity is NOT inherited through parenting** (position/scale/rotation are). Keyframe the
  children’s opacity too, or titles pop in before their card.
- **Set `.parent` first, then set Position** (local = absolute - parent position); setting
  position first makes AE compensate and the child jumps.
- **Text:** to hit a target width, create it, then scale the font size by
  `target / sourceRectAtTime(...).width`. Center on the ink rect:
  `pos = target - (rect.left + rect.width/2, rect.top + rect.height/2)`. Set justification,
  leading (`autoLeading = false`) and tracking (an integer) through `TextDocument`; use ``
  for line breaks. Inter has Regular/Medium/SemiBold only (no Bold); Montserrat has the full family.
- **New layers insert at index 1** (top). Create backgrounds first and text last, or reorder with
  `moveBefore`/`moveAfter`. Text must be above its shape layer.

**Effect parameter facts**
- **Drop Shadow** (`ADBE Drop Shadow`): Shadow Color, Opacity (**0-255 scale**, 127.5 = 50%),
  Direction, Distance, Softness. Reading every property back without try/catch has thrown.
- **Deep Glow 2** (`PEDG2`): Exposure and Radius. The default Radius 1000 floods the frame;
  ~150-300 gives a tight glow. This install reports as unlicensed.
- For any other effect, list `effect.property(i).name` once instead of guessing names.

**Recreating a reference image**
- Make the comp the reference’s aspect ratio and scale every coordinate by one factor
  `K = compWidth / refWidth`. Measure text widths in the reference, fit font sizes to them, then
  render and compare widths and positions instead of eyeballing.
- Icons are placeholders: nulls parented to their card, scaled to the icon footprint, created
  LAST (each null adds a project item and shifts comp indices; resolve the comp by name).
- Say plainly what the bridge can’t do (gradient fills, missing fonts) rather than faking it silently.
