# ae-bridge — usage rules

MCP server for After Effects (`ae_*` tools). This file exists because several
real bugs and wasted debugging cycles happened during development from
guessing instead of checking, and from index/state assumptions that didn't
hold. Read this before making non-trivial use of the `ae_*` tools.

**This repo is Windows-only.** The macOS port is a separate fork
(`github.com/Debjit-Das999/ae-bridge-mac`, developed in its own chat/folder).
Don't edit, commit to, or push the Mac repo from work on this one, and keep
Windows-specific details (`install.ps1`, `AfterFX.exe -r`, `%TEMP%`) here.
Fixes that apply to both (e.g. transport/host-script bugs) must be ported by hand.

## Quick checklist (the mistakes that have cost the most time — details below)

**Connecting**
- Only one Claude session holds AE. A call that says this session "was
  disconnected because another session took over" → call `ae_connect`, retry
  once (see rule 7). `ae_ping` should answer in milliseconds; it times out at 5s.
- User says "pause" / "ae pause" / "stop the bridge" → call `ae_pause` (stops AE polling at once, stays
  connected; the next AE call restarts it automatically — that wake can bring the AE window to the front).
- The host polls continuously and **never pauses on its own** (AE can then show the
  modal-dialog error / flicker the tool cursor). It stops only on `ae_pause` and the
  server wakes it automatically on connect/next call (+~0.2–0.4s). To quiet AE and
  release it: `ae_pause` first, then `ae_disconnect` (disconnect alone leaves it
  polling; a session that is not connected cannot pause it). A ping/call timeout on a live connection
  also auto-runs `host/start-bridge.jsx`; don't re-diagnose that, just retry. Never cancel scheduled-task ids you
  didn't create (other panels share the id space).

**Before you build**
- Test in a throwaway comp you create, and **resolve the comp by name inside
  every macro** (`for` over `app.project.item(i)` matching `CompItem` + name).
  Creating ANY project item (solid, null, comp, folder, footage) shifts comp
  indices — that once sent a stress test into the user's real comp.
- Don't touch the user's existing comps/layers beyond what was asked, and
  never save the project (`app.project.save` is blocked and not yours to do).
- Check fonts exist (`app.fonts.allFonts`) and effect matchNames
  (`ae_list_available_effects`) before using them; verify numeric ranges
  before `setValue` (rule 8).

**While building**
- Build in logical steps and check each with `ae_export_frame` (argument is
  `timeInSeconds`). A clean `ok:true` is not proof; read back or render.
- A failed/partial macro may have already created things. After any error or
  timeout, list what exists *before* re-running (blind re-runs duplicate
  layers). Only read-only calls are safe to retry blindly.
- Name everything you create with a clear prefix, and keep one build =
  one script/macro sequence you can re-run cleanly: remove your previous
  attempt (by name/tag, never by index) before rebuilding, so failed attempts
  don't leave duplicate comps/footage behind.
- Look-and-feel recipes (shape group order, opacity vs parenting, glow
  clipping, gradients, text fitting) are in the `ae-scene-craft` skill.

