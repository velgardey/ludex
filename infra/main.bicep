// Deployment scaffold only. Run a reviewed region-specific quote and what-if before creation.
targetScope = 'resourceGroup'
param location string = resourceGroup().location
param prefix string
@description('Must be explicitly verified as eligible. All resources are disabled unless selected.')
param cosmosFreeTierEligible bool = false
param allowedOrigin string
param oidcIssuer string
param oidcAudience string
param oidcJwksUrl string
var suffix = uniqueString(resourceGroup().id, prefix)
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = if (cosmosFreeTierEligible) {
 name: take('${prefix}${suffix}', 24)
 location: location
 sku: { name: 'Standard_LRS' }
 kind: 'StorageV2'
 properties: { supportsHttpsTrafficOnly: true
 minimumTlsVersion: 'TLS1_2'
 allowBlobPublicAccess: false }
}
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = if (cosmosFreeTierEligible) {
 name: '${prefix}-${suffix}-cosmos'
 location: location
 kind: 'GlobalDocumentDB'
 properties: {
  databaseAccountOfferType: 'Standard'
  enableFreeTier: true
  enableMultipleWriteLocations: false
  locations: [{ locationName: location
 failoverPriority: 0
 isZoneRedundant: false }]
  consistencyPolicy: { defaultConsistencyLevel: 'Session' }
 }
}
resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = if (cosmosFreeTierEligible) {
 parent: cosmos
 name: 'ludex'
 properties: { resource: { id: 'ludex' }
 options: { throughput: 400 } }
}
resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = if (cosmosFreeTierEligible) {
 parent: database
 name: 'documents'
 properties: { resource: { id: 'documents'
 partitionKey: { paths: ['/scope']
 kind: 'Hash' } }
 options: {} }
}
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = if (cosmosFreeTierEligible) {
 name: '${prefix}-${suffix}-consumption'
 location: location
 sku: { name: 'Y1'
 tier: 'Dynamic' }
 properties: { reserved: false }
}
resource api 'Microsoft.Web/sites@2023-12-01' = if (cosmosFreeTierEligible) {
 name: '${prefix}-${suffix}-api'
 location: location
 kind: 'functionapp'
 identity: { type: 'SystemAssigned' }
 properties: {
  serverFarmId: plan.id
  httpsOnly: true
  siteConfig: {
   minTlsVersion: '1.2'
   cors: { allowedOrigins: [allowedOrigin]
 supportCredentials: false }
   appSettings: [
    { name: 'FUNCTIONS_EXTENSION_VERSION'
 value: '~4' }
    { name: 'FUNCTIONS_WORKER_RUNTIME'
 value: 'node' }
    { name: 'WEBSITE_NODE_DEFAULT_VERSION'
 value: '~22' }
    { name: 'AzureWebJobsStorage'
 value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage!.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}' }
    { name: 'COSMOS_CONNECTION_STRING'
 value: cosmos!.listConnectionStrings().connectionStrings[0].connectionString }
    { name: 'COSMOS_DATABASE'
 value: 'ludex' }
    { name: 'COSMOS_CONTAINER'
 value: 'documents' }
    { name: 'OIDC_ISSUER'
 value: oidcIssuer }
    { name: 'OIDC_AUDIENCE'
 value: oidcAudience }
    { name: 'OIDC_JWKS_URL'
 value: oidcJwksUrl }
    { name: 'LUDEX_CORS_ORIGINS'
 value: allowedOrigin }
    { name: 'NODE_ENV'
 value: 'production' }
   ]
  }
 }
}
output apiHostname string = cosmosFreeTierEligible ? api!.properties.defaultHostName : 'BLOCKED: verify Cosmos free-tier eligibility before deployment'
