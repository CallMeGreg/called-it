targetScope = 'subscription'

var config = loadJsonContent('test/config.json')

@allowed(['b5ccc8c6-8222-4b70-83a3-3d7de1e5920f'])
// ARM, not Bicep's static type checker, must validate the actual deployment scope.
param subscriptionId string = any(subscription().subscriptionId)

@allowed(['7b73b4a1-6b8a-47be-b3b0-0f441ef65a34'])
param tenantId string = any(tenant().tenantId)

@allowed(['eastus2'])
param location string = 'eastus2'

@description('Existing operator object ID; receives access to private owner recovery material.')
param operatorObjectId string

@description('First day of the current budget period, not a secret.')
param budgetStartDate string = utcNow('yyyy-MM-01T00:00:00Z')

var tags = {
  application: 'called-it'
  environment: 'test'
  managedBy: 'bicep'
}

resource dataGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: config.dataGroup
  location: location
  tags: union(tags, { lifecycle: 'persistent' })
}

resource runGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: config.runGroup
  location: location
  tags: union(tags, { lifecycle: 'disposable' })
}

resource cleanupRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(subscriptionId, 'called-it-test-run-cleanup')
  properties: {
    roleName: 'Called It TEST run cleanup'
    description: 'Delete only resources owned by the disposable TEST stack; no SQL, Key Vault, storage, or resource-group deletion.'
    type: 'CustomRole'
    assignableScopes: [runGroup.id]
    permissions: [{
      actions: [
        '*/read'
        'Microsoft.Resources/deploymentStacks/delete'
        'Microsoft.Resources/deployments/cancel/action'
        'Microsoft.App/containerApps/delete'
        'Microsoft.App/jobs/delete'
        'Microsoft.App/managedEnvironments/delete'
        'Microsoft.ContainerRegistry/registries/delete'
        'Microsoft.Network/virtualNetworks/delete'
        'Microsoft.Network/virtualNetworks/subnets/delete'
        'Microsoft.Network/privateEndpoints/delete'
        'Microsoft.Network/privateEndpoints/privateDnsZoneGroups/delete'
        'Microsoft.Network/privateDnsZones/delete'
        'Microsoft.Network/privateDnsZones/virtualNetworkLinks/delete'
        'Microsoft.Network/privateDnsZones/A/delete'
        'Microsoft.OperationalInsights/workspaces/delete'
        'Microsoft.Authorization/roleAssignments/delete'
      ]
      notActions: []
      dataActions: []
      notDataActions: []
    }]
  }
}

resource groupMetadataRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(subscriptionId, 'called-it-test-group-existence')
  properties: {
    roleName: 'Called It TEST group existence reader'
    description: 'Read group metadata to verify ACA service-managed group deletion; no resource data or mutation.'
    type: 'CustomRole'
    assignableScopes: [subscription().id]
    permissions: [{
      actions: ['Microsoft.Resources/subscriptions/resourceGroups/read']
      notActions: []
      dataActions: []
      notDataActions: []
    }]
  }
}

resource privateLinkRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(subscriptionId, 'called-it-test-sql-private-link')
  properties: {
    roleName: 'Called It TEST SQL private endpoint approver'
    description: 'Approve private connections without SQL server/database write or delete access.'
    type: 'CustomRole'
    assignableScopes: [dataGroup.id]
    permissions: [{
      actions: [
        'Microsoft.Sql/servers/read'
        'Microsoft.Sql/servers/privateEndpointConnections/read'
        'Microsoft.Sql/servers/privateEndpointConnections/write'
        'Microsoft.Sql/servers/privateEndpointConnectionsApproval/action'
      ]
      notActions: []
      dataActions: []
      notDataActions: []
    }]
  }
}

module foundation 'test/foundation.bicep' = {
  name: 'called-it-test-data'
  scope: dataGroup
  params: {
    location: location
    tenantId: tenantId
    operatorObjectId: operatorObjectId
    tags: tags
    privateLinkRoleId: privateLinkRole.id
  }
}

module runAccess 'test/run-access.bicep' = {
  name: 'called-it-test-run-access'
  scope: runGroup
  params: {
    deployerPrincipalId: foundation.outputs.configuration.deployerPrincipalId
    runtimePrincipalId: foundation.outputs.configuration.runtimePrincipalId
    migratorPrincipalId: foundation.outputs.configuration.migratorPrincipalId
    cleanupPrincipalId: foundation.outputs.configuration.cleanupPrincipalId
    cleanupRoleId: cleanupRole.id
  }
}

var groupReaderIds = [
  foundation.outputs.configuration.deployerPrincipalId
  foundation.outputs.configuration.cleanupPrincipalId
]

resource groupReaders 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for i in range(0, 2): {
  name: guid(subscriptionId, 'test-group-reader', string(i), groupMetadataRole.id)
  properties: {
    principalId: groupReaderIds[i]
    principalType: 'ServicePrincipal'
    roleDefinitionId: groupMetadataRole.id
  }
}]

resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: 'called-it-test-monthly'
  properties: {
    amount: 25
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    filter: {
      dimensions: {
        name: 'ResourceGroupName'
        operator: 'In'
        values: [config.dataGroup, config.runGroup, config.managedGroup]
      }
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: []
        contactGroups: [foundation.outputs.configuration.actionGroupId]
      }
      actual100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: []
        contactGroups: [foundation.outputs.configuration.actionGroupId]
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: []
        contactGroups: [foundation.outputs.configuration.actionGroupId]
      }
    }
  }
}

output configuration object = union(foundation.outputs.configuration, {
  subscriptionId: subscriptionId
  tenantId: tenantId
  location: location
  dataGroup: dataGroup.name
  runGroup: runGroup.name
  managedGroup: config.managedGroup
})
