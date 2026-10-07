targetScope = 'resourceGroup'

@allowed(['b5ccc8c6-8222-4b70-83a3-3d7de1e5920f'])
param subscriptionId string = any(subscription().subscriptionId)

@allowed(['called-it-test-run'])
param runGroupName string = any(resourceGroup().name)

@allowed(['eastus2'])
param location string = 'eastus2'

@minLength(32)
@maxLength(32)
@description('Unique lowercase hexadecimal run ID. Never reuse after Stop.')
param runId string

@description('Non-secret outputs of the retained foundation.')
param foundation object

@description('Empty only during initial network/registry stage; otherwise an immutable TEST ACR digest.')
param migrationImage string = ''

@description('Empty until the migration Job has succeeded; otherwise an immutable TEST ACR digest.')
param apiImage string = ''

@description('Versioned Key Vault URIs, never secret values.')
param secretUris object = {}

var config = loadJsonContent('config.json')
var prefix = 'cit-test-${take(runId, 12)}'
var tags = {
  application: 'called-it'
  environment: 'test'
  managedBy: 'bicep'
  lifecycle: 'disposable'
  runId: runId
}

resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${prefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.42.0.0/16'] }
    subnets: [
      {
        name: 'containers'
        properties: {
          addressPrefix: '10.42.0.0/26'
          delegations: [{
            name: 'container-apps'
            properties: { serviceName: 'Microsoft.App/environments' }
          }]
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: '10.42.1.0/27'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource sqlEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: '${prefix}-sql-pe'
  location: location
  tags: tags
  properties: {
    subnet: { id: '${network.id}/subnets/private-endpoints' }
    privateLinkServiceConnections: [{
      name: 'sql'
      properties: {
        privateLinkServiceId: foundation.sqlServerId
        groupIds: ['sqlServer']
      }
    }]
  }
}

resource privateDns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink${az.environment().suffixes.sqlServerHostname}'
  location: 'global'
  tags: tags
}

resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: privateDns
  name: 'test-run'
  location: 'global'
  properties: {
    virtualNetwork: { id: network.id }
    registrationEnabled: false
  }
}

resource dnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: sqlEndpoint
  name: 'sql'
  properties: {
    privateDnsZoneConfigs: [{
      name: 'sql'
      properties: { privateDnsZoneId: privateDns.id }
    }]
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json('0.1') }
  }
}

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: '${prefix}-env'
  location: location
  tags: tags
  properties: {
    infrastructureResourceGroup: config.managedGroup
    zoneRedundant: false
    vnetConfiguration: {
      infrastructureSubnetId: '${network.id}/subnets/containers'
      internal: false
    }
    workloadProfiles: [{
      name: 'Consumption'
      workloadProfileType: 'Consumption'
    }]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'cittest${take(runId, 20)}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource registryRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for assignment in [
  { principalId: foundation.runtimePrincipalId, roleId: '7f951dda-4ed3-4680-a7ca-43fe172d538d' }
  { principalId: foundation.migratorPrincipalId, roleId: '7f951dda-4ed3-4680-a7ca-43fe172d538d' }
  { principalId: foundation.deployerPrincipalId, roleId: '8311e382-0749-4cb8-b61a-304f252e45ec' }
]: {
  name: guid(registry.id, assignment.principalId, assignment.roleId)
  scope: registry
  properties: {
    principalId: assignment.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', assignment.roleId)
  }
}]

resource migration 'Microsoft.App/jobs@2025-01-01' = if (!empty(migrationImage)) {
  name: '${prefix}-migrate'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${foundation.migratorIdentityId}': {} }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 900
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: [{
        server: registry.properties.loginServer
        identity: foundation.migratorIdentityId
      }]
    }
    template: {
      containers: [{
        name: 'migrate'
        image: migrationImage
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'TEST_SUBSCRIPTION_ID', value: subscriptionId }
          { name: 'TEST_RUN_GROUP', value: runGroupName }
          { name: 'SQL_SERVER', value: foundation.sqlFqdn }
          { name: 'SQL_DATABASE', value: foundation.databaseName }
          { name: 'AZURE_CLIENT_ID', value: foundation.migratorClientId }
          { name: 'RUNTIME_PRINCIPAL_ID', value: foundation.runtimePrincipalId }
          { name: 'RUNTIME_IDENTITY_NAME', value: foundation.runtimeIdentityName }
        ]
      }]
    }
  }
  dependsOn: [registryRoles, dnsGroup, dnsLink]
}

resource app 'Microsoft.App/containerApps@2025-01-01' = if (!empty(apiImage)) {
  name: '${prefix}-api'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${foundation.runtimeIdentityId}': {} }
  }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
        traffic: [{ latestRevision: true, weight: 100 }]
      }
      registries: [{
        server: registry.properties.loginServer
        identity: foundation.runtimeIdentityId
      }]
      secrets: [
        { name: 'auth-signing-key', keyVaultUrl: secretUris.signingKey, identity: foundation.runtimeIdentityId }
        { name: 'contacts-pepper', keyVaultUrl: secretUris.contactsPepper, identity: foundation.runtimeIdentityId }
        { name: 'test-invites', keyVaultUrl: secretUris.invitesJson, identity: foundation.runtimeIdentityId }
      ]
    }
    template: {
      containers: [{
        name: 'api'
        image: apiImage
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'ASPNETCORE_ENVIRONMENT', value: 'Test' }
          { name: 'DOTNET_ENVIRONMENT', value: 'Test' }
          { name: 'ASPNETCORE_URLS', value: 'http://+:8080' }
          { name: 'AZURE_CLIENT_ID', value: foundation.runtimeClientId }
          { name: 'Database__Provider', value: 'SqlServer' }
          { name: 'Database__ApplyMigrationsOnStartup', value: 'false' }
          { name: 'ConnectionStrings__Database', value: 'Server=tcp:${foundation.sqlFqdn},1433;Database=${foundation.databaseName};Authentication=Active Directory Managed Identity;User Id=${foundation.runtimeClientId};Encrypt=True;TrustServerCertificate=False;' }
          { name: 'Auth__SigningKey', secretRef: 'auth-signing-key' }
          { name: 'Contacts__Pepper', secretRef: 'contacts-pepper' }
          { name: 'TestMode__InvitesJson', secretRef: 'test-invites' }
          { name: 'SocialAuth__UseFake', value: 'false' }
          { name: 'TestMode__Enabled', value: 'true' }
          { name: 'TestMode__RoundSeconds', value: '120' }
          { name: 'Leaderboards__Provider', value: 'Database' }
          { name: 'Logging__LogLevel__Default', value: 'Warning' }
          { name: 'Logging__LogLevel__Microsoft.AspNetCore', value: 'Warning' }
        ]
        probes: [
          {
            type: 'Startup'
            httpGet: { path: '/health', port: 8080, scheme: 'HTTP' }
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 30
          }
          {
            type: 'Liveness'
            httpGet: { path: '/health', port: 8080, scheme: 'HTTP' }
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
          }
          {
            type: 'Readiness'
            httpGet: { path: '/health/ready', port: 8080, scheme: 'HTTP' }
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 3
          }
        ]
      }]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [{
          name: 'http'
          http: { metadata: { concurrentRequests: '10' } }
        }]
      }
    }
  }
  dependsOn: [registryRoles, dnsGroup, dnsLink]
}

output registryName string = registry.name
output registryServer string = registry.properties.loginServer
output migrationJobId string = !empty(migrationImage) ? migration!.id : ''
output appUrl string = !empty(apiImage) ? 'https://${app!.properties.configuration.ingress.fqdn}' : ''
