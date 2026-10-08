param location string
param sqlServerName string
param databaseName string
param tags object
param entraAdminObjectId string
param entraAdminLogin string
@allowed([ 'Group', 'User', 'Application' ])
param entraAdminPrincipalType string = 'Group'
@allowed([ 1, 2 ])
param maxVcores int = 1
@allowed([ '0.5', '1' ])
param minVcores string = '0.5'
@allowed([ -1, 60 ])
param autoPauseDelay int = -1
@allowed([ 5, 10, 20, 32 ])
param maxSizeGb int = 5
param allowedClientIps string[] = []

resource sqlServer 'Microsoft.Sql/servers@2023-08-01' = {
  name: sqlServerName
  location: location
  tags: tags
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      login: entraAdminLogin
      sid: entraAdminObjectId
      tenantId: tenant().tenantId
      principalType: entraAdminPrincipalType
      azureADOnlyAuthentication: true
    }
  }
}

// Empty by default. Container Apps egress is not stable without a deliberately designed network.
resource clientRules 'Microsoft.Sql/servers/firewallRules@2023-08-01' = [for ip in allowedClientIps: {
  parent: sqlServer
  name: 'client-${replace(ip, '.', '-')}'
  properties: {
    startIpAddress: ip
    endIpAddress: ip
  }
}]

resource database 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sqlServer
  name: databaseName
  location: location
  tags: tags
  sku: {
    name: 'GP_S_Gen5_${maxVcores}'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: maxVcores
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    autoPauseDelay: autoPauseDelay
    minCapacity: json(minVcores)
    maxSizeBytes: maxSizeGb * 1024 * 1024 * 1024
    requestedBackupStorageRedundancy: 'Local'
    zoneRedundant: false
  }
}

resource shortTermRetention 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies@2023-08-01' = {
  parent: database
  name: 'default'
  properties: {
    retentionDays: 7
  }
}

output serverName string = sqlServer.name
output serverFqdn string = sqlServer.properties.fullyQualifiedDomainName
output databaseName string = database.name
