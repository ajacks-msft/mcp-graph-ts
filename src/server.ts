import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  JSONRPCError,
  JSONRPCNotification,
  ListToolsRequestSchema,
  LoggingMessageNotification,
  Notification,
} from '@modelcontextprotocol/sdk/types.js';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { logger } from './helpers/logs.js';
import { TodoTools } from './todoTools.js';
import { MicrosoftTools } from './microsoftTools.js';
import { AuthenticatedUser, hasPermission, Permission } from './auth/authorization.js';
import { MicrosoftAuthManager } from './auth/microsoft.js';

const log = logger('server');
const JSON_RPC = '2.0';
const JSON_RPC_ERROR = -32603;

export class StreamableHTTPServer {
  server: Server;
  private currentUser: AuthenticatedUser | null = null;

  constructor(server: Server) {
    this.server = server;
    this.setupServerRequestHandlers();
  }

  private getToolRequiredPermissions(toolName: string): Permission[] {
    const toolPermissions: Record<string, Permission[]> = {
      'add_todo': [Permission.CREATE_TODOS],
      'list_todos': [Permission.READ_TODOS],
      'complete_todo': [Permission.UPDATE_TODOS],
      'delete_todo': [Permission.DELETE_TODOS],
      'updateTodoText': [Permission.UPDATE_TODOS],
      'microsoft_graph': [Permission.MICROSOFT_GRAPH],
      'azure_resource': [Permission.AZURE_RESOURCE],
      'microsoft_auth_status': [Permission.MICROSOFT_AUTH]
    };
    
    return toolPermissions[toolName] || [];
  }

  async close() {
    log.info('Shutting down server...');
    await this.server.close();
    log.info('Server shutdown complete.');
  }

  async handleGetRequest(req: Request, res: Response) {
    const requestId = (req as any).requestId || 'unknown';
    const errorResponse = this.createRPCErrorResponse('Method not allowed.');
    log.info(`[${requestId}] GET request not allowed - responding with 405`);
    log.info(`[${requestId}] Error response:`, errorResponse);
    res.status(405).json(errorResponse);
    log.info(`[${requestId}] Responded to GET with 405 Method Not Allowed`);
  }

