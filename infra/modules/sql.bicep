// Azure SQL Database — the system of record. Provisioned with SQL auth for a working baseline and,
// when an Entra admin object id is supplied, an Entra admin so the apps can connect via managed
// identity (recommended — see infra/README.md for the one-time contained-user step).
@description('Azure region for the resources.')
param location string

@description('Globally-unique logical SQL server name.')
param sqlServerName string

@description('SQL database name.')
param databaseName string

@description('Tags applied to every resource.')
param tags object

@description('SQL administrator login.')
param administratorLogin string

@description('SQL administrator password.')
@secure()
param administratorPassword string

@description('Optional Entra (AAD) admin object id to set as SQL AD admin. Empty to skip.')
param aadAdminObjectId string = ''

@description('Display name/login for the Entra SQL admin (when object id is provided).')
param aadAdminLogin string = ''

@description('When true (and an Entra admin is set), disable SQL-auth logins so only Entra identities can connect. Recommended for production once the managed-identity contained user exists.')
param aadOnlyAuthentication bool = false

@description('Enable Microsoft Defender for SQL (advanced threat protection) on the server.')
param enableDefender bool = true

@description('Database SKU name, e.g. GP_S_Gen5_1 (serverless) or S0.')
param skuName string = 'GP_S_Gen5_1'

@description('Database SKU tier.')
param skuTier string = 'GeneralPurpose'

var hasAadAdmin = !empty(aadAdminObjectId)

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  tags: tags
  properties: {
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: hasAadAdmin ? {
      administratorType: 'ActiveDirectory'
      login: aadAdminLogin
      sid: aadAdminObjectId
      tenantId: tenant().tenantId
      principalType: 'User'
      azureADOnlyAuthentication: aadOnlyAuthentication
    } : null
  }
}

// Microsoft Defender for SQL — anomalous-login, SQL-injection, and data-exfiltration threat alerts.
resource defenderForSql 'Microsoft.Sql/servers/securityAlertPolicies@2023-08-01-preview' = if (enableDefender) {
  parent: sqlServer
  name: 'Default'
  properties: {
    state: 'Enabled'
  }
}

// Allow other Azure services (e.g. Container Apps, which have no stable egress IP without a VNet) to
// reach the server. NOTE: the 0.0.0.0 rule is the "Allow Azure services" toggle — it permits any
// Azure-hosted resource, not just ours. Prefer a Private Endpoint + VNet integration and
// publicNetworkAccess:'Disabled' for production; Defender for SQL + Entra-only auth mitigate the
// residual exposure until then.
resource allowAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAllAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: databaseName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    autoPauseDelay: 60
    minCapacity: json('0.5')
    maxSizeBytes: 34359738368
  }
}

output serverFqdn string = sqlServer.properties.fullyQualifiedDomainName
output databaseName string = database.name
