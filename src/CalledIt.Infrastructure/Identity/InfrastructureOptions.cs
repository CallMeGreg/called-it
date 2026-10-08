namespace CalledIt.Infrastructure.Identity;

/// <summary>Server-held pepper for privacy-preserving phone hashing (from Key Vault in prod).</summary>
public sealed class ContactsOptions
{
    public const string SectionName = "Contacts";

    public string Pepper { get; set; } = string.Empty;
}

/// <summary>Social-login validation settings.</summary>
public sealed class SocialAuthOptions
{
    public const string SectionName = "SocialAuth";

    /// <summary>When true, use the fake validator (local/dev/tests). Must be false in production.</summary>
    public bool UseFake { get; set; }

    public string GoogleAudience { get; set; } = string.Empty;
    public string AppleAudience { get; set; } = string.Empty;
}
