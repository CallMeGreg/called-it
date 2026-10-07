using './main.bicep'

param environmentName = 'dev'
param namePrefix = readEnvironmentVariable('AZURE_NAME_PREFIX', 'calledit')
param location = readEnvironmentVariable('AZURE_LOCATION')
param sqlEntraAdminObjectId = readEnvironmentVariable('SQL_ENTRA_ADMIN_OBJECT_ID')
param sqlEntraAdminLogin = readEnvironmentVariable('SQL_ENTRA_ADMIN_LOGIN')
param sqlEntraAdminPrincipalType = readEnvironmentVariable('SQL_ENTRA_ADMIN_PRINCIPAL_TYPE', 'Group')
param sqlAllowedClientIps = json(readEnvironmentVariable('SQL_ALLOWED_CLIENT_IPS', '[]'))

// Review these hypotheses with a current quote and measurements before provisioning.
param sqlMaxVcores = 1
param sqlMinVcores = '0.5'
param sqlAutoPauseDelay = -1
param sqlMaxSizeGb = 5
param logDailyCapGb = '0.1'
