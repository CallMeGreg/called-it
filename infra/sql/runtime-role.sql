-- Reviewed by a database owner after migrations. This does not create or enroll a runtime user.
-- Grant membership only to the separately provisioned runtime principal, never the migrator.
IF DATABASE_PRINCIPAL_ID(N'calledit_runtime') IS NULL
    CREATE ROLE [calledit_runtime] AUTHORIZATION [dbo];

GRANT SELECT ON OBJECT::[dbo].[Categories] TO [calledit_runtime];
GRANT SELECT ON OBJECT::[dbo].[ResolutionSources] TO [calledit_runtime];

GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Users] TO [calledit_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[FederatedIdentities] TO [calledit_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Devices] TO [calledit_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Friendships] TO [calledit_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Leagues] TO [calledit_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[LeagueMemberships] TO [calledit_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Questions] TO [calledit_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[DailySets] TO [calledit_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[DailySetItems] TO [calledit_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Guesses] TO [calledit_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Streaks] TO [calledit_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Scores] TO [calledit_runtime];
GRANT SELECT, INSERT ON OBJECT::[dbo].[AuditLogs] TO [calledit_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[OtpChallenges] TO [calledit_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[RefreshTokens] TO [calledit_runtime];
