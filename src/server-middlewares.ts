import helmet from "helmet";
import timeout from "connect-timeout";
import cors from "cors";
import { body, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";
import express, { NextFunction, Request, Response } from "express";
import { logger } from "./helpers/logs.js";
import { authenticateJWT } from "./auth/jwt.js";
const log = logger("middleware");

// Enhanced request logging middleware for debugging
const requestLoggingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();
  
  // Log incoming request details
  log.info(`[${requestId}] === INCOMING REQUEST ===`);
  log.info(`[${requestId}] Method: ${req.method}`);
  log.info(`[${requestId}] URL: ${req.originalUrl}`);
  log.info(`[${requestId}] IP: ${req.ip}`);
  log.info(`[${requestId}] User-Agent: ${req.get('User-Agent') || 'N/A'}`);
  log.info(`[${requestId}] Content-Type: ${req.get('Content-Type') || 'N/A'}`);
  log.info(`[${requestId}] Content-Length: ${req.get('Content-Length') || 'N/A'}`);
  log.info(`[${requestId}] Authorization: ${req.get('Authorization') ? '[PRESENT]' : '[MISSING]'}`);
  
  // Log all headers (sanitized)
  const sanitizedHeaders = { ...req.headers };
  if (sanitizedHeaders.authorization) {
    sanitizedHeaders.authorization = '[REDACTED]';
  }
  log.info(`[${requestId}] Headers:`, sanitizedHeaders);
  
  // Log request body (if present and reasonable size)
  if (req.body && Object.keys(req.body).length > 0) {
    const bodySize = JSON.stringify(req.body).length;
    if (bodySize < 5000) {
      log.info(`[${requestId}] Body:`, req.body);
    } else {
      log.info(`[${requestId}] Body: [TOO LARGE - ${bodySize} bytes]`);
      // Log just the structure for large bodies
      if (typeof req.body === 'object') {
        const bodyStructure = Object.keys(req.body).reduce((acc, key) => {
          acc[key] = `[${typeof req.body[key]}]`;
          return acc;
        }, {} as any);
        log.info(`[${requestId}] Body structure:`, bodyStructure);
      }
    }
  } else {
    log.info(`[${requestId}] Body: [EMPTY]`);
  }
  
  // Store request ID for response logging
  (req as any).requestId = requestId;
  (req as any).startTime = startTime;
  
  // Intercept response
  const originalSend = res.send;
  const originalJson = res.json;
  
  res.send = function(this: Response, body: any) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    log.info(`[${requestId}] === OUTGOING RESPONSE ===`);
    log.info(`[${requestId}] Status: ${res.statusCode}`);
    log.info(`[${requestId}] Duration: ${duration}ms`);
    
    if (body && typeof body === 'string') {
      try {
        const parsedBody = JSON.parse(body);
        if (JSON.stringify(parsedBody).length < 2000) {
          log.info(`[${requestId}] Response body:`, parsedBody);
        } else {
          log.info(`[${requestId}] Response body: [TOO LARGE - ${body.length} bytes]`);
        }
      } catch {
        if (body.length < 500) {
          log.info(`[${requestId}] Response body (text): ${body}`);
        } else {
          log.info(`[${requestId}] Response body: [TOO LARGE - ${body.length} bytes]`);
        }
      }
    } else if (body && typeof body === 'object') {
      if (JSON.stringify(body).length < 2000) {
        log.info(`[${requestId}] Response body:`, body);
      } else {
        log.info(`[${requestId}] Response body: [TOO LARGE - ${JSON.stringify(body).length} bytes]`);
      }
    }
    
    log.info(`[${requestId}] === REQUEST COMPLETED ===`);
    return originalSend.call(this, body);
  };
  
  res.json = function(this: Response, body: any) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    log.info(`[${requestId}] === OUTGOING JSON RESPONSE ===`);
    log.info(`[${requestId}] Status: ${res.statusCode}`);
    log.info(`[${requestId}] Duration: ${duration}ms`);
    
    if (body && JSON.stringify(body).length < 2000) {
      log.info(`[${requestId}] Response JSON:`, body);
    } else {
      log.info(`[${requestId}] Response JSON: [TOO LARGE - ${JSON.stringify(body || {}).length} bytes]`);
    }
    
    log.info(`[${requestId}] === REQUEST COMPLETED ===`);
    return originalJson.call(this, body);
  };
  
  // Handle response errors
  res.on('error', (error) => {
    log.error(`[${requestId}] Response error:`, error);
  });
  
  next();
};

// Middleware to limite the number of requests from a single IP address
const rateLimiterMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests from this IP",
    retryAfter: 900, // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// CORS configuration
const corsMiddleware = cors({
  origin: process.env.ALLOWED_ORIGINS?.split(",") || ["https://localhost:3000"],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

// Helmet middleware for security
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
});

// Middleware to parse JSON bodies
const jsonMiddleware = express.json({
  limit: "10mb",
  verify: (req, res, buf) => {
    if (buf.length > 10 * 1024 * 1024) {
      throw new Error("Request body too large");
    }
  },
});

// Middleware to parse URL-encoded bodies
const urlencodedMiddleware = express.urlencoded({
  extended: true,
  limit: "10mb",
  parameterLimit: 1000,
});

// Middleware to handle request timeouts
const timeoutMiddleware = [timeout("30s"),
(req: Request, res: Response, next: NextFunction) => {
  if (!req.timedout) next();
}];

// Middleware to validate JSON-RPC requests (relaxed for MCP protocol)
const validationMiddleware = [
  // Only validate if the request contains JSON-RPC fields
  body("jsonrpc").optional().equals("2.0"),
  body("method").optional().isString().isLength({ min: 1, max: 100 }),
  body("params").optional().isObject(),
  body("id").optional(),
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    // Only fail validation if there are errors AND the request claims to be JSON-RPC
    if (!errors.isEmpty() && req.body.jsonrpc) {
      return res.status(400).json({
        error: "Validation failed",
        details: errors.array(),
      });
    }
    next();
  }];

export const securityMiddlewares = [
  requestLoggingMiddleware, // Add request logging first to capture everything
  authenticateJWT,
  corsMiddleware,
  rateLimiterMiddleware,
  helmetMiddleware,
  jsonMiddleware,
  urlencodedMiddleware,
  ...timeoutMiddleware,
  ...validationMiddleware,
];
