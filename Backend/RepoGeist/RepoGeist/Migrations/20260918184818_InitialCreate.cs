using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepoGeist.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Contributors",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GithubUsername = table.Column<string>(type: "text", nullable: false),
                    AvatarUrl = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Contributors", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Repos",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Owner = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    Topics = table.Column<List<string>>(type: "text[]", nullable: false),
                    PrimaryLanguage = table.Column<string>(type: "text", nullable: true),
                    Stars = table.Column<int>(type: "integer", nullable: false),
                    Forks = table.Column<int>(type: "integer", nullable: false),
                    LiveDemoUrl = table.Column<string>(type: "text", nullable: true),
                    EntryPointPath = table.Column<string>(type: "text", nullable: true),
                    DependencyGraphJson = table.Column<string>(type: "jsonb", nullable: true),
                    LastSyncedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Repos", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "AnalysisJobs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RepoId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ErrorMessage = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AnalysisJobs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AnalysisJobs_Repos_RepoId",
                        column: x => x.RepoId,
                        principalTable: "Repos",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CommitActivities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RepoId = table.Column<Guid>(type: "uuid", nullable: false),
                    WeekStart = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CommitCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CommitActivities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CommitActivities_Repos_RepoId",
                        column: x => x.RepoId,
                        principalTable: "Repos",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GraphNodes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RepoId = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeType = table.Column<string>(type: "text", nullable: false),
                    PathOrName = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GraphNodes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GraphNodes_Repos_RepoId",
                        column: x => x.RepoId,
                        principalTable: "Repos",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "HealthChecks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RepoId = table.Column<Guid>(type: "uuid", nullable: false),
                    CheckedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    ResponseTimeMs = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HealthChecks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HealthChecks_Repos_RepoId",
                        column: x => x.RepoId,
                        principalTable: "Repos",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "LanguageStats",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RepoId = table.Column<Guid>(type: "uuid", nullable: false),
                    Language = table.Column<string>(type: "text", nullable: false),
                    ByteCount = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LanguageStats", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LanguageStats_Repos_RepoId",
                        column: x => x.RepoId,
                        principalTable: "Repos",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RepoContributors",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RepoId = table.Column<Guid>(type: "uuid", nullable: false),
                    ContributorId = table.Column<Guid>(type: "uuid", nullable: false),
                    CommitCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RepoContributors", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RepoContributors_Contributors_ContributorId",
                        column: x => x.ContributorId,
                        principalTable: "Contributors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RepoContributors_Repos_RepoId",
                        column: x => x.RepoId,
                        principalTable: "Repos",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GraphEdges",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RepoId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceNodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    TargetNodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    EdgeType = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GraphEdges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GraphEdges_GraphNodes_SourceNodeId",
                        column: x => x.SourceNodeId,
                        principalTable: "GraphNodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GraphEdges_GraphNodes_TargetNodeId",
                        column: x => x.TargetNodeId,
                        principalTable: "GraphNodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GraphEdges_Repos_RepoId",
                        column: x => x.RepoId,
                        principalTable: "Repos",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AnalysisJobs_RepoId",
                table: "AnalysisJobs",
                column: "RepoId");

            migrationBuilder.CreateIndex(
                name: "IX_CommitActivities_RepoId_WeekStart",
                table: "CommitActivities",
                columns: new[] { "RepoId", "WeekStart" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Contributors_GithubUsername",
                table: "Contributors",
                column: "GithubUsername",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GraphEdges_RepoId",
                table: "GraphEdges",
                column: "RepoId");

            migrationBuilder.CreateIndex(
                name: "IX_GraphEdges_SourceNodeId",
                table: "GraphEdges",
                column: "SourceNodeId");

            migrationBuilder.CreateIndex(
                name: "IX_GraphEdges_TargetNodeId",
                table: "GraphEdges",
                column: "TargetNodeId");

            migrationBuilder.CreateIndex(
                name: "IX_GraphNodes_RepoId",
                table: "GraphNodes",
                column: "RepoId");

            migrationBuilder.CreateIndex(
                name: "IX_HealthChecks_RepoId_CheckedAt",
                table: "HealthChecks",
                columns: new[] { "RepoId", "CheckedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_LanguageStats_RepoId",
                table: "LanguageStats",
                column: "RepoId");

            migrationBuilder.CreateIndex(
                name: "IX_RepoContributors_ContributorId",
                table: "RepoContributors",
                column: "ContributorId");

            migrationBuilder.CreateIndex(
                name: "IX_RepoContributors_RepoId_ContributorId",
                table: "RepoContributors",
                columns: new[] { "RepoId", "ContributorId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Repos_Owner_Name",
                table: "Repos",
                columns: new[] { "Owner", "Name" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AnalysisJobs");

            migrationBuilder.DropTable(
                name: "CommitActivities");

            migrationBuilder.DropTable(
                name: "GraphEdges");

            migrationBuilder.DropTable(
                name: "HealthChecks");

            migrationBuilder.DropTable(
                name: "LanguageStats");

            migrationBuilder.DropTable(
                name: "RepoContributors");

            migrationBuilder.DropTable(
                name: "GraphNodes");

            migrationBuilder.DropTable(
                name: "Contributors");

            migrationBuilder.DropTable(
                name: "Repos");
        }
    }
}
