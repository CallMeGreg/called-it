using './run.bicep'

// Compilation fixture only. Lifecycle code supplies actual ARM-derived values and digests.
param location = 'centralus'
param runId = '00000000000000000000000000000000'
param submissionId = '00000000-0000-0000-0000-000000000000'
param foundation = {
  location: 'eastus2'
  workloadLocation: 'centralus'
  sqlServerId: '/subscriptions/b5ccc8c6-8222-4b70-83a3-3d7de1e5920f/resourceGroups/called-it-test-data/providers/Microsoft.Sql/servers/compile-only'
  sqlFqdn: 'compile-only.database.windows.net'
  databaseName: 'calledit'
  runtimeIdentityId: '/subscriptions/b5ccc8c6-8222-4b70-83a3-3d7de1e5920f/resourceGroups/called-it-test-data/providers/Microsoft.ManagedIdentity/userAssignedIdentities/called-it-test-runtime'
  runtimeIdentityName: 'called-it-test-runtime'
  runtimeClientId: '00000000-0000-0000-0000-000000000001'
  runtimePrincipalId: '00000000-0000-0000-0000-000000000002'
  migratorIdentityId: '/subscriptions/b5ccc8c6-8222-4b70-83a3-3d7de1e5920f/resourceGroups/called-it-test-data/providers/Microsoft.ManagedIdentity/userAssignedIdentities/called-it-test-migrator'
  migratorClientId: '00000000-0000-0000-0000-000000000003'
  migratorPrincipalId: '00000000-0000-0000-0000-000000000004'
  deployerPrincipalId: '00000000-0000-0000-0000-000000000005'
}
