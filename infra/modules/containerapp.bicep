param location string
param name string
param tags object
param environmentId string
param identityId string
param registryServer string

@description('Explicit registry/repository@sha256:digest, validated by deployment preflight. No image default.')
@minLength(71)
param image string

@minLength(1)
@maxLength(28)
param revisionSuffix string

param externalIngress bool

type environmentVariable = {
  name: string
  value: string
}
type secretReference = {
  name: string
  envName: string
  keyVaultUrl: string
}

param envVars environmentVariable[]
param secretReferences secretReference[]

@minValue(1)
@maxValue(3)
param minReplicas int = 1

@minValue(1)
@maxValue(3)
param maxReplicas int = 2

@minValue(1)
@maxValue(100)
param httpConcurrentRequests int = 20

var secretEnvRefs = [for secret in secretReferences: {
  name: secret.envName
  secretRef: secret.name
}]

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: externalIngress ? {
        external: true
        targetPort: 8080
        transport: 'http'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      } : null
      registries: [
        {
          server: registryServer
          identity: identityId
        }
      ]
      secrets: [for secret in secretReferences: {
        name: secret.name
        keyVaultUrl: secret.keyVaultUrl
        identity: identityId
      }]
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          name: name
          image: image
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: concat(envVars, secretEnvRefs)
          probes: externalIngress ? [
            {
              type: 'Startup'
              httpGet: {
                path: '/health/live'
                port: 8080
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 30
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/health/live'
                port: 8080
                scheme: 'HTTP'
              }
              periodSeconds: 30
              timeoutSeconds: 3
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health/ready'
                port: 8080
                scheme: 'HTTP'
              }
              periodSeconds: 10
              timeoutSeconds: 10
              failureThreshold: 3
            }
          ] : []
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: externalIngress ? [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: string(httpConcurrentRequests)
              }
            }
          }
        ] : []
      }
    }
  }
}

output name string = containerApp.name
