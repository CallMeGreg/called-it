param location string
param tags object
param identityId string
param stateUrl string
param actionGroupId string

var config = loadJsonContent('config.json')

resource workflow 'Microsoft.Logic/workflows@2019-05-01' = {
  name: 'called-it-test-expiry'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identityId}': {} }
  }
  properties: {
    state: 'Enabled'
    definition: loadJsonContent('watchdog.json')
    parameters: {
      stateUrl: { value: stateUrl }
      runGroupId: { value: '/subscriptions/${subscription().subscriptionId}/resourceGroups/${config.runGroup}' }
      managedGroupId: { value: '/subscriptions/${subscription().subscriptionId}/resourceGroups/${config.managedGroup}' }
      subscriptionId: { value: subscription().subscriptionId }
      tenantId: { value: tenant().tenantId }
      identityId: { value: identityId }
    }
  }
}

resource failureAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'called-it-test-expiry-failure'
  location: 'global'
  tags: tags
  properties: {
    description: 'TEST expiry failed. Inspect the lifecycle state and workflow; paid run resources may remain.'
    severity: 1
    enabled: true
    scopes: [workflow.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{
        name: 'expiry-failed'
        metricNamespace: 'Microsoft.Logic/workflows'
        metricName: 'RunsFailed'
        operator: 'GreaterThan'
        threshold: 0
        timeAggregation: 'Total'
        criterionType: 'StaticThresholdCriterion'
      }]
    }
    autoMitigate: true
    actions: [{ actionGroupId: actionGroupId }]
  }
}

resource heartbeatAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'called-it-test-expiry-missing-heartbeat'
  location: 'global'
  tags: tags
  properties: {
    description: 'No TEST expiry workflow starts in 15 minutes. Check whether the controller is disabled or unavailable; paid resources may remain.'
    severity: 1
    enabled: true
    scopes: [workflow.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{
        name: 'expiry-heartbeat'
        metricNamespace: 'Microsoft.Logic/workflows'
        metricName: 'RunsStarted'
        operator: 'LessThan'
        threshold: 1
        timeAggregation: 'Total'
        criterionType: 'StaticThresholdCriterion'
      }]
    }
    autoMitigate: true
    actions: [{ actionGroupId: actionGroupId }]
  }
}

output id string = workflow.id
