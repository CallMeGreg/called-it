param location string
param namePrefix string
param tags object

@allowed([ '0.1', '0.5', '1' ])
param dailyCapGb string = '0.1'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-log'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: json(dailyCapGb)
    }
  }
}

output logAnalyticsId string = logAnalytics.id
