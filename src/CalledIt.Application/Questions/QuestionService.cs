using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Domain;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CalledIt.Application.Questions;

/// <summary>
/// Admin authoring for the question bank. Enforces the "auto-resolvable by default" rule:
/// a question cannot be created without a machine-readable resolution source + rule.
/// </summary>
public sealed class QuestionService
{
    private readonly IAppDbContext _db;
    private readonly IClock _clock;

    public QuestionService(IAppDbContext db, IClock clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<QuestionView> CreateAsync(CreateQuestionCommand cmd, CancellationToken ct = default)
    {
        if (!Categories.IsValid(cmd.CategoryCode))
        {
            throw new ValidationException($"Unknown category '{cmd.CategoryCode}'.");
        }

        if (string.IsNullOrWhiteSpace(cmd.ResolutionSourceKey) || string.IsNullOrWhiteSpace(cmd.ResolutionRule))
        {
            throw new ValidationException(
                "A question must declare a resolution source and rule (auto-resolvable by default).");
        }

        if (string.IsNullOrWhiteSpace(cmd.Text))
        {
            throw new ValidationException("Question text is required.");
        }

        var category = await GetCategoryAsync(cmd.CategoryCode, ct);

        var question = new Question
        {
            CategoryId = category.Id,
            Text = cmd.Text.Trim(),
            SideALabel = string.IsNullOrWhiteSpace(cmd.SideALabel) ? "Yes" : cmd.SideALabel.Trim(),
            SideBLabel = string.IsNullOrWhiteSpace(cmd.SideBLabel) ? "No" : cmd.SideBLabel.Trim(),
            AnswerType = AnswerType.Binary,
            ResolutionSourceKey = cmd.ResolutionSourceKey.Trim(),
            ResolutionRule = cmd.ResolutionRule.Trim(),
            ResolvesAt = cmd.ResolvesAt,
            Status = QuestionStatus.Approved,
        };

        _db.Questions.Add(question);
        await _db.SaveChangesAsync(ct);

        return ToView(question, cmd.CategoryCode);
    }

    public async Task<IReadOnlyList<QuestionView>> ListAsync(QuestionStatus? status, CancellationToken ct = default)
    {
        var query = _db.Questions.Include(q => q.Category).AsQueryable();
        if (status is { } s)
        {
            query = query.Where(q => q.Status == s);
        }

        var rows = await query.OrderByDescending(q => q.ResolvesAt).Take(200).ToListAsync(ct);
        return rows.Select(q => ToView(q, q.Category!.Code)).ToList();
    }

    private async Task<Category> GetCategoryAsync(string code, CancellationToken ct)
    {
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Code == code, ct);
        if (category is null)
        {
            category = new Category { Code = code, DisplayName = Categories.DisplayName(code) };
            _db.Categories.Add(category);
            await _db.SaveChangesAsync(ct);
        }

        return category;
    }

    internal static QuestionView ToView(Question q, string categoryCode) => new(
        q.Id, categoryCode, q.Text, q.SideALabel, q.SideBLabel,
        q.Status.ToString(), q.Outcome.ToString(), q.OutcomeSource.ToString(), q.ResolvesAt);
}
