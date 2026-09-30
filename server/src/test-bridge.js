// Standalone transport test — talks to the AE bridge directly, no MCP involved.
// Run with: npm run test-bridge   (After Effects must be open with claude-bridge.jsx loaded)
import { BridgeClient } from "./bridge-client.js";

const bridge = new BridgeClient();

function timed(label, fn) {
  const start = Date.now();
  return fn().then((result) => {
    console.log(`${label}: ${Date.now() - start}ms`, JSON.stringify(result));
    return result;
  });
}

try {
  await timed("ping", () => bridge.call("ping"));
  await timed("listCompositions", () => bridge.call("listCompositions"));
  console.log("OK — bridge transport is working.");
  process.exit(0);
} catch (err) {
  console.error("FAILED:", err.message);
  process.exit(1);
}
