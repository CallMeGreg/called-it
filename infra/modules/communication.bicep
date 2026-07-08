// Azure Communication Services — SMS one-time passcodes. A sender phone number must be provisioned
// separately (data-plane, see the manual-setup issue). The connection string is returned for
// injection as a Container App secret.
@description('Globally-unique Communication Services resource name.')
param communicationName string

@description('Tags applied to every resource.')
param tags object

@description('Data residency location for the ACS resource.')
param dataLocation string = 'United States'

resource communication 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: communicationName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: dataLocation
  }
}

output name string = communication.name
#disable-next-line outputs-should-not-contain-secrets
output connectionString string = communication.listKeys().primaryConnectionString
