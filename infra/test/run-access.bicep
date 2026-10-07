param deployerPrincipalId string
param runtimePrincipalId string
param migratorPrincipalId string
param cleanupPrincipalId string
param cleanupRoleId string

var contributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')
var rbacAdminRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'f58310d9-a9f6-439a-9e8d-f62e7b41a168')

resource deployer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, deployerPrincipalId, contributorRole)
  properties: {
    principalId: deployerPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: contributorRole
  }
}

// Only ACR data roles for the three known principals can be assigned or removed.
var roleCondition = '''
(
  (!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'}))
  OR
  (
    @Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {7f951dda-4ed3-4680-a7ca-43fe172d538d, 8311e382-0749-4cb8-b61a-304f252e45ec}
    AND
    @Request[Microsoft.Authorization/roleAssignments:PrincipalId] ForAnyOfAnyValues:GuidEquals {RUNTIME, MIGRATOR, DEPLOYER}
  )
)
AND
(
  (!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'}))
  OR
  (
    @Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {7f951dda-4ed3-4680-a7ca-43fe172d538d, 8311e382-0749-4cb8-b61a-304f252e45ec}
    AND
    @Resource[Microsoft.Authorization/roleAssignments:PrincipalId] ForAnyOfAnyValues:GuidEquals {RUNTIME, MIGRATOR, DEPLOYER}
  )
)
'''

resource registryRoleManager 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, deployerPrincipalId, rbacAdminRole)
  properties: {
    principalId: deployerPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: rbacAdminRole
    conditionVersion: '2.0'
    condition: replace(replace(replace(roleCondition, 'RUNTIME', runtimePrincipalId), 'MIGRATOR', migratorPrincipalId), 'DEPLOYER', deployerPrincipalId)
  }
}

resource cleanup 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, cleanupPrincipalId, cleanupRoleId)
  properties: {
    principalId: cleanupPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: cleanupRoleId
  }
}
