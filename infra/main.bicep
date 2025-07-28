targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment that can be used as part of naming resource convention')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

param mcpContainerTsExists bool

@description('The principal ID for role assignments')
param principalId string = ''

// JWT and Microsoft Graph parameters
@description('Microsoft Graph tenant ID')
param tenantId string = ''

@description('Microsoft Graph client ID')
param clientId string = ''

@description('Microsoft Graph client secret')
@secure()
param clientSecret string = ''

@description('JWT audience')
param jwtAudience string = 'mcp-client'

@description('JWT issuer') 
param jwtIssuer string = 'mcp-server'

@description('JWT expiry')
param jwtExpiry string = '1h'

@description('JWT secret')
@secure()
param jwtSecret string = ''

@description('JWT token')
@secure() 
param jwtToken string = ''

// Tags that should be applied to all resources.
// 
// Note that 'azd-service-name' tags should be applied separately to service host resources.
// Example usage:
//   tags: union(tags, { 'azd-service-name': <service name in azure.yaml> })
var tags = {
  'azd-env-name': environmentName
}

// Organize resources in a resource group
resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  scope: rg
  name: 'resources'
  params: {
    location: location
    tags: tags
    mcpContainerTsExists: mcpContainerTsExists
    tenantId: tenantId
    clientId: clientId
    clientSecret: clientSecret
    jwtAudience: jwtAudience
    jwtIssuer: jwtIssuer
    jwtExpiry: jwtExpiry
    jwtSecret: jwtSecret
    jwtToken: jwtToken
  }
}

// ------------------
//    OUTPUT
// ------------------
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT
output AZURE_RESOURCE_MCP_CONTAINER_TS_ID string = resources.outputs.AZURE_RESOURCE_MCP_CONTAINER_TS_ID
