// Shared beta runtime identity for ACR pull, Key Vault references and separately granted SQL access.
@description('Azure region for the resources.')
param location string

@description('Base name used to derive resource names.')
param namePrefix string

@description('Tags applied to every resource.')
param tags object

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-id'
  location: location
  tags: tags
}

output id string = identity.id
output name string = identity.name
output principalId string = identity.properties.principalId
output clientId string = identity.properties.clientId
