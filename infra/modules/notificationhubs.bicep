// Azure Notification Hubs — fan-out to APNs for the daily-drop broadcast and reminders.
// APNs credentials are configured out-of-band (see the manual-setup issue). The namespace-level
// connection string (with Listen+Send) is returned for injection as a Container App secret.
@description('Azure region for the resources.')
param location string

@description('Globally-unique Notification Hubs namespace name.')
param namespaceName string

@description('Notification hub name.')
param hubName string

@description('Tags applied to every resource.')
param tags object

resource namespace 'Microsoft.NotificationHubs/namespaces@2023-09-01' = {
  name: namespaceName
  location: location
  tags: tags
  sku: {
    name: 'Free'
  }
  properties: {}
}

resource hub 'Microsoft.NotificationHubs/namespaces/notificationHubs@2023-09-01' = {
  parent: namespace
  name: hubName
  location: location
  properties: {}
}

resource sendListenRule 'Microsoft.NotificationHubs/namespaces/notificationHubs/authorizationRules@2023-09-01' = {
  parent: hub
  name: 'AppServerSendListen'
  properties: {
    rights: [
      'Listen'
      'Send'
    ]
  }
}

output namespaceName string = namespace.name
output hubName string = hub.name
#disable-next-line outputs-should-not-contain-secrets
output connectionString string = sendListenRule.listKeys().primaryConnectionString
