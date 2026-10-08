import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// If we are connected but After Effects never answers (its delayed polling start
// has been seen not to fire after some launches), run host/start-bridge.jsx
// inside the open AE once to start it. Windows-only; AE_BRIDGE_AE_EXE and
// AE_BRIDGE_KICK_SCRIPT exist so tests can substitute a stub.
const KICK_AFTER_MS = 4000;
const KICK_COOLDOWN_MS = 60000;
// Minimum gap between two runs of start-bridge.jsx (waking the host / kicking it).
const WAKE_MIN_GAP_MS = 3000;
const HERE = path.dirname(fileURLToPath(import.meta.url));

const HOST = "127.0.0.1";
// AE_BRIDGE_PORT only exists so tests can point at a fake server; the host script
// (claude-bridge.jsx) always listens on 41890.
const PORT = Number(process.env.AE_BRIDGE_PORT) || 41890;
const CALL_TIMEOUT_MS = 15000;
// A ping should answer in milliseconds, so don't make anyone wait 15s for one: give up
// after 5s, and after 1.5s of silence start the bridge via start-bridge.jsx.
const PING_TIMEOUT_MS = 5000;
const PING_KICK_AFTER_MS = 1500;
// If AE has been silent this long, send a quick ping before a real call so a dead
// poll task is revived first instead of the real call timing out.
const IDLE_PROBE_MS = 20000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;
// After this many failed connection attempts in a row (AE closed / not running)
// stop retrying and go dormant; the next tool call wakes the client up again.
// 4 attempts ~= 0.5 + 1 + 2 + 4s of retrying.
const MAX_FAILED_CONNECTS = 4;

// Temporary diagnostic verbosity — prints to stderr so it doesn't pollute
// MCP stdio. Set to true to debug connection issues.
const DEBUG = false;
function dbg(...args) {
  if (DEBUG) console.error("[bridge-client]", new Date().toISOString(), ...args);
}

