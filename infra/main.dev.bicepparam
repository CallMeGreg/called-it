using './main.bicep'

param environmentName = 'dev'

// SQL admin (password comes from a CI secret / environment variable, never source).
param sqlAdministratorLogin = 'calleditadmin'
param sqlAdministratorPassword = readEnvironmentVariable('SQL_ADMIN_PASSWORD', '')

// Optional Entra admin for managed-identity SQL access.
param sqlAadAdminObjectId = readEnvironmentVariable('SQL_AAD_ADMIN_OBJECT_ID', '')
param sqlAadAdminLogin = readEnvironmentVariable('SQL_AAD_ADMIN_LOGIN', '')

// App secrets (supplied by CI from Key Vault / GitHub secrets).
param authSigningKey = readEnvironmentVariable('AUTH_SIGNING_KEY', '')
param contactsPepper = readEnvironmentVariable('CONTACTS_PEPPER', '')

// SMS sender number (empty until an ACS number is purchased — dev SMS is used meanwhile).
param acsFromNumber = readEnvironmentVariable('ACS_FROM_NUMBER', '')

param adminBootstrapPhones = [ '+15555550100' ]

// Images (CD passes the freshly built, tagged images).
param apiImage = readEnvironmentVariable('API_IMAGE', 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest')
param workersImage = readEnvironmentVariable('WORKERS_IMAGE', 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest')

// Sizing — smallest footprint for dev.
param acrSku = 'Basic'
param redisSkuName = 'Balanced_B0'
param redisHighAvailability = false
param minReplicas = 1
param maxReplicas = 2
