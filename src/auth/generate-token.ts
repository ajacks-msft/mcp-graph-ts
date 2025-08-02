console.warn("WARNING: This file is for demonstration purposes only.");
console.warn("WARNING: It generates a JWT token and writes it to a .env file.");
console.warn(
  "WARNING: In a real application, you should securely manage your secrets and tokens."
);
console.warn(
  "WARNING: Do not use this in production without proper security measures."
);

import { writeFileSync, readFileSync, existsSync } from "fs";
import { randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { UserRole } from "./authorization.js";

// Read existing .env file if it exists to preserve Microsoft Graph credentials
let existingEnvContent = "";
if (existsSync(".env")) {
  existingEnvContent = readFileSync(".env", "utf-8");
}

// Extract existing Microsoft Graph credentials if they exist
const extractEnvVar = (content: string, varName: string): string | null => {
  const match = content.match(new RegExp(`^${varName}=["']?([^"'\\n\\r]+)["']?`, "m"));
  return match ? match[1] : null;
};

const existingTenantId = extractEnvVar(existingEnvContent, "TENANT_ID");
const existingClientId = extractEnvVar(existingEnvContent, "CLIENT_ID");
const existingClientSecret = extractEnvVar(existingEnvContent, "CLIENT_SECRET");

// Use existing JWT_SECRET if available, otherwise generate new one
const existingJwtSecret = extractEnvVar(existingEnvContent, "JWT_SECRET");
const JWT_SECRET = existingJwtSecret || randomBytes(32).toString('base64');

// Set 30-day expiration
const JWT_EXPIRY = "30d";
const JWT_AUDIENCE = "mcp-client";
const JWT_ISSUER = "mcp-server";
const PAYLOAD = {
  id: "demo-user",
  email: "demo@example.com",
  role: UserRole.USER
};

const token = jwt.sign(PAYLOAD, JWT_SECRET, {
  algorithm: "HS256",
  expiresIn: JWT_EXPIRY,
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
});

// Build .env content preserving Microsoft Graph credentials
let envContent = "";

// Add Microsoft Graph credentials if they exist
if (existingTenantId && existingClientId && existingClientSecret) {
  envContent += `TENANT_ID="${existingTenantId}"\n`;
  envContent += `CLIENT_ID="${existingClientId}"\n`;
  envContent += `CLIENT_SECRET="${existingClientSecret}"\n\n`;
}

// Add JWT configuration
envContent += `JWT_AUDIENCE="${JWT_AUDIENCE}"\n`;
envContent += `JWT_ISSUER="${JWT_ISSUER}"\n`;
envContent += `JWT_EXPIRY="${JWT_EXPIRY}"\n`;
envContent += `JWT_SECRET="${JWT_SECRET}"\n`;
envContent += `JWT_TOKEN="${token}"\n`;

// Write the complete .env file (overwrite to avoid duplicates)
writeFileSync(".env", envContent);

console.log("✅ 30-day JWT token generated successfully!");
console.log(`📅 Generated at: ${new Date().toISOString()}`);
console.log(`⏰ Expires at: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()}`);
console.log("🔧 Updated .env file with new token while preserving Microsoft Graph credentials");
