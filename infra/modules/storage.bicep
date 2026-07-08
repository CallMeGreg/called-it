// Blob storage for question media, category icons, and generated share cards. Blob Data Contributor
// is granted to the shared identity (access via managed identity, not keys).
@description('Azure region for the resources.')
param location string

@description('Globally-unique storage account name (3-24 lowercase alphanumeric).')
param storageAccountName string

@description('Tags applied to every resource.')
param tags object

@description('Principal id of the identity that reads/writes blobs.')
param dataContributorPrincipalId string

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource mediaContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'media'
  properties: {
    publicAccess: 'None'
  }
}

// Built-in role: Storage Blob Data Contributor
var blobContributorRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')

resource blobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, dataContributorPrincipalId, blobContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: blobContributorRoleId
    principalId: dataContributorPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output name string = storage.name
output blobEndpoint string = storage.properties.primaryEndpoints.blob
