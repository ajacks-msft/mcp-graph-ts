// Default constants for Microsoft authentication (from Lokka)
export const LokkaClientId = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
export const LokkaDefaultTenantId = "common";
export const LokkaDefaultRedirectUri = "http://localhost:3000";

// Helper function to determine default Graph API version
export function getDefaultGraphApiVersion(): string {
  const useGraphBeta = process.env.USE_GRAPH_BETA !== 'false';
  return useGraphBeta ? "beta" : "v1.0";
}
