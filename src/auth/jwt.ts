import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { AuthenticatedUser, UserRole, getUserPermissions, Permission } from './authorization.js';
import { logger } from '../helpers/logs.js';

const log = logger('authentication');

export interface JWTPayload {
  id: string;
  email: string;
  role: UserRole;
  permissions?: Permission[];
  iat?: number;
  exp?: number;
}

export class JWTService {
  private static readonly SECRET = process.env.JWT_SECRET;
  private static readonly ISSUER = process.env.JWT_ISSUER || 'mcp-server';
  private static readonly AUDIENCE = process.env.JWT_AUDIENCE || 'mcp-client';
  private static readonly TOKEN_EXPIRY = process.env.JWT_EXPIRY || '1h';
  
  static generateToken(user: { id: string; email: string; role: UserRole }): string {
    if (!this.SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    const payload: JWTPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: getUserPermissions(user.role),
    };

    return jwt.sign(payload, this.SECRET, { 
      expiresIn: this.TOKEN_EXPIRY,
      issuer: this.ISSUER,
      audience: this.AUDIENCE
    } as jwt.SignOptions);
  }

  static verifyToken(token: string): AuthenticatedUser {
    if (!this.SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    try {
        console.log(this.AUDIENCE, this.ISSUER);
      const payload = jwt.verify(token, this.SECRET, {
        issuer: this.ISSUER,
        audience: this.AUDIENCE
      }) as JWTPayload;


      return {
        id: payload.id,
        email: payload.email,
        role: payload.role,
        permissions: payload.permissions,
        iat: payload.iat,
        exp: payload.exp
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Token expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid token' + error.message);
      } else {
        throw new Error('Token verification failed');
      }
    }
  }
}

export function authenticateJWT(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    log.warn('Authentication failed: No token provided', { ip: req.ip });
    res.status(401).json({ 
      error: 'Authentication required',
      message: 'Bearer token must be provided in Authorization header'
    });
    return;
  }

  try {
    const user = JWTService.verifyToken(token);
    
    // Check if token is about to expire (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const timeToExpiry = (user.exp || 0) - now;
    
    if (timeToExpiry < 300) { // 5 minutes
      log.warn(`Token expiring soon for user ${user.id}`, { timeToExpiry });
    }

    (req as any).user = user;
    log.info(`User authenticated: ${user.id} (${user.role})`);
    next();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.warn('Authentication failed:', errorMessage, { ip: req.ip });
    res.status(403).json({ 
      error: 'Invalid token',
      message: errorMessage
    });
  }
}

// Optional: API Key authentication for service-to-service communication
export function authenticateAPIKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;
  const validAPIKeys = process.env.API_KEYS?.split(',') || [];

  if (!apiKey || !validAPIKeys.includes(apiKey)) {
    log.warn('API Key authentication failed', { ip: req.ip });
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  // For API key auth, create a service user
  (req as any).user = {
    id: 'service',
    email: 'service@internal',
    role: UserRole.ADMIN,
    permissions: getUserPermissions(UserRole.ADMIN)
  };

  log.info('Service authenticated via API key');
  next();
}

// Middleware to allow either JWT or API key authentication
export function authenticateAny(req: Request, res: Response, next: NextFunction): void {
  const hasJWT = req.headers.authorization?.startsWith('Bearer ');
  const hasAPIKey = req.headers['x-api-key'];

  if (hasJWT) {
    authenticateJWT(req, res, next);
  } else if (hasAPIKey) {
    authenticateAPIKey(req, res, next);
  } else {
    log.warn('No authentication method provided', { ip: req.ip });
    res.status(401).json({ 
      error: 'Authentication required',
      message: 'Provide either Bearer token or X-API-Key header'
    });
  }
}
