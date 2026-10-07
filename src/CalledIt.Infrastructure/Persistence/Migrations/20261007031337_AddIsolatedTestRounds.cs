using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CalledIt.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddIsolatedTestRounds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Users_PhoneE164",
                table: "Users");

            migrationBuilder.AlterColumn<string>(
                name: "PhoneHash",
                table: "Users",
                type: "nvarchar(128)",
                maxLength: 128,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(128)",
                oldMaxLength: 128);

            migrationBuilder.AlterColumn<string>(
                name: "PhoneE164",
                table: "Users",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(20)",
                oldMaxLength: 20);

            migrationBuilder.AddColumn<string>(
                name: "TestInviteId",
                table: "Users",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsTest",
                table: "DailySets",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "TestModeLocks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TestModeLocks", x => x.Id);
                    table.CheckConstraint("CK_TestModeLocks_Singleton", "[Id] = 1");
                });

            migrationBuilder.InsertData(
                table: "TestModeLocks",
                columns: new[] { "Id", "Version" },
                values: new object[] { 1, 0L });

            migrationBuilder.CreateIndex(
                name: "IX_Users_PhoneE164",
                table: "Users",
                column: "PhoneE164",
                unique: true,
                filter: "[PhoneE164] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Users_TestInviteId",
                table: "Users",
                column: "TestInviteId",
                unique: true,
                filter: "[TestInviteId] IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_Identity",
                table: "Users",
                sql: "([TestInviteId] IS NULL AND [PhoneE164] IS NOT NULL AND [PhoneHash] IS NOT NULL) OR ([TestInviteId] IS NOT NULL AND [PhoneE164] IS NULL AND [PhoneHash] IS NULL AND [IsAdmin] = 0 AND [DiscoverableByPhone] = 0)");

            migrationBuilder.CreateIndex(
                name: "IX_DailySets_IsTest",
                table: "DailySets",
                column: "IsTest",
                unique: true,
                filter: "[IsTest] = 1 AND [Status] = 1");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "IF EXISTS (SELECT 1 FROM [Users] WHERE [TestInviteId] IS NOT NULL) "
                + "OR EXISTS (SELECT 1 FROM [DailySets] WHERE [IsTest] = 1) "
                + "THROW 51000, 'Remove isolated TEST data explicitly before reverting the TEST schema.', 1;");

            migrationBuilder.DropTable(
                name: "TestModeLocks");

            migrationBuilder.DropIndex(
                name: "IX_Users_PhoneE164",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_Users_TestInviteId",
                table: "Users");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Users_Identity",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_DailySets_IsTest",
                table: "DailySets");

            migrationBuilder.DropColumn(
                name: "TestInviteId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "IsTest",
                table: "DailySets");

            migrationBuilder.AlterColumn<string>(
                name: "PhoneHash",
                table: "Users",
                type: "nvarchar(128)",
                maxLength: 128,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "nvarchar(128)",
                oldMaxLength: 128,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "PhoneE164",
                table: "Users",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "nvarchar(20)",
                oldMaxLength: 20,
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_PhoneE164",
                table: "Users",
                column: "PhoneE164",
                unique: true);
        }
    }
}
