// Log Analytics workspace + Application Insights (workspace-based) for the whole platform.
@description('Azure region for the resources.')
param location string

@description('Base name used to derive resource names.')
param namePrefix string

@description('Tags applied to every resource.')
param tags object

@description('Log/telemetry retention in days.')
param retentionInDays int = 30

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-log'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    features: {
      searchVersion: 1
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-appi'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
  }
}

output logAnalyticsId string = logAnalytics.id
output logAnalyticsCustomerId string = logAnalytics.properties.customerId
@description('Application Insights connection string (injected into the apps).')
output appInsightsConnectionString string = appInsights.properties.ConnectionString
