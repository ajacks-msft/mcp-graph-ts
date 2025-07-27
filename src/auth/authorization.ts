import { Request, Response, NextFunction } from 'express';
import { logger } from '../helpers/logs.js';

const log = logger('authorization');

// Define roles and permissions
export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  READONLY = 'readonly'
}

export enum Permission {
  READ_TODOS = 'read:todos',
  CREATE_TODOS = 'create:todos',
  UPDATE_TODOS = 'update:todos',
  DELETE_TODOS = 'delete:todos',
  LIST_TOOLS = 'list:tools',
  CALL_TOOLS = 'call:tools'
}

// Role-permission mapping
const rolePermissions: Record<UserRole, Permission[]> = {
  [UserRole.ADMIN]: [
    Permission.READ_TODOS,
    Permission.CREATE_TODOS,
    Permission.UPDATE_TODOS,
    Permission.DELETE_TODOS,
    Permission.LIST_TOOLS,
    Permission.CALL_TOOLS
  ],
  [UserRole.USER]: [
    Permission.READ_TODOS,
    Permission.CREATE_TODOS,
    Permission.UPDATE_TODOS,
    Permission.LIST_TOOLS,
    Permission.CALL_TOOLS
  ],
  [UserRole.READONLY]: [
    Permission.READ_TODOS,
    Permission.LIST_TOOLS
  ]
};

// Tool-permission mapping
const toolPermissions: Record<string, Permission[]> = {
  'add_todo': [Permission.CREATE_TODOS],
  'list_todos': [Permission.READ_TODOS],
  'complete_todo': [Permission.UPDATE_TODOS],
  'delete_todo': [Permission.DELETE_TODOS],
  'updateTodoText': [Permission.UPDATE_TODOS]
};

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  permissions?: Permission[];
  iat?: number;
  exp?: number;
}

export function getUserPermissions(role: UserRole): Permission[] {
  return rolePermissions[role] || [];
}

export function hasPermission(user: AuthenticatedUser, permission: Permission): boolean {
  const userPermissions = user.permissions || getUserPermissions(user.role);
  return userPermissions.includes(permission);
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as AuthenticatedUser;
    
    if (!user) {
      log.warn('Authorization check failed: No user in request');
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!hasPermission(user, permission)) {
      log.warn(`Authorization failed: User ${user.id} lacks permission ${permission}`);
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: permission,
        userRole: user.role
      });
    }

    log.info(`Authorization granted: User ${user.id} has permission ${permission}`);
    next();
  };
}

export function requireRole(role: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as AuthenticatedUser;
    
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (user.role !== role) {
      log.warn(`Role check failed: User ${user.id} has role ${user.role}, required ${role}`);
      return res.status(403).json({ 
        error: 'Insufficient role',
        required: role,
        userRole: user.role
      });
    }

    next();
  };
}

// Middleware to check tool-specific permissions
export function requireToolPermission(toolName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as AuthenticatedUser;
    const requiredPermissions = toolPermissions[toolName];
    
    if (!requiredPermissions) {
      log.warn(`Unknown tool: ${toolName}`);
      return res.status(400).json({ error: 'Unknown tool' });
    }

    const hasRequiredPermission = requiredPermissions.some(permission => 
      hasPermission(user, permission)
    );

    if (!hasRequiredPermission) {
      log.warn(`Tool access denied: User ${user.id} lacks permissions for tool ${toolName}`);
      return res.status(403).json({ 
        error: 'Insufficient permissions for this tool',
        tool: toolName,
        required: requiredPermissions,
        userRole: user.role
      });
    }

    next();
  };
}
