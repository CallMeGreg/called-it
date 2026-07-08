// Azure App Configuration — category weights, feature flags, and the force-update gate. The shared
// identity is granted App Configuration Data Reader; the endpoint is injected into the apps.
@description('Azure region for the resources.')
param location string

@description('Globally-unique App Configuration store name.')
param configName string

@description('Tags applied to every resource.')
param tags object

@description('Principal id of the identity that reads configuration.')
param dataReaderPrincipalId string

@description('App Configuration SKU.')
@allowed([ 'free', 'standard' ])
param sku string = 'standard'

resource appConfig 'Microsoft.AppConfiguration/configurationStores@2023-03-01' = {
  name: configName
  location: location
  tags: tags
  sku: {
    name: sku
  }
  properties: {
    disableLocalAuth: true
  }
}

// Built-in role: App Configuration Data Reader
var dataReaderRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions', '516239f1-63e1-4d78-a4de-a74fb236a071')

resource dataReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appConfig.id, dataReaderPrincipalId, dataReaderRoleId)
  scope: appConfig
  properties: {
    roleDefinitionId: dataReaderRoleId
    principalId: dataReaderPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output endpoint string = appConfig.properties.endpoint
output name string = appConfig.name
