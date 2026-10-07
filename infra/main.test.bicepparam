using './main.test.bicep'

param location = 'eastus2'
param workloadLocation = 'centralus'
param operatorObjectId = readEnvironmentVariable('TEST_OPERATOR_OBJECT_ID', 'a0c9ea2c-f6b4-4a19-8821-b991ad99aeca')
