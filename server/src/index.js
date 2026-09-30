#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeClient } from "./bridge-client.js";
import { registerTools } from "./tools.js";

const bridge = new BridgeClient();
const server = new McpServer({ name: "ae-bridge", version: "0.1.0" });

registerTools(server, bridge);

const transport = new StdioServerTransport();
await server.connect(transport);

// Don't block startup on AE being open yet; the bridge connects/reconnects
// in the background, so tools just surface a clear error until AE is up.
bridge.start();
