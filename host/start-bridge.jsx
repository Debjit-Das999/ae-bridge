// start-bridge.jsx
//
// Run inside the already-open After Effects (AfterFX.exe -r start-bridge.jsx) to
// (re)start the bridge's polling: the host pauses polling when idle, and its delayed
// start timer has also been seen not to fire. Safe to run any time. The MCP server
// runs this automatically when it connects, or when AE stops answering.
//
// No dialogs, no file access beyond a small status note in the temp folder.

(function () {
    var note = null;
    try { note = new File(Folder.temp.fsName + "/claude-bridge-kick.txt"); note.open("w"); } catch (e) { note = null; }
    function say(s) { if (note) { try { note.writeln(s); } catch (e) {} } }
    try {
        say("time: " + new Date().toString());
        if (typeof $.global.__claudeBridge === "undefined" || !$.global.__claudeBridge) {
            say("bridge object not found - is claude-bridge.jsx installed in Scripts/Startup?");
        } else {
            if (typeof $.global.__claudeBridge.wake === "function") {
                // Current host: wake() replaces any old/dead poll task with a fresh one
                // registered from this context (such tasks always run). The host pauses
                // polling when idle, and the server calls this script to resume it.
                $.global.__claudeBridge.wake();
                say("wake() called");
            } else {
                // Older installed host (no wake()): start polling, then register a
                // fresh task ourselves, replacing our own previous one.
                $.global.__claudeBridge.bootstrap();
                say("bootstrap() called");
                if ($.global.__claudeKickPollId) { try { app.cancelTask($.global.__claudeKickPollId); } catch (e) {} }
                $.global.__claudeKickPollId = app.scheduleTask("$.global.__claudeBridge.poll()", 25, true);
                say("registered fresh poll task id=" + $.global.__claudeKickPollId);
            }
        }
    } catch (err) {
        say("ERR: " + err.toString());
    }
    if (note) { try { note.close(); } catch (e) {} }
})();
