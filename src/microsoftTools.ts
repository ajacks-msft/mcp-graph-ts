import { Client, PageIterator, PageCollection } from "@microsoft/microsoft-graph-client";
import { MicrosoftAuthManager } from "./auth/microsoft.js";
import { logger } from "./helpers/logs.js";
import { getDefaultGraphApiVersion } from "./constants.js";

const log = logger('microsoft-tools');

// Helper function to convert Lokka response format to our format
function convertResponse(result: any) {
  if (result.content?.[0]?.type === "text") {
    return { content: [result.content[0].text] };
  }
  if (result.isError) {
    return { content: [result.content[0].text] };
  }
  return result;
}

export const MicrosoftTools = [
  {
    name: "microsoft_graph",
    description: "A versatile tool to interact with Microsoft Graph API. Supports all HTTP methods (GET, POST, PUT, PATCH, DELETE) for accessing Microsoft 365 data including users, groups, mail, calendar, files, and more. For advanced query parameters ($filter, $count, $search, $orderby), set consistencyLevel to 'eventual'.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The Graph API path to call (e.g., '/me', '/users', '/groups')"
        },
        method: {
          type: "string",
          enum: ["get", "post", "put", "patch", "delete"],
          description: "HTTP method to use"
        },
        queryParams: {
          type: "object",
          description: "Query parameters for the request (e.g., {\"$filter\": \"displayName eq 'John'\"})",
          additionalProperties: { type: "string" }
        },
        body: {
          type: "object",
          description: "The request body (for POST, PUT, PATCH operations)",
          additionalProperties: true
        },
        graphApiVersion: {
          type: "string",
          enum: ["v1.0", "beta"],
          description: `Microsoft Graph API version to use (default: ${getDefaultGraphApiVersion()})`
        },
        fetchAll: {
          type: "boolean",
          description: "Set to true to automatically fetch all pages for list results (default: false)"
        },
        consistencyLevel: {
          type: "string",
          description: "Graph API ConsistencyLevel header. Set to 'eventual' for advanced query parameters ($filter, $count, $search, $orderby)"
        }
      },
      required: ["path", "method"]
    },
    outputSchema: {
      type: "object",
      properties: {
        content: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["content"]
    },
    async execute({
      path,
      method,
      queryParams,
      body,
      graphApiVersion,
      fetchAll = false,
      consistencyLevel
    }: {
      path: string;
      method: "get" | "post" | "put" | "patch" | "delete";
      queryParams?: Record<string, string>;
      body?: any;
      graphApiVersion?: "v1.0" | "beta";
      fetchAll?: boolean;
      consistencyLevel?: string;
    }) {
      try {
        const authManager = MicrosoftAuthManager.getInstance();
        if (!authManager) {
          return {
            content: ["Microsoft authentication not configured. Please check your environment variables or use the microsoft_auth_status tool for more information."]
          };
        }

        // Determine effective API version
        const useGraphBeta = process.env.USE_GRAPH_BETA !== 'false';
        const effectiveGraphApiVersion = !useGraphBeta ? "v1.0" : (graphApiVersion || getDefaultGraphApiVersion());

        log.info(`Executing microsoft_graph tool: ${method.toUpperCase()} ${path} (${effectiveGraphApiVersion})`);

        // Get Graph client
        const authProvider = authManager.getGraphAuthProvider();
        const graphClient = Client.initWithMiddleware({ authProvider });

        // Construct the request
        let request = graphClient.api(path).version(effectiveGraphApiVersion);

        // Add query parameters if provided
        if (queryParams && Object.keys(queryParams).length > 0) {
          for (const [key, value] of Object.entries(queryParams)) {
            request = request.query({ [key]: value });
          }
        }

        // Add ConsistencyLevel header if provided
        if (consistencyLevel) {
          request = request.header("ConsistencyLevel", consistencyLevel);
        }

        let responseData: any;

        // Handle different methods
        switch (method.toLowerCase()) {
          case 'get':
            if (fetchAll) {
              // Use pagination to fetch all results
              const pagedResponse: PageCollection = await request.get();
              responseData = { value: [] };
              
              if (pagedResponse.value) {
                responseData.value.push(...pagedResponse.value);
              }

              // Use PageIterator to get all pages
              const pageIterator = new PageIterator(graphClient, pagedResponse, (item) => {
                responseData.value.push(item);
                return true; // Continue iterating
              });

              await pageIterator.iterate();
            } else {
              responseData = await request.get();
            }
            break;

          case 'post':
            responseData = await request.post(body || {});
            break;

          case 'put':
            responseData = await request.put(body || {});
            break;

          case 'patch':
            responseData = await request.patch(body || {});
            break;

          case 'delete':
            responseData = await request.delete();
            break;

          default:
            return {
              content: [`Unsupported HTTP method: ${method}`]
            };
        }

        // Format result
        let resultText = `Result for Microsoft Graph API (${effectiveGraphApiVersion}) - ${method.toUpperCase()} ${path}:\n\n`;
        resultText += JSON.stringify(responseData, null, 2);

        // Add pagination note if applicable
        if (!fetchAll && method === 'get' && responseData && responseData['@odata.nextLink']) {
          resultText += '\n\n⚠️  This result may be paginated. Set fetchAll=true to retrieve all pages automatically.';
        }

        return {
          content: [resultText]
        };

      } catch (error: any) {
        log.error(`Error in microsoft_graph tool:`, error);
        
        // Include error details
        const errorBody = error.body ? (typeof error.body === 'string' ? error.body : JSON.stringify(error.body)) : 'N/A';
        const errorText = JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          statusCode: error.statusCode || 'N/A',
          errorBody: errorBody,
          path: path,
          method: method.toUpperCase()
        }, null, 2);

        return {
          content: [errorText]
        };
      }
    }
  },

  {
    name: "azure_resource",
    description: "Query Azure Resource Management API to manage Azure resources like virtual machines, storage accounts, resource groups, subscriptions, and more. Supports all HTTP methods for comprehensive Azure resource management.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The Azure Resource Management API path (e.g., '/subscriptions', '/subscriptions/{id}/resourceGroups')"
        },
        method: {
          type: "string",
          enum: ["get", "post", "put", "patch", "delete"],
          description: "HTTP method to use"
        },
        apiVersion: {
          type: "string",
          description: "Azure Resource Management API version (required, e.g., '2021-04-01')"
        },
        subscriptionId: {
          type: "string",
          description: "Azure Subscription ID (optional, will be prepended to path if provided)"
        },
        queryParams: {
          type: "object",
          description: "Additional query parameters for the request",
          additionalProperties: { type: "string" }
        },
        body: {
          type: "object",
          description: "The request body (for POST, PUT, PATCH operations)",
          additionalProperties: true
        },
        fetchAll: {
          type: "boolean",
          description: "Set to true to automatically fetch all pages for list results (default: false)"
        }
      },
      required: ["path", "method", "apiVersion"]
    },
    outputSchema: {
      type: "object",
      properties: {
        content: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["content"]
    },
    async execute({
      path,
      method,
      apiVersion,
      subscriptionId,
      queryParams,
      body,
      fetchAll = false
    }: {
      path: string;
      method: "get" | "post" | "put" | "patch" | "delete";
      apiVersion: string;
      subscriptionId?: string;
      queryParams?: Record<string, string>;
      body?: any;
      fetchAll?: boolean;
    }) {
      try {
        const authManager = MicrosoftAuthManager.getInstance();
        if (!authManager) {
          return {
            content: ["Microsoft authentication not configured. Please check your environment variables or use the microsoft_auth_status tool for more information."]
          };
        }

        log.info(`Executing azure_resource tool: ${method.toUpperCase()} ${path} (${apiVersion})`);

        // Acquire token for Azure RM
        const azureCredential = authManager.getAzureCredential();
        const tokenResponse = await azureCredential.getToken("https://management.azure.com/.default");
        if (!tokenResponse || !tokenResponse.token) {
          return {
            content: ["Failed to acquire Azure Resource Management token"]
          };
        }

        // Construct the URL
        let url = "https://management.azure.com";
        if (subscriptionId) {
          url += `/subscriptions/${subscriptionId}`;
        }
        url += path;

        const urlParams = new URLSearchParams({ 'api-version': apiVersion });
        if (queryParams) {
          for (const [key, value] of Object.entries(queryParams)) {
            urlParams.set(key, value);
          }
        }
        url += `?${urlParams.toString()}`;

        // Prepare request options
        const headers: Record<string, string> = {
          'Authorization': `Bearer ${tokenResponse.token}`,
          'Content-Type': 'application/json'
        };
        const requestOptions: RequestInit = {
          method: method.toUpperCase(),
          headers: headers
        };
        if (["POST", "PUT", "PATCH"].includes(method.toUpperCase()) && body) {
          requestOptions.body = JSON.stringify(body);
        }

        let responseData: any;

        // Handle pagination for GET requests if fetchAll is true
        if (fetchAll && method === 'get') {
          responseData = { value: [] };
          let currentUrl: string | null = url;

          while (currentUrl) {
            const response: Response = await fetch(currentUrl, requestOptions);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const pageData: any = await response.json();
            
            if (pageData.value && Array.isArray(pageData.value)) {
              responseData.value.push(...pageData.value);
            } else {
              // Single item response
              responseData = pageData;
              break;
            }

            currentUrl = pageData.nextLink || null;
          }
        } else {
          // Single request
          const response = await fetch(url, requestOptions);
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${response.statusText}\n${errorText}`);
          }

          if (response.status === 204) {
            // No content response
            responseData = { message: "Operation completed successfully (No Content)" };
          } else {
            responseData = await response.json();
          }
        }

        // Format result
        let resultText = `Result for Azure Resource Management API (${apiVersion}) - ${method.toUpperCase()} ${path}:\n\n`;
        resultText += JSON.stringify(responseData, null, 2);

        // Add pagination note if applicable
        if (!fetchAll && method === 'get' && responseData && responseData.nextLink) {
          resultText += '\n\n⚠️  This result may be paginated. Set fetchAll=true to retrieve all pages automatically.';
        }

        return {
          content: [resultText]
        };

      } catch (error: any) {
        log.error(`Error in azure_resource tool:`, error);
        
        const errorText = JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          path: path,
          method: method.toUpperCase(),
          apiVersion: apiVersion
        }, null, 2);

        return {
          content: [errorText]
        };
      }
    }
  },

  {
    name: "microsoft_auth_status",
    description: "Check the current Microsoft authentication status and configuration. Shows authentication mode, token status, and available permissions/scopes.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    },
    outputSchema: {
      type: "object",
      properties: {
        content: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["content"]
    },
    async execute() {
      try {
        const authManager = MicrosoftAuthManager.getInstance();
        
        if (!authManager) {
          return {
            content: [JSON.stringify({
              status: "Not configured",
              message: "Microsoft authentication is not configured. Set environment variables to enable Microsoft tools.",
              availableAuthModes: [
                "client_credentials - Set TENANT_ID, CLIENT_ID, CLIENT_SECRET",
                "interactive - Set USE_INTERACTIVE=true (uses defaults or TENANT_ID, CLIENT_ID)",
                "certificate - Set USE_CERTIFICATE=true, TENANT_ID, CLIENT_ID, CERTIFICATE_PATH",
                "client_provided_token - Set USE_CLIENT_TOKEN=true, optionally ACCESS_TOKEN"
              ],
              timestamp: new Date().toISOString()
            }, null, 2)]
          };
        }

        const authMode = authManager.getAuthMode();
        const tokenStatus = await authManager.getTokenStatus();
        
        return {
          content: [JSON.stringify({
            status: "Configured",
            authMode,
            tokenStatus: tokenStatus,
            supportsTokenUpdates: authMode === "client_provided_token",
            timestamp: new Date().toISOString()
          }, null, 2)]
        };

      } catch (error: any) {
        return {
          content: [`Error checking Microsoft authentication status: ${error.message}`]
        };
      }
    }
  }
];
