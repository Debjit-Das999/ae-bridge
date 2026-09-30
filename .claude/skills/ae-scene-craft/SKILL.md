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

## 3. Batch related calls, but keep batches modest

`ae_batch` runs a sequence of tool calls in one round trip inside a single undo group,
and using it for a related group of calls (creating several layers, setting several
properties, adding several keyframes) is noticeably faster than firing them one at a
time.

There are two distinct ways a batch can go wrong, and the safer habit covers both: aim
for roughly 4-6 calls per batch, even when every call is short.

The first is a long request line — a batch with a lot of calls that each carry
substantial string content (several text layers' worth of font names, colors, and
positions, for instance) can produce a single line long enough to break the socket
transport. This one corrupts the connection: the bridge stops responding to everything,
including `ae_ping`, and needs an After Effects restart to recover.

The second is sneakier: a batch of *short* calls — plain numbers and small arrays, no
long strings — can also silently fail past a certain count (observed at 8 calls; 4
worked immediately with the exact same content just split in half). The difference is
that the bridge stays healthy — `ae_ping` and other calls work fine right after — but
the batch's own changes simply never applied, with no error to flag it. So after any
batch you're not fully confident about, it's worth a quick `ae_ping`: if it responds,
the bridge is fine and the batch likely no-op'd silently (re-verify the state you
expected and redo it in smaller pieces); if `ping` also hangs, that's the connection-
corrupting variant and only an After Effects restart will clear it.

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

**`ae_run_macro` is not immune to `ae_batch`'s silent-timeout problem — same discipline
applies.** A macro with 4+ `ops.*` calls in it can time out client-side at 60s while
actually succeeding on the AE side (confirmed via re-export after the timeout), and a
macro with ~9-11 calls plus heavy literal data (e.g. vertex arrays) can genuinely fail
outright. This was first suspected to be about which *effect* was targeted (repeated
`setEffectProperty` calls against one 4-Color Gradient instance were slow; single calls
against different Fill instances were fast) — checking Adobe's scripting docs turned up
nothing marking any specific effect as unusually expensive, and the pattern that actually
fits the observed timeouts is call-count-per-macro, not effect identity. Keep macro
scripts to a handful of `ops.*` calls, same rule of thumb as `ae_batch`'s 4-6 calls; if a
macro times out, check `ae_ping` and re-verify state before assuming it failed.

**Default to `AfterFX.exe -r "<script.jsx>"` for any new scene build, not just large ones.**
Write one comprehensive script that does as close to 100% of the work as possible —
background, every element, real assets (check what's available and ask the user for
anything missing rather than guessing), styling — and only fall back to the bridge
(`ae_*` tools) for the smaller adjustments an exported check reveals are needed. This
has been the reliable, low-timeout-risk approach on every build since adopting it; see
CLAUDE.md's Core Rules for the same guidance. The reasoning that originally motivated
it still applies too — it beats `ae_run_macro` entirely for complex builds and pins the
timeout problem on the bridge, not AE. Confirmed directly: a
94-layer build (10 cards, nested shape groups, path trims, keyframes, expressions) ran via
`-r` in 2-3 seconds on the same running AE instance where much smaller `ae_run_macro` calls
had just timed out or failed outright. When AE is already open, `-r` runs the script against
*that* instance and its current project — no second AE process, no file-lock conflict, no
60-second ceiling, no socket framing to corrupt. Write the script to a `.jsx` file and run
`"<path to AfterFX.exe>" -r "<path to script>"`. Three real caveats: it has no blocklist at
all (only run scripts you've read and trust — this bypasses every guard `ae_run_macro` has),
strip any `alert()`/`confirm()`/`prompt()` first (a modal blocks AE waiting for a click that
will never come from a CLI invocation), and don't guess at other flags — an unrecognized one
(e.g. a bare `-help`) gets misread as "import this as a file" against the running instance
and throws a visible error dialog in the user's AE window.

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
