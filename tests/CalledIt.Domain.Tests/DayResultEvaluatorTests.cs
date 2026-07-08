using CalledIt.Domain;
using CalledIt.Domain.Scoring;
using Xunit;

namespace CalledIt.Domain.Tests;

public class DayResultEvaluatorTests
{
    [Theory]
    [InlineData(Side.A, Outcome.SideA, DayResult.Correct)]
    [InlineData(Side.B, Outcome.SideB, DayResult.Correct)]
    [InlineData(Side.A, Outcome.SideB, DayResult.Wrong)]
    [InlineData(Side.B, Outcome.SideA, DayResult.Wrong)]
    public void Pick_is_scored_against_outcome(Side pick, Outcome outcome, DayResult expected)
    {
        Assert.Equal(expected, DayResultEvaluator.Evaluate(pick, isSkip: false, outcome));
    }

    [Fact]
    public void Skip_yields_skipped_even_when_resolved()
    {
        Assert.Equal(DayResult.Skipped, DayResultEvaluator.Evaluate(pick: null, isSkip: true, Outcome.SideA));
    }

    [Fact]
    public void No_pick_and_no_skip_on_resolved_day_is_missed()
    {
        Assert.Equal(DayResult.Missed, DayResultEvaluator.Evaluate(pick: null, isSkip: false, Outcome.SideA));
    }

    [Fact]
    public void Unresolved_question_is_pending()
    {
        Assert.Equal(DayResult.Pending, DayResultEvaluator.Evaluate(Side.A, isSkip: false, Outcome.Unresolved));
    }

    [Theory]
    [InlineData(Side.A, false)]
    [InlineData(null, false)]
    [InlineData(null, true)]
    public void Void_is_neutral_for_everyone(Side? pick, bool isSkip)
    {
        Assert.Equal(DayResult.Void, DayResultEvaluator.Evaluate(pick, isSkip, Outcome.Void));
    }
}