**Limits that are verified (so don't invent smaller ones)**
- 100-call `ae_batch`, 1,600-op macros (~16s), multi-KB requests and 4MB
  responses all work. Timeouts: macro 60s, other calls 15s, ping 5s. AE can't
  interrupt a running macro, so keep any single call well under 60s.
- Transient AE error `invalid numeric result (divide by zero?)`: re-run
  read-only calls once; for mutating macros check state first.

## Core rules

1. **Never trust an index across calls.** Re-list (`ae_list_compositions`,
   `ae_list_layers`, `ae_list_effects`, `ae_list_masks`) before addressing
   something by index if anything might have changed — including after any
   op that adds/removes/reorders items, and after AE was restarted.
2. **Never run mutating calls in parallel if one could shift state another
   depends on.** Two real bugs happened this way: `ae_create_folder` run
   alongside comp-indexed calls (new project items insert at index 1,
   shifting every composition index down by one), and `ae_move_layer` run
   alongside `ae_set_layer_flags` targeting the same layer index (the flags
   landed on the wrong layer). When call B needs call A's result to be
   correct, run them sequentially.
3. **Prefer matchName over display name** wherever both exist (effects,
   blend modes, mask modes, track matte types). Some real values are
   unintuitive — e.g. `BlendingMode.SILHOUETE_ALPHA` is a documented AE
   typo, not a mistake to "fix".
4. **Check https://ae-scripting.docsforadobe.dev before guessing a new
   operation** on an object/method not already covered below. Fetch and
   quote the primary page directly when precision matters — summarized web
   search results have been outright wrong before (claimed AE has no font
   enumeration API; it does, `app.fonts.allFonts`).
5. **AE reverts to last-saved project state on restart.** Anything built in
   a session but not saved is gone. Don't assume state persists across an
   AE restart unless the user confirms they saved.
6. **Verify visually with `ae_export_frame` rather than trusting "no
   error".** Several real bugs (Round Corners, the easing dimension bug)
   returned success with no exception while doing nothing or the wrong
   thing. A clean response is not proof of a correct visual result.
7. **Route every request: bridge (MCP) by default, JSX for big builds — and
   don't make the user manage it.** Two ways to act on AE: the `ae_*` bridge
   tools, and a `.jsx` script run via `AfterFX.exe -r` (see Recipes). Pick
   like this:
   - **Small task → bridge, no questions.** Tweaks to an existing scene,
     adding/editing a few layers, effects, keyframes, renames, exports —
     roughly under ~30 layers / ~100 ops. Just do it with `ae_*` tools
     (macros/batches are fine for repetitive bits).
   - **Large new structure → ask ONCE, up front, before building.** A new
     multi-layer scene/comp or anything with many repeated elements
     (roughly 30+ layers or 100+ ops). Ask a single short question:
     "JSX script (one shot, fastest) or bridge steps (live, incremental)?"
     and give a recommendation (JSX for big/pattern-heavy builds, bridge
     when they want to watch and tweak as it goes). Then proceed.
   - **Remember the answer for the session. Don't re-ask** for later large
     builds unless the user changes it or the job is very different. If the
     user says "always JSX" / "always bridge" / "just pick", treat that as
     standing for the session.
   - **Bridge not running → use JSX automatically, no question.** If
     `ae_ping` errors / says not connected, or a bridge call fails twice
     after one retry, switch to the JSX route and say so in one line. If AE
     itself isn't running, tell the user and offer to launch it (don't
     launch silently).
   - **"Disconnected because another session took over" → `ae_connect`.**
     Only one Claude session can hold the bridge. If a tool fails with that
     message (or says this session released AE), the user is asking for AE
     work *here*, so call `ae_connect` (it disconnects the other session),
     retry once, and say so in one line. Don't loop: if it gets displaced
     again right away, stop and tell the user another session is actively
     using AE.
   - **JSX route rules:** write one comprehensive script (background, every
     element, real assets, styling), checking available project files/icons
     first and asking only for what's genuinely missing rather than
     guessing. Follow rule 8 (`setPropSafe`), the `try/catch/finally`+log
     gotcha, tag anything created, never hardcode project/comp indices, no
     modal calls. Verify visually: via `ae_export_frame` if the bridge is
     up, otherwise have the script save a frame and read the PNG.
   - After a JSX build, use the bridge for small follow-up adjustments
     when it's available.
   Why: the bridge is fast, live and incremental for small work; JSX avoids
   per-call round trips and the 60s ceiling on very large builds. (The old
   guidance "JSX-first for everything" predates the transport fixes — the
   bridge is now reliable for sizeable macros/batches, see gotchas.)
8. **Never write a literal numeric value into an effect property without
   verifying its actual valid range first — don't assume it matches the
   0-100 or 0-1 convention of some other property you're used to.** A real
   crash happened from exactly this: Bevel's Light Intensity is a 0-1
   float, written as `40` on the (wrong) assumption it was a percentage
   like many other properties — AE halted the script with a modal "Value
   40 out of range 0 to 1" dialog partway through a build, which (in a
   `-r` script) blocks the AE UI waiting for a human to click OK, silently
   swallowing everything queued after it. AE exposes the real range on the
   property itself — `hasMin`/`hasMax` (booleans) and `minValue`/`maxValue`
   (throw if the corresponding `hasMin`/`hasMax` is false) — so there's
   never a need to guess. `ae_set_effect_property` (and `ops.setEffectProperty`
   inside `ae_run_macro`) now check this automatically for plain numbers and
   throw a clear, catchable error instead of letting AE hit it at runtime —
   but that guard doesn't reach a `-r` script, since those run raw
   ExtendScript with no bridge in front of them. Use this helper at the top
   of every `.jsx` build script instead of calling `.setValue()` directly:
   ```js
   function setPropSafe(prop, value) {
     if (typeof value === "number") {
       if (prop.hasMin && value < prop.minValue) {
         throw new Error(prop.name + ": " + value + " is below its minimum (" + prop.minValue + ")");
       }
       if (prop.hasMax && value > prop.maxValue) {
         throw new Error(prop.name + ": " + value + " is above its maximum (" + prop.maxValue + ")");
       }
     }
     prop.setValue(value);
   }
   ```

