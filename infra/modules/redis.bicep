// Azure Cache for Redis — leaderboards (Sorted Sets) + hot cache. The primary connection string is
// returned so the composition root can inject it as a Container App secret.
@description('Azure region for the resources.')
param location string

@description('Globally-unique Redis name.')
param redisName string

@description('Tags applied to every resource.')
param tags object

@description('Redis SKU family/name.')
@allowed([ 'Basic', 'Standard', 'Premium' ])
param skuName string = 'Basic'

@description('Redis SKU family (C = Basic/Standard, P = Premium).')
@allowed([ 'C', 'P' ])
param skuFamily string = 'C'

@description('Redis capacity (0-6).')
param skuCapacity int = 0

resource redis 'Microsoft.Cache/redis@2023-08-01' = {
  name: redisName
  location: location
  tags: tags
  properties: {
    sku: {
      name: skuName
      family: skuFamily
      capacity: skuCapacity
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    redisVersion: '6'
  }
}

output name string = redis.name
output hostName string = redis.properties.hostName
#disable-next-line outputs-should-not-contain-secrets
output connectionString string = '${redis.properties.hostName}:6380,password=${redis.listKeys().primaryKey},ssl=True,abortConnect=False'