  async handlePostRequest(req: Request, res: Response) {
    const requestId = (req as any).requestId || 'unknown';
    log.info(`[${requestId}] POST ${req.originalUrl} (${req.ip}) - payload:`, req.body);
    
    // Extract user from request (set by authentication middleware)
    this.currentUser = (req as any).user as AuthenticatedUser;
    log.info(`[${requestId}] Authenticated user: ${this.currentUser?.id || 'none'} with role: ${this.currentUser?.role || 'none'}`);
    
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      log.info(`[${requestId}] Connecting transport to server...`);

      await this.server.connect(transport);
      log.success(`[${requestId}] Transport connected. Handling request...`);

      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        log.success(`[${requestId}] Request closed by client`);
        transport.close();
        this.server.close();
        this.currentUser = null; // Clear user after request
      });

      await this.sendMessages(transport);
      log.success(
        `[${requestId}] POST request handled successfully (status=${res.statusCode})`
      );
    } catch (error) {
      log.error(`[${requestId}] Error handling MCP request:`, error);
      
      // Log additional error details
      if (error instanceof Error) {
        log.error(`[${requestId}] Error name: ${error.name}`);
        log.error(`[${requestId}] Error message: ${error.message}`);
        log.error(`[${requestId}] Error stack:`, error.stack);
      }
      
      // Log request context for debugging
      log.error(`[${requestId}] Request context - URL: ${req.originalUrl}, Method: ${req.method}, Body size: ${JSON.stringify(req.body || {}).length}`);
      
      if (!res.headersSent) {
        const errorResponse = this.createRPCErrorResponse('Internal server error.');
        log.error(`[${requestId}] Sending error response:`, errorResponse);
        res
          .status(500)
          .json(errorResponse);
        log.error(`[${requestId}] Responded with 500 Internal Server Error`);
      } else {
        log.error(`[${requestId}] Cannot send error response - headers already sent`);
      }
    }
  }

  private setupServerRequestHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const user = this.currentUser;
      const requestId = Math.random().toString(36).substring(7);
      
      log.info(`[${requestId}] === LIST TOOLS REQUEST ===`);
      log.info(`[${requestId}] Tool list requested by user: ${user?.id || 'unknown'} with role: ${user?.role || 'none'}`);
      log.info(`[${requestId}] Request details:`, request);
      
      // Check if user has permission to list tools
      if (!user || !hasPermission(user, Permission.LIST_TOOLS)) {
        log.warn(`[${requestId}] User ${user?.id || 'unknown'} denied permission to list tools`);
        const errorResponse = this.createRPCErrorResponse('Insufficient permissions to list tools');
        log.warn(`[${requestId}] Returning permission error:`, errorResponse);
        return errorResponse;
      }

      // Get available tools based on authentication status
      const microsoftAuth = MicrosoftAuthManager.getInstance();
      log.info(`[${requestId}] Microsoft auth available: ${!!microsoftAuth}`);
      
      const allTools = [
        ...TodoTools,
        ...(microsoftAuth ? MicrosoftTools : [])
      ];
      
      log.info(`[${requestId}] Total tools before filtering: ${allTools.length} - ${allTools.map(t => t.name).join(', ')}`);

      // Filter tools based on user permissions
      const allowedTools = allTools.filter(tool => {
        const requiredPermissions = this.getToolRequiredPermissions(tool.name);
        const userHasPermission = requiredPermissions.some((permission: Permission) => 
          hasPermission(user, permission)
        );
        log.info(`[${requestId}] Tool ${tool.name} requires [${requiredPermissions.join(', ')}] - user has access: ${userHasPermission}`);
        return userHasPermission;
      });

      log.info(`[${requestId}] User ${user.id} listed ${allowedTools.length} available tools: ${allowedTools.map(t => t.name).join(', ')}`);
      
      const response = {
        jsonrpc: JSON_RPC,
        tools: allowedTools,
      };
      
      log.info(`[${requestId}] Returning tools response:`, response);
      return response;
    });

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const args = request.params.arguments;
        const toolName = request.params.name;
        const user = this.currentUser;
        const requestId = Math.random().toString(36).substring(7); // Generate ID for this tool call
        
        log.info(`[${requestId}] === TOOL EXECUTION REQUEST ===`);
        log.info(`[${requestId}] Tool name: ${toolName}`);
        log.info(`[${requestId}] Arguments:`, args);
        log.info(`[${requestId}] User: ${user?.id || 'unknown'} (${user?.role || 'none'})`);
        
        // Find tool from all available tools
        const microsoftAuth = MicrosoftAuthManager.getInstance();
        const allTools = [
          ...TodoTools,
          ...(microsoftAuth ? MicrosoftTools : [])
        ];
        const tool = allTools.find((tool) => tool.name === toolName);

        log.info(`[${requestId}] User ${user?.id || 'unknown'} attempting to call tool: ${toolName}`);
        log.info(`[${requestId}] Available tools: ${allTools.map(t => t.name).join(', ')}`);

        if (!user) {
          log.warn(`[${requestId}] Unauthenticated user attempted to call tool: ${toolName}`);
          const errorResponse = this.createRPCErrorResponse('Authentication required');
          log.warn(`[${requestId}] Returning authentication error:`, errorResponse);
          return errorResponse;
        }

        if (!tool) {
          log.error(`[${requestId}] Tool ${toolName} not found.`);
          log.error(`[${requestId}] Available tools were: ${allTools.map(t => t.name).join(', ')}`);
          const errorResponse = this.createRPCErrorResponse(`Tool ${toolName} not found.`);
          log.error(`[${requestId}] Returning tool not found error:`, errorResponse);
          return errorResponse;
        }

        // Check tool-specific permissions
        const requiredPermissions = this.getToolRequiredPermissions(toolName);
        const hasRequiredPermission = requiredPermissions.some((permission: Permission) => 
          hasPermission(user, permission)
        );

        log.info(`[${requestId}] Tool ${toolName} requires permissions: [${requiredPermissions.join(', ')}]`);
        log.info(`[${requestId}] User has required permission: ${hasRequiredPermission}`);

        if (!hasRequiredPermission) {
          log.warn(`[${requestId}] User ${user.id} denied permission to call tool: ${toolName}`);
          const errorResponse = this.createRPCErrorResponse(`Insufficient permissions to call tool: ${toolName}`);
          log.warn(`[${requestId}] Returning permission error:`, errorResponse);
          return errorResponse;
        }

        try {
          log.info(`[${requestId}] Executing tool ${toolName}...`);
          const result = await tool.execute(args as any);
          log.success(`[${requestId}] User ${user.id} successfully executed tool ${toolName}. Result:`, result);
          
          const response = {
            jsonrpc: JSON_RPC,
            content: [
              {
                type: 'text',
                text: `Tool ${toolName} executed with arguments ${JSON.stringify(
                  args
                )}. Result: ${JSON.stringify(result)}`,
              },
            ],
          };
          
          log.info(`[${requestId}] Returning successful response:`, response);
          return response;
        } catch (error) {
          log.error(`[${requestId}] Error executing tool ${toolName} for user ${user.id}:`, error);
          
          // Log additional error details
          if (error instanceof Error) {
            log.error(`[${requestId}] Tool execution error name: ${error.name}`);
            log.error(`[${requestId}] Tool execution error message: ${error.message}`);
            log.error(`[${requestId}] Tool execution error stack:`, error.stack);
          }
          
          const errorResponse = this.createRPCErrorResponse(
            `Error executing tool ${toolName}: ${error}`
          );
          log.error(`[${requestId}] Returning tool execution error:`, errorResponse);
          return errorResponse;
        }
      }
    );
  }

  private async sendMessages(transport: StreamableHTTPServerTransport) {
    const message: LoggingMessageNotification = {
      method: 'notifications/message',
      params: { level: 'info', data: 'Connection established' },
    };
    log.info('Sending connection established notification.');
    this.sendNotification(transport, message);
  }

  private async sendNotification(
    transport: StreamableHTTPServerTransport,
    notification: Notification
  ) {
    const rpcNotificaiton: JSONRPCNotification = {
      ...notification,
      jsonrpc: JSON_RPC,
    };
    log.info(`Sending notification: ${notification.method}`);
    await transport.send(rpcNotificaiton);
  }

  private createRPCErrorResponse(message: string): JSONRPCError {
    return {
      jsonrpc: JSON_RPC,
      error: {
        code: JSON_RPC_ERROR,
        message: message,
      },
      id: randomUUID(),
    };
  }
}