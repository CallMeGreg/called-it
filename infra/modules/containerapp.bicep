// Reusable Container App used for both the API (external ingress) and the Workers (no ingress).
// Pulls images from ACR and authenticates to Azure using the shared user-assigned identity.
@description('Azure region for the resources.')
param location string

@description('Container app name.')
param name string

@description('Tags applied to every resource.')
param tags object

@description('Container Apps managed environment id.')
param environmentId string

@description('Resource id of the user-assigned identity.')
param identityId string

@description('ACR login server, e.g. myregistry.azurecr.io.')
param registryServer string

@description('Fully-qualified container image reference.')
param image string

@description('Whether to expose external ingress (true for the API, false for Workers).')
param externalIngress bool

@description('Container listening port (used when ingress is enabled).')
param targetPort int = 8080

@description('Plain (non-secret) environment variables: array of { name, value }.')
param envVars array = []

@description('Secret environment variables: array of { name, envName, value } materialised as app secrets.')
param secrets array = []

@description('Minimum replica count.')
param minReplicas int = 1

@description('Maximum replica count.')
param maxReplicas int = 3

// Turn the secret list into container-app secret definitions and secretRef env vars.
var secretDefinitions = [for s in secrets: {
  name: s.name
  value: s.value
}]

var secretEnvRefs = [for s in secrets: {
  name: s.envName
  secretRef: s.name
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
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: externalIngress ? {
        external: true
        targetPort: targetPort
        transport: 'auto'
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
      secrets: secretDefinitions
    }
    template: {
      containers: [
        {
          name: name
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: concat(envVars, secretEnvRefs)
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output fqdn string = externalIngress ? containerApp.properties.configuration.ingress.fqdn : ''
output name string = containerApp.name
