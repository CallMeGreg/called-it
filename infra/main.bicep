// ---------------------------------------------------------------------------------------------
// Called It — main infrastructure (resource-group scoped).
// Deploy:  az deployment group create -g <rg> -f infra/main.bicep -p infra/main.<env>.bicepparam
// ---------------------------------------------------------------------------------------------
targetScope = 'resourceGroup'

@description('Short base name for all resources (lowercase alphanumeric).')
param namePrefix string = 'calledit'

@description('Environment discriminator.')
@allowed([ 'dev', 'prod' ])
param environmentName string

@description('Azure region. Defaults to the resource group location.')
param location string = resourceGroup().location

// --- SQL ---
@description('SQL administrator login.')
param sqlAdministratorLogin string

@description('SQL administrator password.')
@secure()
param sqlAdministratorPassword string

@description('Optional Entra admin object id for the SQL server (recommended for managed-identity access).')
param sqlAadAdminObjectId string = ''

@description('Optional Entra admin login/display name for the SQL server.')
param sqlAadAdminLogin string = ''

// --- App secrets ---
@description('JWT signing key (>= 32 chars). Store in Key Vault / CI secret, never in source.')
@secure()
param authSigningKey string

@description('HMAC pepper for privacy-preserving contact hashing.')
@secure()
param contactsPepper string

// --- Notifications / SMS ---
@description('Provisioned ACS sender number in E.164 (empty until purchased — dev SMS is used meanwhile).')
param acsFromNumber string = ''

// --- Game config ---
@description('Phone numbers (E.164) bootstrapped as admins.')
param adminBootstrapPhones array = []

// --- Images (CD overrides these with the freshly built, tagged images) ---
@description('API container image reference.')
param apiImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Workers container image reference.')
param workersImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

// --- Sizing (overridden per environment) ---
@description('ACR SKU.')
param acrSku string = 'Basic'

@description('Redis SKU name.')
param redisSkuName string = 'Basic'

@description('Redis SKU family.')
param redisSkuFamily string = 'C'

@description('Redis capacity.')
param redisSkuCapacity int = 0

@description('Minimum container replicas.')
param minReplicas int = 1

@description('Maximum container replicas.')
param maxReplicas int = 3

// ---------------------------------------------------------------------------------------------

var tags = {
  application: 'called-it'
  environment: environmentName
  managedBy: 'bicep'
}

var suffix = uniqueString(resourceGroup().id)
var prefix = '${namePrefix}-${environmentName}'

// Globally-unique names (stripped of hyphens where the resource requires it).
var acrName = '${namePrefix}${environmentName}acr${suffix}'
var keyVaultName = '${prefix}-kv-${take(suffix, 5)}'
var storageName = '${namePrefix}${environmentName}st${take(suffix, 8)}'
var sqlServerName = '${prefix}-sql-${take(suffix, 6)}'
var redisName = '${prefix}-redis-${take(suffix, 6)}'
var appConfigName = '${prefix}-appcs-${take(suffix, 6)}'
var nhNamespaceName = '${prefix}-nh-${take(suffix, 6)}'
var acsName = '${prefix}-acs-${take(suffix, 6)}'
var databaseName = 'calledit'
var hubName = 'drops'

// ---- Identity (shared by both apps) ----
module identity 'modules/identity.bicep' = {
  name: 'identity'
  params: {
    location: location
    namePrefix: prefix
    tags: tags
  }
}

// ---- Observability ----
module observability 'modules/observability.bicep' = {
  name: 'observability'
  params: {
    location: location
    namePrefix: prefix
    tags: tags
    retentionInDays: environmentName == 'prod' ? 90 : 30
  }
}

// ---- Registry ----
module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: {
    location: location
    registryName: acrName
    tags: tags
    sku: acrSku
    pullPrincipalId: identity.outputs.principalId
  }
}

// ---- Key Vault ----
module keyVault 'modules/keyvault.bicep' = {
  name: 'keyVault'
  params: {
    location: location
    keyVaultName: keyVaultName
    tags: tags
    keyVaultReaderPrincipalId: identity.outputs.principalId
  }
}

// ---- SQL ----
module sql 'modules/sql.bicep' = {
  name: 'sql'
  params: {
    location: location
    sqlServerName: sqlServerName
    databaseName: databaseName
    tags: tags
    administratorLogin: sqlAdministratorLogin
    administratorPassword: sqlAdministratorPassword
    aadAdminObjectId: sqlAadAdminObjectId
    aadAdminLogin: sqlAadAdminLogin
  }
}

// ---- Redis ----
module redis 'modules/redis.bicep' = {
  name: 'redis'
  params: {
    location: location
    redisName: redisName
    tags: tags
    skuName: redisSkuName
    skuFamily: redisSkuFamily
    skuCapacity: redisSkuCapacity
  }
}