## Known gotchas (confirmed — do not re-diagnose these)

- **ROOT CAUSES FOUND (2026-10-07) for most of the "timeout" mysteries below.**
  Two real transport bugs, both fixed in `host/claude-bridge.jsx` (re-run
  `install.ps1` + restart AE to get the fix; `bridge-client.js` change needs
  a Claude session restart):
  1. *Fragmented requests.* The host read with `readln()` on a 50ms-timeout
     socket, so any request that arrived in several pieces (a 4KB macro
     arrived as 5) was parsed as 5 broken "messages" — log showed
     `handleLine error for id=null: JSON.parse` — the macro never ran and the
     client waited out its timeout. Fix: buffered `read()` that only parses
     once a newline arrives. This is what "long payload hang" and the
     `Expected: ]` SyntaxError were.
  2. *Empty arrays in a response.* AE's native `JSON.stringify` writes `[]` as
     `"[\n\n]"` (raw newlines). The wire protocol is one message per line, so
     the response was split, Node silently dropped the unparseable pieces, and
     the call "timed out" **even though the work had succeeded**. Any response
     containing an empty list (no effects, no layers, no matches, empty
     `results`) did this — including the `ae_list_layers`-on-empty-comp hang
     below. Fix: strip raw CR/LF from the serialized response. Diagnose with:
     a call that times out while the log shows no error and the change DID
     apply.
  Also fixed: responses are written with a 10s timeout (was 50ms), and
  `bridge-client.js` now logs unparseable lines to stderr instead of
  swallowing them. The batch-size / macro-size limits quoted below were
  measured BEFORE these fixes; re-measure before trusting them.
  **Verified after the fixes:** 4KB macro; 256KB response (intact); 8 short
  `ae_set_effect_property` calls in one `ae_batch`; 11-call `ae_batch` with
  ~3KB of text; 8 concurrent macros (all answered, in order); empty-array
  responses; `ae_list_layers` on an empty comp; macros that throw / have
  syntax errors (instant clean error). 800 macro ops (200 layers) ran in ~8s.
  Also verified: 100-call `ae_batch` (all ok); 15 simultaneous mixed calls;
  1MB and 4MB responses (intact); 2000-op macro in 0.4s; 1600 ops/400 layers
  in 16s (cost ~linear); 30s macro OK, 62s macro times out client-side and the
  bridge recovers cleanly; connection fine after 2.5min idle; unicode/CRLF/
  U+2028 round-trip. Not tested: requests >64KB (tested to ~9KB), batches
  >100 calls. No remaining transport failures reproduced.
- **Copying/rebuilding comps by script — three AE 26.5 facts found by a chat
  that rebuilt one comp from another (diff result: 0 differences across ~9,800
  properties once these were handled).** (1) `Property.canSetValue` can't be
  relied on in this AE — a guard like `if (!p.canSetValue) continue` silently
  skipped every static value (positions, text, colors) so only keyframes and
  expressions got copied; just try `setValue` in a try/catch. (2) `layer.nullLayer`
  is read-only: create nulls with `addNull`, don't flip a flag on a normal layer.
  (3) Text-animator properties start hidden and must be `addProperty`'d before
  they can be set. Also note each rebuild attempt leaves its footage items
  behind (~99 per run here; the project went 152 -> 201 items), so clean up
  failed attempts by name/tag as described under "Solids and nulls".
