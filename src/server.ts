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
    res.status(405).json(this.createRPCErrorResponse('Method not allowed.'));
    log.info('Responded to GET with 405 Method Not Allowed');
  }

  async handlePostRequest(req: Request, res: Response) {
    log.info(`POST ${req.originalUrl} (${req.ip}) - payload:`, req.body);
    
    // Extract user from request (set by authentication middleware)
    this.currentUser = (req as any).user as AuthenticatedUser;
    
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      log.info('Connecting transport to server...');

      await this.server.connect(transport);
      log.success('Transport connected. Handling request...');

      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        log.success('Request closed by client');
        transport.close();
        this.server.close();
        this.currentUser = null; // Clear user after request
      });

      await this.sendMessages(transport);
      log.success(
        `POST request handled successfully (status=${res.statusCode})`
      );
    } catch (error) {
      log.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res
          .status(500)
          .json(this.createRPCErrorResponse('Internal server error.'));
        log.error('Responded with 500 Internal Server Error');
      }
    }
  }

  private setupServerRequestHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const user = this.currentUser;
      
      log.info(`Tool list requested by user: ${user?.id || 'unknown'} with role: ${user?.role || 'none'}`);
      
      // Check if user has permission to list tools
      if (!user || !hasPermission(user, Permission.LIST_TOOLS)) {
        log.warn(`User ${user?.id || 'unknown'} denied permission to list tools`);
        return this.createRPCErrorResponse('Insufficient permissions to list tools');
      }

      // Get available tools based on authentication status
      const microsoftAuth = MicrosoftAuthManager.getInstance();
      log.info(`Microsoft auth available: ${!!microsoftAuth}`);
      
      const allTools = [
        ...TodoTools,
        ...(microsoftAuth ? MicrosoftTools : [])
      ];
      
      log.info(`Total tools before filtering: ${allTools.length} - ${allTools.map(t => t.name).join(', ')}`);

      // Filter tools based on user permissions
      const allowedTools = allTools.filter(tool => {
        const requiredPermissions = this.getToolRequiredPermissions(tool.name);
        const userHasPermission = requiredPermissions.some((permission: Permission) => 
          hasPermission(user, permission)
        );
        log.info(`Tool ${tool.name} requires [${requiredPermissions.join(', ')}] - user has access: ${userHasPermission}`);
        return userHasPermission;
      });

      log.info(`User ${user.id} listed ${allowedTools.length} available tools`);
      return {
        jsonrpc: JSON_RPC,
        tools: allowedTools,
      };
    });

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const args = request.params.arguments;
        const toolName = request.params.name;
        const user = this.currentUser;
        
        // Find tool from all available tools
        const microsoftAuth = MicrosoftAuthManager.getInstance();
        const allTools = [
          ...TodoTools,
          ...(microsoftAuth ? MicrosoftTools : [])
        ];
        const tool = allTools.find((tool) => tool.name === toolName);

        log.info(`User ${user?.id || 'unknown'} attempting to call tool: ${toolName}`);

        if (!user) {
          log.warn(`Unauthenticated user attempted to call tool: ${toolName}`);
          return this.createRPCErrorResponse('Authentication required');
        }

        if (!tool) {
          log.error(`Tool ${toolName} not found.`);
          return this.createRPCErrorResponse(`Tool ${toolName} not found.`);
        }

        // Check tool-specific permissions
        const requiredPermissions = this.getToolRequiredPermissions(toolName);
        const hasRequiredPermission = requiredPermissions.some((permission: Permission) => 
          hasPermission(user, permission)
        );

        if (!hasRequiredPermission) {
          log.warn(`User ${user.id} denied permission to call tool: ${toolName}`);
          return this.createRPCErrorResponse(`Insufficient permissions to call tool: ${toolName}`);
        }

        try {
          const result = await tool.execute(args as any);
          log.success(`User ${user.id} successfully executed tool ${toolName}. Result:`, result);
          return {
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
        } catch (error) {
          log.error(`Error executing tool ${toolName} for user ${user.id}:`, error);
          return this.createRPCErrorResponse(
            `Error executing tool ${toolName}: ${error}`
          );
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