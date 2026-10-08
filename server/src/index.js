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

// Deliberately do NOT connect at startup. Only one Claude session can hold the
// AE bridge, and connecting evicts the current holder, so a session connects
// lazily on its first tool call (or explicitly via ae_connect) instead of
// stealing AE the moment it is opened.
