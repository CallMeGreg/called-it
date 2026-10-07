@allowed(['called-it-test-data'])
param dataGroupName string = any(resourceGroup().name)

param location string
param tenantId string
param operatorObjectId string
param tags object
param privateLinkRoleId string

var config = loadJsonContent('config.json')
var suffix = take(uniqueString(subscription().id, dataGroupName), 10)
var identityNames = [
  'called-it-test-runtime'
  'called-it-test-migrator'
  'called-it-test-deployer'
  'called-it-test-cleanup'
]

resource identities 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = [for name in identityNames: {
  name: name
  location: location
  tags: tags
}]

resource federation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: identities[2]
  name: 'github-test'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${config.repository}:environment:${config.githubEnvironment}'
    audiences: ['api://AzureADTokenExchange']
  }
}

resource sql 'Microsoft.Sql/servers@2023-08-01' = {
  name: 'called-it-test-sql-${suffix}'
  location: location
  tags: tags
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
    restrictOutboundNetworkAccess: 'Disabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'Application'
      login: identities[1].name
      sid: identities[1].properties.principalId
      tenantId: tenantId
      azureADOnlyAuthentication: true
    }
  }
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sql
  name: 'calledit'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
  properties: {
    maxSizeBytes: 2147483648
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    requestedBackupStorageRedundancy: 'Local'
    zoneRedundant: false
  }
}

resource databaseLock 'Microsoft.Authorization/locks@2020-05-01' = {
  name: 'retain-test-results'
  scope: database
  properties: {
    level: 'CanNotDelete'
    notes: 'Start/Stop must retain TEST accounts and results. Not owned by the run stack.'
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'cit-test-kv-${suffix}'
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
  }
}

resource vaultLock 'Microsoft.Authorization/locks@2020-05-01' = {
  name: 'retain-test-keys'
  scope: vault
  properties: {
    level: 'CanNotDelete'
    notes: 'Stable signing keys and invite recovery survive every runtime teardown.'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'cittestctl${suffix}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: false
    deleteRetentionPolicy: { enabled: true, days: 7 }
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }
  }
}

resource stateContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: config.stateContainer
  properties: { publicAccess: 'None' }
}

resource storageLock 'Microsoft.Authorization/locks@2020-05-01' = {
  name: 'retain-test-lifecycle'
  scope: storage
  properties: {
    level: 'CanNotDelete'
    notes: 'The independent expiry controller must survive runtime teardown.'
  }
}

var dataReaderRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
var identityOperatorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'f1a07417-d97a-45cb-824c-7a7467783830')
var blobContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var secretsOfficerRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')

resource deployerReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, identities[2].id, dataReaderRole)
  properties: {
    principalId: identities[2].properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: dataReaderRole
  }
}

resource identityOperators 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for i in range(0, 2): {
  name: guid(identities[i].id, identities[2].id, identityOperatorRole)
  scope: identities[i]
  properties: {
    principalId: identities[2].properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: identityOperatorRole
  }
}]

var statePrincipals = [
  { id: identities[2].properties.principalId, type: 'ServicePrincipal' }
  { id: identities[3].properties.principalId, type: 'ServicePrincipal' }
  { id: operatorObjectId, type: 'User' }
]

resource stateReadersWriters 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for i in range(0, 3): {
  name: guid(stateContainer.id, 'test-state-access', i == 2 ? operatorObjectId : string(i), blobContributorRole)
  scope: stateContainer
  properties: {
    principalId: statePrincipals[i].id
    principalType: statePrincipals[i].type
    roleDefinitionId: blobContributorRole
  }
}]

resource ownerSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, operatorObjectId, secretsOfficerRole)
  scope: vault
  properties: {
    principalId: operatorObjectId
    principalType: 'User'
    roleDefinitionId: secretsOfficerRole
  }
}

resource approvePrivateLink 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(sql.id, identities[2].id, privateLinkRoleId)
  scope: sql
  properties: {
    principalId: identities[2].properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: privateLinkRoleId
  }
}

resource owners 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'called-it-test-owners'
  location: location
  tags: tags
  properties: {
    groupShortName: 'cit-test'
    enabled: true
    armRoleReceivers: [{
      name: 'subscription-owners'
      roleId: '8e3af657-a8ff-443c-a75c-2fe8c4bcb635'
      useCommonAlertSchema: true
    }]
  }
}

var stateUrl = '${storage.properties.primaryEndpoints.blob}${stateContainer.name}/${config.stateBlob}'

module watchdog 'watchdog.bicep' = {
  name: 'called-it-test-watchdog'
  params: {
    location: location
    tags: tags
    identityId: identities[3].id
    stateUrl: stateUrl
    actionGroupId: owners.id
  }
}

output configuration object = {
  subscriptionId: subscription().subscriptionId
  tenantId: tenantId
  location: location
  dataGroup: dataGroupName
  runGroup: config.runGroup
  managedGroup: config.managedGroup
  sqlServerName: sql.name
  sqlServerId: sql.id
  sqlFqdn: sql.properties.fullyQualifiedDomainName
  databaseName: database.name
  vaultName: vault.name
  vaultUri: vault.properties.vaultUri
  storageName: storage.name
  stateUrl: stateUrl
  runtimeIdentityId: identities[0].id
  runtimeClientId: identities[0].properties.clientId
  runtimePrincipalId: identities[0].properties.principalId
  runtimeIdentityName: identities[0].name
  migratorIdentityId: identities[1].id
  migratorClientId: identities[1].properties.clientId
  migratorPrincipalId: identities[1].properties.principalId
  deployerClientId: identities[2].properties.clientId
  deployerPrincipalId: identities[2].properties.principalId
  cleanupPrincipalId: identities[3].properties.principalId
  actionGroupId: owners.id
  watchdogId: watchdog.outputs.id
}
