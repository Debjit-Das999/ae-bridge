# ae-bridge

Fast MCP server for After Effects. Talks to a native ExtendScript socket listener
(`host/claude-bridge.jsx`) running inside AE — no CEP panel, no file polling.

## One-time setup

1. **Enable AE's network-scripting preference** (required, or the bridge's socket
   throws on start): Edit > Preferences > General/Scripting & Expressions >
   check "Allow Scripts to Write Files and Access Network".

2. **Install the bridge script** into AE's Startup folder. From an elevated
   (Administrator) PowerShell:
   ```powershell
   ./install.ps1
   ```
   This copies `host/claude-bridge.jsx` into the Scripts/Startup folder for
   AE 2025 and AE 2026 (whichever are present).

3. **Restart After Effects.** Confirm it loaded by checking
   `%TEMP%\claude-ae-bridge.log` for a line like
   `claude-bridge initialized (PORT=41890)`.

4. **Install server dependencies:**
   ```powershell
   cd server
   npm install
   ```

## Verify the transport before wiring up Claude

With After Effects running (and the bridge loaded per step 3):
```powershell
cd server
npm run test-bridge
```
This sends `ping` and `listCompositions` directly over the socket and prints
round-trip latency for each — confirms the bridge itself works, independent
of MCP or Claude.

## Register with Claude Code

`.mcp.json`, registering this server, lives **one level up** from this folder (in the
parent project directory, not inside `ae-bridge/` itself):
```json
{
  "mcpServers": {
    "ae-bridge": {
      "command": "node",
      "args": ["ae-bridge/server/src/index.js"]
    }
  }
}
```
Restart your Claude Code session in that parent project directory to pick it up.

## Sharing this with someone else / setting up on a new machine

**Send them**: the whole `ae-bridge/` folder, minus `server/node_modules/` (they'll
regenerate it with `npm install` — no need to zip ~100MB of dependencies). Everything
else — `host/`, `server/src/`, `install.ps1`, this README, `CLAUDE.md`, and
`.claude/skills/ae-scene-craft/` — should travel as-is.

**What they run**, in order:
1. Place the `ae-bridge` folder inside whatever directory they'll open Claude Code in
   (it can be the project root itself, or a subfolder of one).
2. Create a `.mcp.json` in that same parent directory (see the JSON block above) —
   Claude Code won't discover the server without it.
3. Follow "One-time setup" above (enable the AE preference, run `install.ps1` **as
   Administrator**, restart AE, `npm install` in `server/`).
4. Run `npm run test-bridge` to confirm the transport works before touching Claude.
5. Open/restart Claude Code in that parent directory — `CLAUDE.md` and the
   `ae-scene-craft` skill are picked up automatically the moment the session's working
   directory covers `ae-bridge/`, no extra step needed for either.

**Things that are specific to your machine and may need adjusting on theirs**:
- `install.ps1`'s `$targets` array hardcodes paths for AE 2025/2026 — if they're on a
  different version, they'll need to edit that array (or the script will just report
  "folder not found" and install nothing, which is a clear enough signal something
  needs adjusting).
- Port `41890` is assumed free. If something else on their machine is already using it,
  change `PORT` in both `host/claude-bridge.jsx` and `server/src/bridge-client.js`
  (same value in both).
- The bridge listens on all network interfaces, not just loopback — see the security
  note in `CLAUDE.md` before running this on a machine/network you don't fully trust.

## Tool surface

63 tools across: composition management (create/list/duplicate/settings/open),
layer creation (solid/text/null/camera/light/adjustment layer/precompose/shape
layer), layer organization (move/parent/timing/split/flags/rename/duplicate/
delete), transforms (static set/keyframe/remove keyframe/easing/expression/
time remapping/motion blur), effects (apply/remove/list/discover/presets/
reorder/enable-toggle), shapes (group/rect/ellipse/path/fill/stroke), masks
(add/list/set property), text animators (add animator/add animated property/
selector range), markers (add/bulk add/list/remove), project/asset management
(import/list items/folders/replace source), and utilities (current time/work
area/layer bounds/export frame/audio info/render).

Not yet built: true non-blocking render (not achievable — ExtendScript's
render queue is fully synchronous with no async form).

All ops have now been either live-tested or match an already-tested pattern
closely enough to trust, including the full shape/mask/text-animator batch
(rect/ellipse/path + fill/stroke, mask creation, and a per-character text
animator with a range selector all confirmed against a live AE instance,
visually verified via `ae_export_frame`). One real finding from that testing
pass: `ae_add_shape_primitive`'s `position` for rect/ellipse is an offset
from the shape layer's own Transform Position (which defaults to comp-center
for a new shape layer), not an absolute canvas coordinate — documented on
the tool's `position` parameter.

## Troubleshooting

- **Tool calls error "AE bridge not connected"** — After Effects isn't running,
  the script isn't in Scripts/Startup, or the network-scripting preference is
  off. Check `%TEMP%\claude-ae-bridge.log`.
- **`listen() threw` in the log** — almost always the network-scripting
  preference (step 1 above).
- **`listen() returned false`** — port 41890 is already in use (e.g. a second
  AE instance, or a previous run still bound). Quit the other instance or
  change `PORT` in both `host/claude-bridge.jsx` and
  `server/src/bridge-client.js`.
