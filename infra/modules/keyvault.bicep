// RBAC-enabled Key Vault for app-managed secrets (JWT signing key, contacts pepper, provider keys).
// The shared identity is granted Key Vault Secrets User so the apps can read via Key Vault references.
@description('Azure region for the resources.')
param location string

@description('Globally-unique Key Vault name (3-24 chars).')
param keyVaultName string

@description('Tags applied to every resource.')
param tags object

@description('Principal id of the identity that reads secrets.')
param keyVaultReaderPrincipalId string

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: tenant().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

// Built-in role: Key Vault Secrets User
var secretsUserRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, keyVaultReaderPrincipalId, secretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: secretsUserRoleId
    principalId: keyVaultReaderPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output id string = keyVault.id
output name string = keyVault.name
output uri string = keyVault.properties.vaultUri
