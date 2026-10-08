targetScope = 'resourceGroup'

@allowed([ 'dev', 'prod' ])
param environmentName string
param location string
param apiName string
param workersName string
param environmentId string
param identityId string
param identityClientId string
param registryServer string
param sqlServerFqdn string
param databaseName string

@description('New suffix for each rollout, including rollback/secret rotation; never reuse an existing revision name.')
@minLength(1)
@maxLength(28)
param revisionSuffix string

@description('Required immutable API digest reference in the foundation registry.')
@minLength(71)
param apiImage string
@description('Required immutable worker digest reference in the foundation registry.')
@minLength(71)
param workersImage string

@description('Versioned Key Vault secret URI, not a secret value.')
@minLength(1)
param authSigningKeySecretUri string
@minLength(1)
param contactsPepperSecretUri string
@minLength(1)
param appleAudience string
@minLength(1)
param googleAudience string

@description('NotificationHubs requires an existing, intentionally configured hub and a versioned credential secret.')
@allowed([ 'Disabled', 'NotificationHubs' ])
param pushProvider string = 'Disabled'
param notificationHubName string = ''
param notificationHubConnectionSecretUri string = ''

@minValue(1)
@maxValue(3)
param apiMinReplicas int = 1
@minValue(1)
@maxValue(3)
param apiMaxReplicas int = 2
@minValue(1)
@maxValue(100)
param apiHttpConcurrentRequests int = 20

@allowed([ 1 ])
param workerMinReplicas int = 1
@allowed([ 1 ])
param workerMaxReplicas int = 1

var tags = {
  application: 'called-it'
  environment: environmentName
  managedBy: 'bicep'
}
var commonEnv = concat([
  { name: 'ASPNETCORE_ENVIRONMENT', value: 'Production' }
  { name: 'DOTNET_ENVIRONMENT', value: 'Production' }
  { name: 'AZURE_CLIENT_ID', value: identityClientId }
  { name: 'Database__Provider', value: 'SqlServer' }
  {
    name: 'ConnectionStrings__Database'
    value: 'Server=tcp:${sqlServerFqdn},1433;Database=${databaseName};Authentication=Active Directory Managed Identity;User Id=${identityClientId};Encrypt=True;TrustServerCertificate=False;'
  }
  { name: 'Auth__Issuer', value: 'called-it' }
  { name: 'Auth__Audience', value: 'called-it-clients' }
  { name: 'SocialAuth__UseFake', value: 'false' }
  { name: 'SocialAuth__AppleAudience', value: appleAudience }
  { name: 'SocialAuth__GoogleAudience', value: googleAudience }
  { name: 'Sms__Provider', value: 'Disabled' }
  { name: 'Push__Provider', value: pushProvider }
  { name: 'Resolution__UseStub', value: 'false' }
  { name: 'Workers__EnableDailySetBuilder', value: 'false' }
  { name: 'Workers__EnableResolver', value: 'false' }
  { name: 'Workers__EnableWindowClosing', value: 'false' }
], pushProvider == 'NotificationHubs' ? [
  { name: 'NotificationHubs__HubName', value: notificationHubName }
] : [])

var commonSecrets = concat([
  { name: 'auth-signing-key', envName: 'Auth__SigningKey', keyVaultUrl: authSigningKeySecretUri }
  { name: 'contacts-pepper', envName: 'Contacts__Pepper', keyVaultUrl: contactsPepperSecretUri }
], pushProvider == 'NotificationHubs' ? [
  { name: 'notification-hub', envName: 'NotificationHubs__ConnectionString', keyVaultUrl: notificationHubConnectionSecretUri }
] : [])

module apiApp 'modules/containerapp.bicep' = {
  name: 'apiApp'
  params: {
    location: location
    name: apiName
    tags: tags
    environmentId: environmentId
    identityId: identityId
    registryServer: registryServer
    image: apiImage
    revisionSuffix: revisionSuffix
    externalIngress: true
    envVars: concat(commonEnv, [
      { name: 'ASPNETCORE_URLS', value: 'http://+:8080' }
    ])
    secretReferences: commonSecrets
    minReplicas: apiMinReplicas
    maxReplicas: apiMaxReplicas
    httpConcurrentRequests: apiHttpConcurrentRequests
  }
}

module workersApp 'modules/containerapp.bicep' = {
  name: 'workersApp'
  params: {
    location: location
    name: workersName
    tags: tags
    environmentId: environmentId
    identityId: identityId
    registryServer: registryServer
    image: workersImage
    revisionSuffix: revisionSuffix
    externalIngress: false
    envVars: commonEnv
    secretReferences: commonSecrets
    minReplicas: workerMinReplicas
    maxReplicas: workerMaxReplicas
  }
}

output apiName string = apiApp.outputs.name
output workersName string = workersApp.outputs.name
