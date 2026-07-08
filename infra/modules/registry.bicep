// Azure Container Registry for the API/Workers images, with AcrPull granted to the shared identity.
@description('Azure region for the resources.')
param location string

@description('Globally-unique ACR name (alphanumeric, 5-50 chars).')
param registryName string

@description('Tags applied to every resource.')
param tags object

@description('ACR SKU.')
@allowed([ 'Basic', 'Standard', 'Premium' ])
param sku string = 'Basic'

@description('Principal id of the identity that pulls images.')
param pullPrincipalId string

resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: registryName
  location: location
  tags: tags
  sku: {
    name: sku
  }
  properties: {
    adminUserEnabled: false
  }
}

// Built-in role: AcrPull
var acrPullRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, pullPrincipalId, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: pullPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output loginServer string = registry.properties.loginServer
output name string = registry.name
