using './main.bicep'

param environmentName = 'prod'

// SQL admin (password comes from a CI secret / environment variable, never source).
param sqlAdministratorLogin = 'calleditadmin'
param sqlAdministratorPassword = readEnvironmentVariable('SQL_ADMIN_PASSWORD', '')

// Entra admin for managed-identity SQL access (strongly recommended in production).
param sqlAadAdminObjectId = readEnvironmentVariable('SQL_AAD_ADMIN_OBJECT_ID', '')
param sqlAadAdminLogin = readEnvironmentVariable('SQL_AAD_ADMIN_LOGIN', '')

// After the one-time managed-identity contained-user step (see infra/README.md), set
// SQL_AAD_ONLY_AUTH=true to disable SQL-auth logins so only Entra identities can connect.
// Leave false for the very first deploy (before the contained user exists) to avoid lockout.
param sqlAadOnlyAuthentication = toLower(readEnvironmentVariable('SQL_AAD_ONLY_AUTH', 'false')) == 'true'

// App secrets (supplied by CI from Key Vault / GitHub secrets).
param authSigningKey = readEnvironmentVariable('AUTH_SIGNING_KEY', '')
param contactsPepper = readEnvironmentVariable('CONTACTS_PEPPER', '')

// SMS sender number in E.164 (must be a provisioned ACS number in production).
param acsFromNumber = readEnvironmentVariable('ACS_FROM_NUMBER', '')

// Set the real admin phone numbers via CI (comma-free JSON) or edit here.
param adminBootstrapPhones = []

// Images (CD passes the freshly built, tagged images).
param apiImage = readEnvironmentVariable('API_IMAGE', 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest')
param workersImage = readEnvironmentVariable('WORKERS_IMAGE', 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest')

// Sizing — resilient footprint for production.
param acrSku = 'Standard'
param redisSkuName = 'Standard'
param redisSkuFamily = 'C'
param redisSkuCapacity = 1
param minReplicas = 2
param maxReplicas = 10
