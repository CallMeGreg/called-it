namespace CalledIt.Domain;

/// <summary>
/// The fixed MVP categories. One binary question from each is dropped every day.
/// </summary>
public static class Categories
{
    public const string Sports = "sports";
    public const string Finance = "finance";
    public const string PopCulture = "pop_culture";

    public static readonly IReadOnlyList<string> All = new[] { Sports, Finance, PopCulture };

    public static bool IsValid(string code) => All.Contains(code);

    public static string DisplayName(string code) => code switch
    {
        Sports => "Sports",
        Finance => "Finance",
        PopCulture => "Pop Culture",
        _ => code,
    };
}
