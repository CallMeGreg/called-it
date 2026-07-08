// Container Apps managed environment wired to Log Analytics + Application Insights (Dapr-ready).
@description('Azure region for the resources.')
param location string

@description('Base name used to derive resource names.')
param namePrefix string

@description('Tags applied to every resource.')
param tags object

@description('Log Analytics workspace resource id.')
param logAnalyticsId string

@description('Application Insights connection string for the environment.')
@secure()
param appInsightsConnectionString string

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: last(split(logAnalyticsId, '/'))
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-cae'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    daprAIConnectionString: appInsightsConnectionString
    zoneRedundant: false
  }
}

output id string = environment.id
output name string = environment.name
output defaultDomain string = environment.properties.defaultDomain
