using CalledIt.Domain;

namespace CalledIt.Application.Questions;

public sealed record CreateQuestionCommand(
    string CategoryCode,
    string Text,
    string SideALabel,
    string SideBLabel,
    string ResolutionSourceKey,
    string ResolutionRule,
    DateTimeOffset ResolvesAt);

public sealed record QuestionView(
    Guid Id,
    string CategoryCode,
    string Text,
    string SideALabel,
    string SideBLabel,
    string Status,
    string Outcome,
    string OutcomeSource,
    DateTimeOffset ResolvesAt);

public sealed record DailySetQuestionView(
    Guid QuestionId,
    string CategoryCode,
    string CategoryName,
    string Text,
    string SideALabel,
    string SideBLabel,
    Side? MyPick,
    bool MySkip,
    string Outcome);

public sealed record DailySetView(
    Guid Id,
    DateTimeOffset DropAtUtc,
    DateTimeOffset LocksAtUtc,
    bool IsOpen,
    IReadOnlyList<DailySetQuestionView> Questions);
