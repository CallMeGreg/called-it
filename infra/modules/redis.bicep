// Azure Managed Redis (Microsoft.Cache/redisEnterprise) — leaderboards (Sorted Sets) + hot cache.
// Replaces the retired classic Azure Cache for Redis. Azure blocks new classic caches, so we provision
// the Enterprise-based Managed Redis: a cluster plus its required single 'default' database, exposed on
// port 10000. The primary connection string is returned so the composition root can inject it as a
// Container App secret.
@description('Azure region for the resources.')
param location string

@description('Globally-unique Azure Managed Redis cluster name.')
param redisName string

@description('Tags applied to every resource.')
param tags object

@description('Azure Managed Redis SKU, e.g. Balanced_B0 (smallest) through the Balanced/MemoryOptimized/ComputeOptimized tiers.')
param skuName string = 'Balanced_B0'

@description('Replicate the dataset for higher availability (recommended for production; disable to lower dev/test cost).')
param highAvailability bool = false

resource redis 'Microsoft.Cache/redisEnterprise@2025-04-01' = {
  name: redisName
  location: location
  tags: tags
  sku: {
    name: skuName
  }
  properties: {
    minimumTlsVersion: '1.2'
    highAvailability: highAvailability ? 'Enabled' : 'Disabled'
  }
}

// Azure Managed Redis requires a single child database named 'default'. EnterpriseCluster keeps one
// logical endpoint (no client-side cluster awareness) so the non-clustered StackExchange.Redis client
// connects exactly as it did to the classic single-node cache.
resource redisDatabase 'Microsoft.Cache/redisEnterprise/databases@2025-04-01' = {
  parent: redis
  name: 'default'
  properties: {
    clientProtocol: 'Encrypted'
    clusteringPolicy: 'EnterpriseCluster'
    evictionPolicy: 'VolatileLRU'
    port: 10000
  }
}

output name string = redis.name
output hostName string = redis.properties.hostName
#disable-next-line outputs-should-not-contain-secrets
output connectionString string = '${redis.properties.hostName}:10000,password=${redisDatabase.listKeys().primaryKey},ssl=True,abortConnect=False'
