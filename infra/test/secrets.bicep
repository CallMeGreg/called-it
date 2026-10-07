@allowed(['called-it-test-data'])
param dataGroupName string = any(resourceGroup().name)

param vaultName string
param runtimePrincipalId string
param deployerPrincipalId string

@secure()
@minLength(32)
param signingKey string

@secure()
@minLength(32)
param contactsPepper string

@secure()
param invitesJson string

@secure()
param ownerRecoveryJson string

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: vaultName
}

resource appSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [for secret in [
  { name: 'auth-signing-key', value: signingKey }
  { name: 'contacts-pepper', value: contactsPepper }
  { name: 'test-invites', value: invitesJson }
]: {
  parent: vault
  name: secret.name
  properties: {
    value: secret.value
    attributes: { enabled: true }
  }
}]

resource recovery 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'owner-recovery'
  properties: {
    value: ownerRecoveryJson
    attributes: { enabled: true }
  }
}

var secretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var metadataReaderRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '21090545-7ca7-4776-b22c-e363652d74d2')

resource runtimeSecretReaders 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for i in range(0, 3): {
  name: guid(appSecrets[i].id, runtimePrincipalId, secretsUserRole)
  scope: appSecrets[i]
  properties: {
    principalId: runtimePrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: secretsUserRole
  }
}]

resource deployerMetadataReaders 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for i in range(0, 3): {
  name: guid(appSecrets[i].id, deployerPrincipalId, metadataReaderRole)
  scope: appSecrets[i]
  properties: {
    principalId: deployerPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: metadataReaderRole
  }
}]

output resourceGroupName string = dataGroupName