export class BridgeClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.buffer = "";
    this.pending = new Map();
    this.reconnectDelay = RECONNECT_BASE_MS;
    this.started = false;
    this.failedConnects = 0;
    this.dormant = false;
    // Non-null when this session was displaced by another Claude session, or
    // released AE itself. While set we never reconnect on our own and tool
    // calls fail with this reason until connect() is called.
    this.suspendedReason = null;
    this.hostHeard = false; // has AE sent us anything on the current connection?
    this.lastHeard = 0; // when AE last sent us anything (or when we connected)
    this.kickTimer = null;
    this.lastKick = 0;
    this.lastSpawn = 0;
    this.hostAsleep = false; // AE told us it paused polling because we were idle
  }

  _findAeExe() {
    if (process.env.AE_BRIDGE_AE_EXE) return process.env.AE_BRIDGE_AE_EXE;
    if (process.platform !== "win32") return null;
    const base = "C:\\Program Files\\Adobe";
    try {
      const dirs = fs.readdirSync(base).filter((n) => n.startsWith("Adobe After Effects")).sort().reverse();
      for (const d of dirs) {
        const exe = path.join(base, d, "Support Files", "AfterFX.exe");
        if (fs.existsSync(exe)) return exe;
      }
    } catch { /* fall through */ }
    return null;
  }

  _armKick() {
    if (this.kickTimer || this.hostHeard) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      if (this.connected && !this.hostHeard) this._kickHost();
    }, KICK_AFTER_MS);
  }

  // The host pauses its poll task when idle (so AE isn't interrupted while nobody is
  // using the bridge); resume it. Needs a live connection: that proves AE is running,
  // so `-r` runs the script inside it instead of launching a new AE.
  _wakeHost() {
    if (!this.connected) return;
    const now = Date.now();
    if (now - this.lastSpawn < WAKE_MIN_GAP_MS) return;
    this._runStartScript("waking the host");
  }

  _kickHost() {
    if (!this.connected) return;
    const now = Date.now();
    if (now - this.lastKick < KICK_COOLDOWN_MS || now - this.lastSpawn < WAKE_MIN_GAP_MS) return;
    this.lastKick = now;
    console.error("[ae-bridge] connected but After Effects is not answering - starting the bridge via start-bridge.jsx");
    this._runStartScript("kicking the host");
  }

  _runStartScript(why) {
    this.lastSpawn = Date.now();
    const exe = this._findAeExe();
    const script = process.env.AE_BRIDGE_KICK_SCRIPT || path.resolve(HERE, "..", "..", "host", "start-bridge.jsx");
    if (!exe || !fs.existsSync(script)) {
      console.error("[ae-bridge] cannot run host/start-bridge.jsx in After Effects (AfterFX.exe or the script " +
        "was not found); if AE is not answering, run host/start-bridge.jsx inside AE manually.");
      return;
    }
    dbg(why + " via start-bridge.jsx");
    try {
      spawn(exe, ["-r", script], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } catch (e) {
      console.error("[ae-bridge] could not run start-bridge.jsx: " + e.message);
    }
  }

  _suspend(reason) {
    this.suspendedReason = reason;
    console.error("[ae-bridge] " + reason);
    this._rejectAllPending(new Error(reason));
    if (this.socket) this.socket.destroy();
  }

  // Explicit take-over: connect this session. If another session holds AE the
  // host displaces it (and tells it so), so only one session is ever connected.
  async connect() {
    this.suspendedReason = null;
    this.started = true;
    if (this.connected) return { connected: true, note: "This session already holds the After Effects connection." };
    this.dormant = false;
    this.failedConnects = 0;
    this.reconnectDelay = RECONNECT_BASE_MS;
    this._attemptConnect();
    try {
      await this._waitForConnection(5000);
    } catch {
      throw new Error("Could not reach After Effects on port " + PORT +
        " - is AE running with claude-bridge.jsx loaded?");
    }
    const ping = await this.call("ping");
    return { connected: true, note: "Connected. Any other Claude session was disconnected.", ping };
  }

  // Release AE so another session can take it; this session stays disconnected
  // until connect() is called again.
  disconnect() {
    const had = this.connected;
    this._suspend("This session released its After Effects connection.");
    return { disconnected: true, wasConnected: had };
  }

  // Stop AE's poll task right now (no cursor flicker / modal-dialog errors while the
  // user works in AE). It restarts by itself on the next call. Stays connected.
  async pause() {
    if (this.suspendedReason) return { paused: false, note: this.suspendedReason };
    if (!this.connected) return { paused: true, note: "Not connected; this session is not polling After Effects." };
    if (this.hostAsleep) return { paused: true, note: "Already paused." };
    try {
      await this.call("pause");
    } catch (e) {
      if (/Unknown op 'pause'/.test(e.message)) {
        throw new Error("The installed After Effects host script is too old to pause. Re-run install.ps1 as " +
          "Administrator and restart AE.");
      }
      throw e;
    }
    return { paused: true, note: "Polling paused. It restarts automatically on the next After Effects call." };
  }

  status() {
    return {
      connected: this.connected,
      dormant: this.dormant,
      suspended: this.suspendedReason,
      port: PORT,
    };
  }

  // Resume connecting after going dormant (called when a tool call arrives).
  _wake() {
    this.dormant = false;
    this.failedConnects = 0;
    this.reconnectDelay = RECONNECT_BASE_MS;
    this._attemptConnect();
  }

  // Kicks off a persistent background connect/reconnect loop. Safe to call
  // more than once. Does NOT wait for a connection — call() fails fast
  // instead if one isn't up yet, rather than hanging.
  start() {
    if (this.started) return;
    this.started = true;
    this._attemptConnect();
  }

  _attemptConnect() {
    if (this.connecting || this.connected) return;
    this.connecting = true;
    dbg("connecting to", HOST + ":" + PORT, "local port will be assigned by OS");
    const socket = net.createConnection({ host: HOST, port: PORT }, () => {
      this.connected = true;
      this.connecting = false;
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.failedConnects = 0;
      this.dormant = false;
      this.hostHeard = false;
      this.hostAsleep = false;
      this.lastHeard = Date.now();
      dbg("connected, localPort=", socket.localPort);
      // The host may have paused polling while idle; make sure it is running.
      this._wakeHost();
    });
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      dbg("raw data received (" + chunk.length + " chars):", JSON.stringify(chunk));
      this._onData(chunk);
    });
    socket.on("error", (err) => {
      dbg("socket error:", err.message);
      // "close" fires right after and does the actual bookkeeping/retry.
    });
    socket.on("close", (hadError) => {
      dbg("socket closed, hadError=", hadError, "wasConnected=", this.connected);
      const wasConnected = this.connected;
      this.connected = false;
      this.connecting = false;
      this.socket = null;
      this.buffer = "";
      if (this.kickTimer) { clearTimeout(this.kickTimer); this.kickTimer = null; }
      if (this.suspendedReason) {
        // Displaced by another session (or released): stay down, never reconnect.
        this.failedConnects = 0;
        return;
      }
      if (wasConnected) {
        this._rejectAllPending(new Error("AE bridge disconnected"));
        this.failedConnects = 0; // a drop after a good connection restarts the count
      } else {
        this.failedConnects++;
      }
      if (this.failedConnects >= MAX_FAILED_CONNECTS) {
        // AE is closed/unreachable: stop spinning. call() wakes us on next use.
        this.dormant = true;
        console.error("[ae-bridge] After Effects not reachable on port " + PORT +
          " - pausing reconnect attempts until the next tool call.");
        return;
      }
      const delay = this.reconnectDelay;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      setTimeout(() => this._attemptConnect(), delay);
    });
    this.socket = socket;
  }

  _onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        // Always surface this (stderr, so MCP stdio stays clean): a dropped
        // response otherwise shows up only as a 60s timeout.
        console.error("[ae-bridge] unparseable line from AE (" + line.length + " chars): " + line.slice(0, 120));
        continue;
      }
      this.hostHeard = true;
      this.lastHeard = Date.now();
      if (this.kickTimer) { clearTimeout(this.kickTimer); this.kickTimer = null; }
      if (msg.event === "evicted") {
        this._suspend("This Claude session was disconnected from After Effects because another session took over.");
        return;
      }
      if (msg.event === "sleep") {
        // AE paused polling (we were idle). A request already in flight is sitting unread: wake it now.
        this.hostAsleep = true;
        if (this.pending.size) this._wakeHost();
        continue;
      }
      this.hostAsleep = false;
      const p = this.pending.get(msg.id);
      if (!p) {
        dbg("received response for unknown/unmatched id:", msg.id, "pending ids:", [...this.pending.keys()]);
        continue;
      }
      dbg("matched response for id=" + msg.id, "ok=" + msg.ok);
      clearTimeout(p.timer);
      clearTimeout(p.kickTimer);
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(this._explainError(msg.error?.message || "Unknown AE bridge error")));
    }
  }

  // AE occasionally throws "invalid numeric result (divide by zero?)" for a call that
  // works when re-run unchanged (seen ~4 times/day, in clusters, on read-heavy macros;
  // not tied to the script or request size). Say so, so callers retry instead of debugging.
  _explainError(message) {
    if (/invalid numeric result/i.test(message)) {
      return message + " [Known transient AE error: re-running the same call usually succeeds. If this was a " +
        "macro that changes the project, first check what it already applied (e.g. ae_list_layers) before re-running.]";
    }
    return message;
  }

  _rejectAllPending(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      clearTimeout(p.kickTimer);
      p.reject(err);
    }
    this.pending.clear();
  }

  // Bounded wait for an in-flight connection attempt to land, so the very
  // first call after startup doesn't fail just because connect() hadn't
  // finished yet. Polls the flag rather than tracking one socket's events,
  // since the underlying socket gets replaced across reconnects.
  _waitForConnection(timeoutMs) {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const check = () => {
        if (this.connected) return resolve();
        if (Date.now() >= deadline) return reject(new Error("timed out waiting to connect"));
        setTimeout(check, 50);
      };
      check();
    });
  }

  async call(op, args, opts = {}) {
    if (this.suspendedReason) {
      throw new Error(this.suspendedReason + " Call ae_connect to take After Effects back " +
        "(this disconnects the other session).");
    }
    this.start();
    if (!this.connected && this.dormant) this._wake();
    if (!this.connected) {
      await this._waitForConnection(3000).catch(() => {});
    }
    if (!this.connected || !this.socket) {
      throw new Error(
        "AE bridge not connected — make sure After Effects is running with claude-bridge.jsx loaded " +
        "(check %TEMP%\\claude-ae-bridge.log for its startup log)."
      );
    }
    if (this.hostAsleep) this._wakeHost();
    // After a quiet spell, check AE is answering before sending the real call, so a dead
    // poll task is revived by the probe's recovery instead of the real call timing out.
    if (op !== "ping" && Date.now() - this.lastHeard > IDLE_PROBE_MS) {
      await this.call("ping", {}).catch(() => {});
      if (!this.connected || !this.socket) {
        throw new Error(
          "AE bridge not connected — make sure After Effects is running with claude-bridge.jsx loaded " +
          "(check %TEMP%\\claude-ae-bridge.log for its startup log)."
        );
      }
    }
    const timeoutMs = opts.timeoutMs || (op === "ping" ? PING_TIMEOUT_MS : CALL_TIMEOUT_MS);
    const id = randomUUID();
    const payload = JSON.stringify({ id, op, args: args || {} }) + "\n";
    return new Promise((resolve, reject) => {
      // A ping that hasn't been answered in 1.5s means the host isn't polling: revive it now.
      const kickTimer = op === "ping"
        ? setTimeout(() => { if (this.pending.has(id) && this.connected) this._kickHost(); }, PING_KICK_AFTER_MS)
        : null;
      const timer = setTimeout(() => {
        clearTimeout(kickTimer);
        this.pending.delete(id);
        dbg("TIMEOUT for id=" + id, "op=" + op, "still-pending=", [...this.pending.keys()]);
        // A timeout on a live connection can mean the host's poll task died mid-session.
        this._kickHost();
        reject(new Error(`Timed out waiting for AE to respond to '${op}' after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, kickTimer });
      dbg("writing request id=" + id, "op=" + op, "bytes=" + payload.length);
      this.socket.write(payload, (err) => {
        if (err) dbg("write callback error for id=" + id + ":", err.message);
        else dbg("write callback OK (flushed to OS) for id=" + id);
      });
      this._armKick();
    });
  }
}
