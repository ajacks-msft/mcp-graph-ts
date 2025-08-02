import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import express, { Request, Response } from "express";
import { StreamableHTTPServer } from "./server.js";
import { logger } from "./helpers/logs.js";
import { securityMiddlewares } from "./server-middlewares.js";
import { MicrosoftAuthManager } from "./auth/microsoft.js";
const log = logger("index");

// Log environment configuration for debugging
log.info("=== ENVIRONMENT CONFIGURATION ===");
log.info(`NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
log.info(`PORT: ${process.env.PORT || 'undefined'}`);
log.info(`DEBUG: ${process.env.DEBUG || 'undefined'}`);
log.info(`ALLOWED_ORIGINS: ${process.env.ALLOWED_ORIGINS || 'undefined'}`);
log.info(`JWT_SECRET available: ${!!process.env.JWT_SECRET}`);
log.info(`MICROSOFT_CLIENT_ID available: ${!!process.env.MICROSOFT_CLIENT_ID}`);
log.info(`MICROSOFT_CLIENT_SECRET available: ${!!process.env.MICROSOFT_CLIENT_SECRET}`);
log.info(`MICROSOFT_TENANT_ID available: ${!!process.env.MICROSOFT_TENANT_ID}`);
log.info("=====================================");

// Initialize Microsoft authentication (optional)
try {
  const microsoftAuth = await MicrosoftAuthManager.initialize();
  if (microsoftAuth) {
    log.success("Microsoft authentication initialized successfully");
  } else {
    log.info("Microsoft authentication not configured - Microsoft tools will be unavailable");
  }
} catch (error) {
  log.warn("Failed to initialize Microsoft authentication:", error);
}

// Import tools to log available tools
import { TodoTools } from "./todoTools.js";
import { MicrosoftTools } from "./microsoftTools.js";

// Log available tools
const microsoftAuth = MicrosoftAuthManager.getInstance();
const allTools = [
  ...TodoTools,
  ...(microsoftAuth ? MicrosoftTools : [])
];

log.info(`Available tools: ${allTools.map(t => t.name).join(', ')}`);
log.info(`Total tools registered: ${allTools.length}`);
if (microsoftAuth) {
  log.info(`Microsoft tools available: ${MicrosoftTools.map(t => t.name).join(', ')}`);
} else {
  log.warn("Microsoft tools not available - authentication not configured");
}

const server = new StreamableHTTPServer(
  new Server(
    {
      name: "todo-http-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )
);

const MCP_ENDPOINT = "/mcp";
const app = express();
const router = express.Router();
app.use(MCP_ENDPOINT, securityMiddlewares);

router.post(MCP_ENDPOINT, async (req: Request, res: Response) => {
  await server.handlePostRequest(req, res);
});

router.get(MCP_ENDPOINT, async (req: Request, res: Response) => {
  await server.handleGetRequest(req, res);
});

app.use("/", router);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log.success(`MCP Stateless Streamable HTTP Server`);
  log.success(`MCP endpoint: http://localhost:${PORT}${MCP_ENDPOINT}`);
  log.success(`Press Ctrl+C to stop the server`);
});

process.on("SIGINT", async () => {
  log.error("Shutting down server...");
  await server.close();
  process.exit(0);
});