- **Transient `invalid numeric result (divide by zero?)` from AE (2026-10-08).**
  Evidence: 4 occurrences in ~a day (Oct 7 14:07; Oct 8 12:02, 12:11:00,
  12:11:32), clustered in time, on read-heavy macros (iterating comps,
  reading effect/Position/keyframe values) — and **every time the identical
  script succeeded when simply re-run**. Not tied to request size (362–4956
  chars), not to client swaps/reconnects (no host-log events nearby), and not
  to any unreadable property: a read-only walk of all 19,702 property values
  in the two comps involved had 0 failures. Trigger unknown (clustering
  suggests AE's momentary state). Handling: `bridge-client.js` appends a
  "known transient, re-run" hint to this error. **Retry once immediately for
  read-only work. For a macro that modifies the project, first check what it
  already applied (`ae_list_layers`, etc.) — it can fail partway and a blind
  re-run would duplicate layers/effects.** Don't auto-retry macros for the
  same reason.
- **Macro/batch ops address comps by index — and creating ANY project item
  (solid, comp, folder, footage) mid-script shifts those indices.** In a
  stress test, `ops.createSolid({compIndex: N})` followed by more ops with the
  same `compIndex` silently landed on a *different* comp (the user's real
  one). Inside a macro, either avoid item-creating ops or re-resolve the comp
  index by name after each one; never hardcode an index across a
  `createSolid`/`createComposition`/`createFolder`/`importFootage`.
- **`ae_list_layers` hangs (times out) on a truly empty composition (0
  layers)** — confirmed reproducible on two separate freshly-created comps,
  while it works instantly on any comp with 1+ layers. **Root cause is the
  empty-array JSON bug above** (response `{layers: []}` was split on raw
  newlines and dropped) — fixed in the host script. Old workaround: don't call `ae_list_layers` on a comp you know is
  still empty — add at least one layer first (you already know it's empty
  if you just created it, so there's nothing to list anyway).
- **`ae_batch` has TWO separate, confirmed failure modes, and the safe size
  is smaller than it looks.**
  1. *Long-payload hang*: an 11-call batch with several text layers' worth
     of content (font/color/position strings) produced `SyntaxError:
     Expected: ]` on the AE side — the line was likely split across
     multiple socket reads, breaking the newline-delimited framing. This
     one corrupts the connection; an AE restart was required to recover
     (a plain reconnect was not sufficient).
  2. *Silent short-batch failure*: separately, an 8-call batch of short
     `ae_set_effect_property` calls (no long strings, just numbers/short
     arrays) timed out too — but the bridge itself stayed completely
     healthy afterward (ping and other calls worked immediately), and the
     properties were simply never set (effect sat at its default values,
     no error surfaced). Splitting the same 8 calls into two 4-call
     batches worked immediately with no other change. So this isn't purely
     about total string length — something about the *number* of calls
     in one request line matters too, and 8 short calls already crossed
     whatever the real limit is.

  **SUPERSEDED (2026-10-07): both modes were the transport bugs described in
  the ROOT CAUSES entry above and are fixed.** The "4-6 calls per batch" rule
  no longer applies — a 100-call batch and an 11-call batch with ~3KB of text
  both succeed. What still holds: if a batch/macro times out, `ae_ping`, then
  *verify state* before redoing it (it may have partly applied).
- **`ae_run_macro` has the SAME silent-timeout failure mode as `ae_batch`'s
  #2 above, not just `ae_batch`.** Observed rebuilding the same diagram via
  macros: a 4-`setEffectProperty`-call macro (setting a 4-Color Gradient's
  point/color properties) timed out at the client's 60s limit twice in a
  row, but both times the bridge stayed healthy and the calls had actually
  succeeded server-side (confirmed via `ae_export_frame` after each). An
  11-call macro and a 9-call macro (heavy with literal vertex-array data)
  both genuinely failed outright (0 layers created, matching failure mode
  #1's total-loss pattern) until split smaller. By contrast, single-call
  macros (one `setEffectProperty` per icon, one `getLayerBounds` +
  reposition per label) were consistently fast with zero timeouts across
  ~10 of them. **This was initially suspected to be effect-specific (4-Color
  Gradient vs. Fill) — it isn't.** Checked Adobe's own scripting docs for
  anything marking 4-Color Gradient as unusually expensive to script:
  nothing found. The variable that actually lines up with every timeout in
  this session's log is calls-per-macro (4, 9, 11 all timed out or failed;
  1-3 never did), same as `ae_batch`'s documented limit.
  **SUPERSEDED (2026-10-07):** that was the transport bugs, now fixed. Macros
  of 1,600 ops (~16s) and 2,000 cheap ops (~0.4s) run fine; the "handful of
  ops" rule is obsolete. The real limits: client timeout 60s per macro (15s
  other calls, 5s ping), and AE cannot interrupt a macro once it is running.
- **The `ae_run_macro`/`ae_batch` timeouts are a property of the bridge's
  socket transport itself, not of AE or of script size/complexity** —
  confirmed by directly comparing against `AfterFX.exe -r` (see the Recipes
  entry below). A 94-layer build (10 cards, each with nested shape groups,
  path trims, keyframes, and expressions — far larger than any macro that
  had timed out or failed via the bridge) ran via `-r` in about 2-3 seconds
  with zero issues, immediately after several much smaller `ae_run_macro`
  calls had timed out or failed outright on the exact same running AE
  instance and project. This rules out "the script is too heavy" or "AE
  itself is slow" as the cause. **Root-caused 2026-10-07:** it was the
  socket framing (fragmented requests + empty-array responses), now fixed —
  see the ROOT CAUSES entry at the top of this section. After the fixes the
  bridge handles big macros fine (1,600 ops in ~16s). `-r` still has no
  60-second ceiling and no socket layer, so it remains the better route for
  very large one-shot builds — but routing is governed by rule 7 (bridge by
  default, ask once for big builds, JSX automatically if the bridge is down).
- **`layer.parent = x` silently compensates rotation (and position) to
  preserve the layer's CURRENT on-screen appearance at the moment of
  parenting** — confirmed twice now (once for position on a duplicated
  layer, once for rotation on freshly-built children). If a script sets
  `.parent` before the layer's own Position/Rotation have been set to their
  final intended (parent-relative) values, AE adjusts them to cancel out
  whatever the parent's transform already is, so the child keeps looking
  exactly as it did pre-parent — e.g. parenting a fresh, unrotated icon to a
  card background already rotated -4° left the icon at local rotation +4°
  (an exact compensating offset), so it rendered upright instead of tilting
  with the card. Fix: always set `.parent` FIRST, then explicitly set
  Position AND Rotation (even to 0 — don't rely on "0 is the default" or
  skip a falsy-looking `if (rotation) ...` guard, since that skips the
  explicit reset and leaves whatever compensation AE already applied).
- **`ae_export_frame`'s time argument is `timeInSeconds`, not `time`.**
  Passing `time` is silently accepted (extra keys aren't rejected) and the
  call falls back to its default — the comp's current time — with no error
  at all. This went unnoticed for a long stretch of work because every
  earlier export happened to want frame 0 anyway; it only surfaced once an
  animation needed frames at specific non-zero times and every export kept
  returning the same (wrong) frame. If a series of exports across different
  times look suspiciously identical, check the actual argument name before
  assuming the composition is broken.
- **A bridge call can report a clean, fast `ok:true` — no timeout, no
  error — while the mutation it made silently didn't stick.** Confirmed
  once: a `runMacro` resize+reposition call on one card layer returned
  success immediately, but a later unrelated check showed the layer still
  at its old size/position; re-running the identical script the second time
  worked and a fresh read-back confirmed it. This is a third failure mode
  distinct from the two already documented above (long-payload hang, and
  timeout-but-actually-succeeded) — this one gives no signal at all that
  anything went wrong. It's rare enough that treating every `ok:true` as
  suspect would be impractical, but for anything hard to visually spot in a
  quick export (exact numeric properties, things off-screen or behind other
  layers), a cheap follow-up read-back in a *separate* call is worth it
  before moving on — verifying inside the same call that made the change
  doesn't catch this, since that part did run correctly.
- **Only one MCP client can hold the bridge at a time — two Claude sessions
  with `ae-bridge` enabled knock each other off.** The host script tracks a
  single client and replaces it whenever a new connection arrives (`New
  client arrived while old one still marked connected=true — replacing it`
  in `%TEMP%\claude-ae-bridge.log`). With two sessions each running their own
  `ae-bridge` MCP server, both keep reconnecting and every longer call fails
  with `AE bridge disconnected`, while a bare `ae_ping` can still slip
  through — which makes it look like random flakiness rather than a
  conflict. Diagnose: that log line repeating about once a second, and
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` showing two
  `ae-bridge/server/src/index.js` processes with different parent
  `claude.exe` PIDs. Fix: have the user close the other session (or disable
  its `ae-bridge` server); don't kill another session's process yourself.
  **Recurring: the delayed polling start sometimes never fires after an AE
  launch (seen 3 times on 2026-10-07/08).** Symptom: log shows `claude-bridge
  initialized ... polling starts in 12000ms` but no `polling started` line;
  TCP connects succeed (the listener is open) but every call times out, in
  every session, with no dialog open in AE. Cause unknown (the start timer is
  registered during the Startup-script phase). Manual fix that always works:
  `AfterFX.exe -r host/start-bridge.jsx`. **Second failure mode found the
  same day:** `polling started` was logged but the repeating poll task
  registered at launch was dead (connections sat un-accepted for 12 minutes);
  `bootstrap()` alone can't fix that because it no-ops once polling is
  *marked* started. A poll task registered from the `-r` context always runs
  (verified), so `start-bridge.jsx` now registers a fresh one every time
  (`poll()` is overlap-guarded, so a duplicate is harmless). AE itself ran
  scheduled tasks fine throughout, with no dialog open — it is specific to the
  launch-registered tasks.
  Automatic recovery now built in (it runs `start-bridge.jsx` itself, at most
  once per 60s, only while connected so it can never launch AE): a **ping**
  that is unanswered after 1.5s triggers it (ping times out at 5s, not 15s);
  a connection that has never heard from AE triggers it at 4s; after 20s of
  silence a real call is preceded by a quick ping probe so the host is
  revived *before* the call is sent; and any call timeout also triggers it.
  (First version only had the 4s/timeout triggers, so a chat that had heard
  from AE earlier saw its first ping fail after the full 15s.) **Never cancel scheduled
  task ids you didn't create** (other panels' timers share the id space). The host also registers backup start timers (45s,
  120s) and logs the timer ids — **those need `install.ps1` + AE restart**; the
  auto-kick only needs the session restarted. If it still happens, the logged
  task ids are the next clue.
  **Fixed (2026-10-08): connection ownership is now explicit.** Sessions no
  longer connect at launch (`index.js` used to call `bridge.start()`, so every
  new session stole AE). A session connects lazily on its first tool call, or
  explicitly with `ae_connect`. When a new client connects, the host sends the
  old one `{"event":"evicted"}` before closing it; the old session then stays
  disconnected (no auto-reconnect) and its calls fail with a message pointing
  to `ae_connect`. `ae_disconnect` releases AE; `ae_status` reports local
  state. **Requires re-running `install.ps1` as Administrator + restarting AE
  (host change) and restarting every Claude session (server change)** — a
  session still on the old server will keep reconnecting and fighting.
  Since 2026-10-07 each MCP server also stops reconnecting once AE is closed:
  after 4 failed connects (~8s) it goes dormant (logs one line to stderr) and
  the next tool call wakes it. That removes idle-session churn while AE is
  down, but sessions still contend while AE is *running* (tested against a
  fake server via `AE_BRIDGE_PORT`, a test-only port override).
- **Fixed (2026-10-08): poll task only runs while the bridge is in use.** The
  always-on 25ms poll task caused two user-visible problems: (1) opening any
  property dialog (Fill/colour picker, Map Black To…) popped "Unable to execute
  script at line 0… Cannot run a script while a modal dialog is waiting for
  response" — AE blocks every task firing during a modal, and "line 0" is the
  poll task itself, so the error can't be caught in our script; (2) tool
  cursors (pen/shape) flickered between the tool and the arrow, even after
  `ae_disconnect`, because each task run makes AE re-evaluate the cursor.
  Now the host cancels the poll task only when told to (`ae_pause`) and sends
  `{"event":"sleep"}`. **It never pauses on its own** (idle timers were tried at
  5s/15s/60s and removed: the server can't see when a Claude turn ends, only calls,
  and gaps between a working Claude's calls exceed those, so it kept pausing and
  waking mid-task, and every wake can bring the AE window to the front). So the
  flicker/modal error persist, including after `ae_disconnect`, unless a connected
  session pauses first. The
  server wakes it by running `start-bridge.jsx` (→ `wake()`, which registers a
  fresh task from the `-r` context) on every connect, and before a call when it
  knows the host is asleep (min 3s between runs). `ae_pause` pauses on demand (host op `pause`; needs the new host installed).
  Cost: the first call after a
  quiet spell waits for the `-r` spawn (measured live: 0.2–0.4s; awake calls take a few ms). Residual: opening a dialog *while Claude is
  actively calling* can still show the error box — click OK, or tell Claude to
  pause. **Needs `install.ps1` + AE restart (host) and session restart (server).**
  A not-yet-updated host still works with the new server (start-bridge.jsx
  falls back to the old logic); an old server against the new host recovers
  through its ping kick.
- **`-r` build scripts must not let an error escape to AE.** An uncaught
  error becomes a modal dialog that freezes AE (and the bridge's poll) until
  someone clicks it. Wrap the whole script in `try/catch/finally` that writes
  to a log file, removes the comp the script itself created on failure, and
  always calls `app.endUndoGroup()`; then read the log file instead of
  watching for a dialog. (Confirmed: a failing build logged its error, cleaned
  up its partial comp, and AE never blocked.)
- **Solids and nulls a script creates outlive their comp.** `comp.remove()`
  leaves the solid/null footage items behind in the project's `Solids`
  folder. When working in someone else's project, tag what you create
  (`layer.source.comment = TAG` right after `addSolid`/`addNull`) and on
  rebuild remove only tagged footage with `usedIn.length === 0` — never guess
  by name alone. Also delete throwaway test comps' solids when you delete the
  comp itself.
- **`TextDocument.tracking` must be an integer** — computing it to fit a
  target width and passing the float throws `"<n> is not an integer"`;
  `Math.round` it. Also: a text layer's `sourceRectAtTime` returns tight glyph
  bounds (top ≈ -cap height for all-caps), and point text's origin is its
  first baseline, so setting `Position.y` to a baseline and aligning by
  `rect.left` / `rect.width` places text on its ink edges exactly.
- **To see every installed font's PostScript name, dump
  `app.fonts.allFonts` from a `-r` script to a file** and grep it;
  `ae_list_available_fonts` is fine for a narrow query, but broad ones
  (`semi`, `condensed`) return hundreds of entries. Not every popular font is
  present (Barlow Semi Condensed wasn't; only Barlow Condensed) — measure
  candidates' widths at matched cap height before committing.
- **Shape primitive `position`** (`ae_add_shape_primitive`, rect/ellipse) is
  an OFFSET from the shape layer's own Transform Position (which defaults
  to comp-center for a new layer) — not an absolute canvas coordinate.
- **`ae_reorder_effect`** (and any `PropertyBase.moveTo()`-based reorder)
  invalidates the moved property's own reference. Capture what you need
  (e.g. its name) before calling `.moveTo()`; never read from the same
  reference afterward.
- **`ae_set_keyframe_easing`**'s temporal ease array needs exactly 1 entry
  unless the property's dimensions are separated — for a multi-axis
  property like Position. **This does NOT hold for every multi-axis
  property** — confirmed via `setTemporalEaseAtKey` directly (not through
  the tool) that Scale throws `"Value array does not have 3 elements"`
  unless you pass one `KeyframeEase` per dimension (3 entries, e.g.
  `[ease,ease,ease]`), even with all 3 dimensions still linked/unseparated.
  Don't assume the 1-entry rule generalizes — if a property throws this
  error, try one ease per dimension before anything else.
- **Project item indices shift when ANY item elsewhere in the project is
  added or removed — including unrelated compositions, not just items in
  the same folder.** Confirmed concretely: icon footage indices inside a
  shared "all icons" folder (established once and reused across several
  builds) silently shifted by +1 after deleting unrelated leftover comps
  from earlier work, with nothing about the folder or its contents touched
  directly. A script that hardcodes a footage item's index from earlier in
  the session — even a value that was definitely correct when first
  checked — can silently point at the wrong asset later. Re-verify an
  item's index immediately before use if anything else in the project has
  changed since, the same discipline as rule #1 above, and don't assume
  "I only touched comps, not this folder" is enough to skip the check.
- **Round Corners** (`ae_add_shape_path_operation` with matchName
  `'ADBE Vector Filter - RC'`) adds correctly and sets Radius correctly but
  has NO visible effect on either a Rectangle primitive or a custom path —
  root cause unknown. For a Rectangle, set `roundness` directly via
  `ae_add_shape_primitive` instead. Trim Paths, by contrast, is confirmed
  working correctly.
- **`ae_render_composition`** without `outputModuleTemplate` silently
  overrides your requested file extension with AE's default output format
  (commonly MP4/H.264) — confirmed empirically (`.avi` and `.png` both
  actually saved as `.mp4`, since AVI/QuickTime templates were removed from
  AE around v22). Always check the response's `actualOutputPath` and
  `succeeded` fields; never assume `outputPath` was honored as given.
- **`ae_apply_effect_preset`**: Adobe Express presets are parametric
  templates, not simple keyframe animations — they may need external
  driving (Essential Properties) to visibly animate. A clean response
  doesn't guarantee a visible effect for those specifically.

## Recipes

- **Shape**: `ae_create_shape_layer` → `ae_add_shape_group` →
  `ae_add_shape_primitive` → `ae_add_shape_fill` / `ae_add_shape_stroke`.
- **Kinetic type**: `ae_add_text_animator` → `ae_add_animator_property` →
  `ae_set_animator_selector_range`.
- **Mask**: `ae_add_mask` with `vertices`/`inTangents`/`outTangents`/`closed`.
- **Multi-step build**: use `ae_batch` (same tool names, `{tool, args}`
  pairs, one undo group, a failed item doesn't block later ones) instead of
  many separate round trips.
- **Bulk structured construction (many similar elements — e.g. 8 shapes with
  the same pattern)**: use `ae_run_macro` instead of `ae_batch`. It runs a
  JS snippet that calls `ops.*` (internal names — same conversion as
  `ae_batch`: strip `ae_`, camelCase, e.g. `ae_add_shape_group` →
  `ops.addShapeGroup`) in a loop, all in ONE round trip and ONE undo group —
  no per-element network hop, which is where `ae_batch` still pays a cost
  even at a safe batch size. It's a blocklist (rejects `File`/`Folder`/
  `system.`/`ExternalObject`/`Socket`/`$.`/`eval`/`ScriptUI`/`app.quit`/
  `app.project.save`), not a sandbox — it catches accidental misuse, not a
  determined bypass. Only use it against a bridge whose network exposure
  you trust (see Security note below).
- **Large/complex one-off build, or diagnosing whether the bridge itself is
  the problem**: write the script to a `.jsx` file and run it via
  `AfterFX.exe -r "<path>"` instead of `ae_run_macro`:
  ```
  "C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\AfterFX.exe" -r "C:\path\to\script.jsx"
  ```
  Confirmed (via direct test — a probe script and a 94-layer real build)
  that when AE is already running, `-r` executes the script **against that
  already-open instance and its current project**, not a separate process —
  no file-lock conflict, no second AE window. No 60-second timeout, no JSON/
  socket layer to break. Three things to know before using it:
  1. **No blocklist at all** — unlike `ae_run_macro`, a script run this way
     has full ExtendScript privileges (file/system/network/eval/ScriptUI,
     everything). Only run scripts you've fully read and trust; there's no
     automatic safety net here the way there is over the socket.
  2. **Strip any modal call first** (`alert()`, `confirm()`, `prompt()`).
     AE blocks synchronously waiting for a human to click it, and nobody's
     watching a CLI invocation — this hangs AE with no timeout and no way
     to recover except manually clicking the dialog in the AE window.
  3. **Don't pass anything other than a real `-r`/`-s`/documented flag** when
     AE is already running. An unrecognized argument (tested with a bare
     `-help`) isn't treated as a CLI flag against the running instance —
     AE tries to **import it as a file** and throws a visible "Can't import
     file" error dialog in the user's open AE window. Verify a flag's exact
     syntax before invoking rather than guessing at one.
- Not yet built: shape/mask path editing after creation (no "set existing
  shape/mask property by index" op), full waveform/beat analysis,
  non-blocking render (not achievable — ExtendScript's render queue has no
  async form).

## One-time machine setup

1. AE Preferences → General/Scripting & Expressions → enable "Allow Scripts
   to Write Files and Access Network" (required or the bridge's socket
   throws on start).
2. `./install.ps1` from this directory, as Administrator.
3. Restart After Effects. Confirm via `%TEMP%\claude-ae-bridge.log`.
4. `cd server && npm install`.
5. Restart the Claude Code session to load `.mcp.json`.

Any time `host/claude-bridge.jsx` changes: re-run `install.ps1` and restart
AE. Any time `server/src/*.js` changes: restart the Claude Code session.

## Security note

The bridge listens on `0.0.0.0` (all network interfaces), not just
loopback — confirmed via `netstat`. On an untrusted network this is
reachable by other devices, with no authentication. See README for detail;
this was a deliberate accepted-risk decision on a trusted home network, not
an oversight to silently "fix".

The `AfterFX.exe -r` path (see Recipes) is a stronger trust boundary than
either `ae_batch` or `ae_run_macro` — it's local-machine-only (not reachable
over the network the way the socket is), but it has zero blocklist: any
script run this way has full ExtendScript privileges, no restrictions at
all. Treat it accordingly — only for scripts read and trusted first.
