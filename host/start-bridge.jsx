// start-bridge.jsx
//
// Run inside the already-open After Effects (AfterFX.exe -r start-bridge.jsx) to
// start the bridge's polling if its delayed start timer never fired. Safe to run
// any time: bootstrap() does nothing if polling is already running. The MCP
// server runs this automatically when it connects but AE never answers.
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
            $.global.__claudeBridge.bootstrap();
            say("bootstrap() called");
            // bootstrap() does nothing once polling is *marked* started, but the poll
            // task registered at launch has been seen dead. A task registered from
            // this context always runs, so register a fresh one (replacing our own
            // previous one). poll() guards against overlap, so a duplicate is harmless.
            if ($.global.__claudeKickPollId) { try { app.cancelTask($.global.__claudeKickPollId); } catch (e) {} }
            $.global.__claudeKickPollId = app.scheduleTask("$.global.__claudeBridge.poll()", 25, true);
            say("registered fresh poll task id=" + $.global.__claudeKickPollId);
        }
    } catch (err) {
        say("ERR: " + err.toString());
    }
    if (note) { try { note.close(); } catch (e) {} }
})();
