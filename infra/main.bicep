targetScope = 'resourceGroup'

@description('Foundation only: no application deployment. Lowercase alphanumeric resource prefix.')
@minLength(3)
@maxLength(10)
param namePrefix string = 'calledit'

@allowed([ 'dev', 'prod' ])
param environmentName string

@description('Owner-approved region; no region or subscription capacity is inferred by this template.')
@minLength(1)
param location string

@description('Object ID of the separately authorized Entra SQL administrator.')
@minLength(36)
@maxLength(36)
param sqlEntraAdminObjectId string

@minLength(1)
param sqlEntraAdminLogin string

@allowed([ 'Group', 'User', 'Application' ])
param sqlEntraAdminPrincipalType string = 'Group'

@description('Candidate serverless maximum vCores, not a price or capacity guarantee.')
@allowed([ 1, 2 ])
param sqlMaxVcores int = 1

@allowed([ '0.5', '1' ])
param sqlMinVcores string = '0.5'

@description('-1 keeps SQL warm. 60 is only for disposable, non-competition environments; app rollout rejects paused SQL.')
@allowed([ -1, 60 ])
param sqlAutoPauseDelay int = -1

@allowed([ 5, 10, 20, 32 ])
param sqlMaxSizeGb int = 5

@description('Explicit single IPv4 client/egress addresses. Empty means no public SQL firewall access; no allow-all-Azure rule.')
@maxLength(32)
param sqlAllowedClientIps string[] = []

@description('Log ingestion daily cap in GB. Delayed enforcement/exclusions mean this is not a billing ceiling.')
@allowed([ '0.1', '0.5', '1' ])
param logDailyCapGb string = '0.1'

var tags = {
  application: 'called-it'
  environment: environmentName
  managedBy: 'bicep'
}
var suffix = uniqueString(resourceGroup().id)
var prefix = '${namePrefix}-${environmentName}'

module identity 'modules/identity.bicep' = {
  name: 'identity'
  params: {
    location: location
    namePrefix: prefix
    tags: tags
  }
}

module observability 'modules/observability.bicep' = {
  name: 'observability'
  params: {
    location: location
    namePrefix: prefix
    tags: tags
    dailyCapGb: logDailyCapGb
  }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: {
    location: location
    registryName: '${namePrefix}${environmentName}acr${suffix}'
    tags: tags
    pullPrincipalId: identity.outputs.principalId
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyVault'
  params: {
    location: location
    keyVaultName: '${prefix}-kv-${take(suffix, 5)}'
    tags: tags
    keyVaultReaderPrincipalId: identity.outputs.principalId
  }
}

module sql 'modules/sql.bicep' = {
  name: 'sql'
  params: {
    location: location
    sqlServerName: '${prefix}-sql-${take(suffix, 6)}'
    databaseName: 'calledit'
    tags: tags
    entraAdminObjectId: sqlEntraAdminObjectId
    entraAdminLogin: sqlEntraAdminLogin
    entraAdminPrincipalType: sqlEntraAdminPrincipalType
    maxVcores: sqlMaxVcores
    minVcores: sqlMinVcores
    autoPauseDelay: sqlAutoPauseDelay
    maxSizeGb: sqlMaxSizeGb
    allowedClientIps: sqlAllowedClientIps
  }
}

module containerEnv 'modules/containerappenv.bicep' = {
  name: 'containerEnv'
  params: {
    location: location
    namePrefix: prefix
    tags: tags
    logAnalyticsId: observability.outputs.logAnalyticsId
  }
}

// Non-secret handoff, read from a successful foundation deployment before build/rollout.
output foundation object = {
  schemaVersion: 1
  environmentName: environmentName
  location: location
  resourceGroupId: resourceGroup().id
  registry: {
    id: registry.outputs.id
    name: registry.outputs.name
    loginServer: registry.outputs.loginServer
  }
  identity: {
    id: identity.outputs.id
    name: identity.outputs.name
    principalId: identity.outputs.principalId
    clientId: identity.outputs.clientId
  }
  keyVault: {
    id: keyVault.outputs.id
    name: keyVault.outputs.name
    uri: keyVault.outputs.uri
  }
  sql: {
    serverName: sql.outputs.serverName
    serverFqdn: sql.outputs.serverFqdn
    databaseName: sql.outputs.databaseName
    autoPauseDelay: sqlAutoPauseDelay
  }
  containerEnvironment: {
    id: containerEnv.outputs.id
    name: containerEnv.outputs.name
  }
  applications: {
    apiName: '${prefix}-api'
    workersName: '${prefix}-workers'
  }
}