// ---- Storage ----
module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    storageAccountName: storageName
    tags: tags
    dataContributorPrincipalId: identity.outputs.principalId
  }
}

// ---- App Configuration ----
module appConfig 'modules/appconfig.bicep' = {
  name: 'appConfig'
  params: {
    location: location
    configName: appConfigName
    tags: tags
    dataReaderPrincipalId: identity.outputs.principalId
    sku: environmentName == 'prod' ? 'standard' : 'free'
  }
}

// ---- Notification Hubs ----
module notificationHubs 'modules/notificationhubs.bicep' = {
  name: 'notificationHubs'
  params: {
    location: location
    namespaceName: nhNamespaceName
    hubName: hubName
    tags: tags
  }
}

// ---- Communication Services (SMS) ----
module communication 'modules/communication.bicep' = {
  name: 'communication'
  params: {
    communicationName: acsName
    tags: tags
  }
}

// ---- Container Apps environment ----
module containerEnv 'modules/containerappenv.bicep' = {
  name: 'containerEnv'
  params: {
    location: location
    namePrefix: prefix
    tags: tags
    logAnalyticsId: observability.outputs.logAnalyticsId
    appInsightsConnectionString: observability.outputs.appInsightsConnectionString
  }
}

// ---- Shared app configuration ----
var sqlConnectionString = 'Server=tcp:${sql.outputs.serverFqdn},1433;Database=${sql.outputs.databaseName};Authentication=Active Directory Managed Identity;User Id=${identity.outputs.clientId};Encrypt=True;TrustServerCertificate=False;'

var adminPhoneEnv = [for (phone, i) in adminBootstrapPhones: {
  name: 'Game__AdminBootstrapPhones__${i}'
  value: phone
}]

var commonEnv = concat([
  { name: 'ASPNETCORE_URLS', value: 'http://+:8080' }
  { name: 'AZURE_CLIENT_ID', value: identity.outputs.clientId }
  { name: 'Database__Provider', value: 'SqlServer' }
  { name: 'ConnectionStrings__Database', value: sqlConnectionString }
  { name: 'NotificationHubs__HubName', value: notificationHubs.outputs.hubName }
  { name: 'Acs__FromNumber', value: acsFromNumber }
  { name: 'AppConfig__Endpoint', value: appConfig.outputs.endpoint }
  { name: 'Storage__BlobEndpoint', value: storage.outputs.blobEndpoint }
  { name: 'SocialAuth__UseFake', value: 'false' }
], adminPhoneEnv)

var commonSecrets = [
  { name: 'redis-connection', envName: 'ConnectionStrings__Redis', value: redis.outputs.connectionString }
  { name: 'acs-connection', envName: 'Acs__ConnectionString', value: communication.outputs.connectionString }
  { name: 'nh-connection', envName: 'NotificationHubs__ConnectionString', value: notificationHubs.outputs.connectionString }
  { name: 'appinsights-connection', envName: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: observability.outputs.appInsightsConnectionString }
  { name: 'auth-signingkey', envName: 'Auth__SigningKey', value: authSigningKey }
  { name: 'contacts-pepper', envName: 'Contacts__Pepper', value: contactsPepper }
]

// ---- API container app (external ingress) ----
module apiApp 'modules/containerapp.bicep' = {
  name: 'apiApp'
  params: {
    location: location
    name: '${prefix}-api'
    tags: tags
    environmentId: containerEnv.outputs.id
    identityId: identity.outputs.id
    registryServer: registry.outputs.loginServer
    image: apiImage
    externalIngress: true
    targetPort: 8080
    envVars: commonEnv
    secrets: commonSecrets
    minReplicas: minReplicas
    maxReplicas: maxReplicas
  }
}

// ---- Workers container app (no ingress) ----
module workersApp 'modules/containerapp.bicep' = {
  name: 'workersApp'
  params: {
    location: location
    name: '${prefix}-workers'
    tags: tags
    environmentId: containerEnv.outputs.id
    identityId: identity.outputs.id
    registryServer: registry.outputs.loginServer
    image: workersImage
    externalIngress: false
    envVars: commonEnv
    secrets: commonSecrets
    minReplicas: 1
    maxReplicas: 1
  }
}

// ---- Outputs (consumed by CI/CD) ----
output acrLoginServer string = registry.outputs.loginServer
output acrName string = registry.outputs.name
output apiName string = apiApp.outputs.name
output apiFqdn string = apiApp.outputs.fqdn
output workersName string = workersApp.outputs.name
output identityClientId string = identity.outputs.clientId
output keyVaultName string = keyVault.outputs.name
output sqlServerFqdn string = sql.outputs.serverFqdn
output appConfigEndpoint string = appConfig.outputs.endpoint
