using System.Security.Cryptography;
using CalledIt.Application.Abstractions;
using CalledIt.Application.Common;
using CalledIt.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CalledIt.Application.Identity;

/// <summary>
/// Handles phone-OTP + Apple/Google login, token issuance, refresh rotation, and device
/// registration. Admin accounts are bootstrapped from configured phone numbers.
/// </summary>
public sealed class AuthService
{
    private readonly IAppDbContext _db;
    private readonly IClock _clock;
    private readonly ISmsSender _sms;
    private readonly ISocialTokenValidator _social;
    private readonly ITokenService _tokens;
    private readonly IPhoneHasher _phoneHasher;
    private readonly AuthOptions _auth;
    private readonly GameOptions _game;

    public AuthService(
        IAppDbContext db,
        IClock clock,
        ISmsSender sms,
        ISocialTokenValidator social,
        ITokenService tokens,
        IPhoneHasher phoneHasher,
        IOptions<AuthOptions> auth,
        IOptions<GameOptions> game)
    {
        _db = db;
        _clock = clock;
        _sms = sms;
        _social = social;
        _tokens = tokens;
        _phoneHasher = phoneHasher;
        _auth = auth.Value;
        _game = game.Value;
    }

    /// <summary>Generate + send a one-time passcode for the given phone number.</summary>
    public async Task RequestOtpAsync(RequestOtpCommand cmd, CancellationToken ct = default)
    {
        var phone = NormalizePhone(cmd.PhoneE164);

        await EnforceOtpSendLimitsAsync(phone, ct);

        var code = GenerateOtpCode();

        _db.OtpChallenges.Add(new OtpChallenge
        {
            PhoneE164 = phone,
            CodeHash = Hashing.Sha256Hex($"{phone}:{code}"),
            ExpiresAt = _clock.UtcNow.AddMinutes(_auth.OtpMinutes),
            CreatedAt = _clock.UtcNow,
        });
        await _db.SaveChangesAsync(ct);

        await _sms.SendOtpAsync(phone, code, ct);
    }

    /// <summary>
    /// Rate-limits OTP sends per phone number to defend against SMS-pumping / toll fraud: a short
    /// resend cooldown plus rolling hourly and daily caps. Counts are derived from the challenge
    /// history (server-authoritative clock) so the limit holds across API replicas.
    /// </summary>
    private async Task EnforceOtpSendLimitsAsync(string phone, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var hourAgo = now.AddHours(-1);
        var dayAgo = now.AddDays(-1);

        var recent = await _db.OtpChallenges
            .Where(c => c.PhoneE164 == phone && c.CreatedAt >= dayAgo)
            .Select(c => c.CreatedAt)
            .ToListAsync(ct);

        if (_auth.OtpResendCooldownSeconds > 0 && recent.Count > 0)
        {
            var last = recent.Max();
            if ((now - last).TotalSeconds < _auth.OtpResendCooldownSeconds)
            {
                throw new TooManyRequestsException(
                    "A code was just sent. Please wait a moment before requesting another.");
            }
        }

        if (_auth.OtpRequestsPerHour > 0 && recent.Count(c => c >= hourAgo) >= _auth.OtpRequestsPerHour)
        {
            throw new TooManyRequestsException("Too many code requests. Please try again later.");
        }

        if (_auth.OtpRequestsPerDay > 0 && recent.Count >= _auth.OtpRequestsPerDay)
        {
            throw new TooManyRequestsException("Daily code request limit reached. Please try again tomorrow.");
        }
    }

    public async Task<AuthResult> RegisterOrLoginAsync(RegisterOrLoginCommand cmd, CancellationToken ct = default)
    {
        var phone = NormalizePhone(cmd.PhoneE164);

        await VerifyOtpAsync(phone, cmd.Code, ct);

        // Validate the social id_token and get the provider's stable subject.
        var social = await _social.ValidateAsync(cmd.Provider, cmd.IdToken, ct);

        var user = await ResolveOrCreateUserAsync(phone, social, cmd.DisplayName, ct);

        // Optionally register the device for push.
        if (cmd.Platform is { } platform && !string.IsNullOrWhiteSpace(cmd.PushToken))
        {
            await UpsertDeviceAsync(user.Id, platform, cmd.PushToken!, ct);
        }

        return await IssueAsync(user, ct);
    }

    public async Task<AuthResult> RefreshAsync(string refreshTokenValue, CancellationToken ct = default)
    {
        var hash = _tokens.HashRefreshToken(refreshTokenValue);
        var existing = await _db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, ct);

        if (existing is null || existing.Revoked || existing.ExpiresAt <= _clock.UtcNow)
        {
            throw new ForbiddenException("Invalid or expired refresh token.");
        }

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == existing.UserId, ct)
            ?? throw new NotFoundException("User not found.");

        // Rotate: revoke the old token, issue a fresh pair.
        existing.Revoked = true;
        var result = await IssueAsync(user, ct, replacedFrom: existing);
        return result;
    }

    public async Task UpsertDeviceAsync(Guid userId, Domain.DevicePlatform platform, string pushToken, CancellationToken ct = default)
    {
        var device = await _db.Devices.FirstOrDefaultAsync(d => d.UserId == userId && d.PushToken == pushToken, ct);
        if (device is null)
        {
            _db.Devices.Add(new Device
            {
                UserId = userId,
                Platform = platform,
                PushToken = pushToken,
                CreatedAt = _clock.UtcNow,
                LastSeenAt = _clock.UtcNow,
            });
        }
        else
        {
            device.LastSeenAt = _clock.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
    }

    // --- helpers ---

    private async Task VerifyOtpAsync(string phone, string code, CancellationToken ct)
    {
        var challenge = await _db.OtpChallenges
            .Where(c => c.PhoneE164 == phone && !c.Consumed)
            .OrderByDescending(c => c.CreatedAt)
            .FirstOrDefaultAsync(ct);

        if (challenge is null || challenge.ExpiresAt <= _clock.UtcNow)
        {
            throw new ValidationException("No valid code was requested for this number.");
        }

        if (challenge.Attempts >= _auth.OtpMaxAttempts)
        {
            throw new ForbiddenException("Too many attempts. Request a new code.");
        }

        challenge.Attempts++;

        if (challenge.CodeHash != Hashing.Sha256Hex($"{phone}:{code}"))
        {
            await _db.SaveChangesAsync(ct);
            throw new ValidationException("Incorrect code.");
        }

        challenge.Consumed = true;
        await _db.SaveChangesAsync(ct);
    }

    private async Task<User> ResolveOrCreateUserAsync(
        string phone, SocialIdentity social, string? displayName, CancellationToken ct)
    {
        var phoneHash = _phoneHasher.Hash(phone);

        var user = await _db.Users.FirstOrDefaultAsync(u => u.PhoneE164 == phone, ct);
        if (user is null)
        {
            user = new User
            {
                PhoneE164 = phone,
                PhoneHash = phoneHash,
                DisplayName = string.IsNullOrWhiteSpace(displayName) ? "Player" : displayName!.Trim(),
                IsAdmin = _game.AdminBootstrapPhones.Contains(phone),
                CreatedAt = _clock.UtcNow,
            };
            _db.Users.Add(user);
        }
        else if (!string.IsNullOrWhiteSpace(displayName))
        {
            user.DisplayName = displayName!.Trim();
        }

        // Ensure the federated identity is linked (idempotent on provider+subject).
        var linked = await _db.FederatedIdentities.AnyAsync(
            f => f.Provider == social.Provider && f.Subject == social.Subject, ct);
        if (!linked)
        {
            _db.FederatedIdentities.Add(new FederatedIdentity
            {
                UserId = user.Id,
                Provider = social.Provider,
                Subject = social.Subject,
                CreatedAt = _clock.UtcNow,
            });
        }

        await _db.SaveChangesAsync(ct);
        return user;
    }

    private async Task<AuthResult> IssueAsync(User user, CancellationToken ct, RefreshToken? replacedFrom = null)
    {
        var access = _tokens.CreateAccessToken(user);
        var refreshValue = _tokens.GenerateRefreshTokenValue();

        var refresh = new RefreshToken
        {
            UserId = user.Id,
            TokenHash = _tokens.HashRefreshToken(refreshValue),
            ExpiresAt = _clock.UtcNow.AddDays(_auth.RefreshTokenDays),
            CreatedAt = _clock.UtcNow,
        };
        _db.RefreshTokens.Add(refresh);

        if (replacedFrom is not null)
        {
            replacedFrom.ReplacedById = refresh.Id;
        }

        await _db.SaveChangesAsync(ct);

        return new AuthResult(
            access.Token, access.ExpiresAt, refreshValue, user.Id, user.DisplayName, user.IsAdmin);
    }

    private static string NormalizePhone(string raw)
    {
        var trimmed = raw?.Trim() ?? string.Empty;
        if (!trimmed.StartsWith('+') || trimmed.Length < 8)
        {
            throw new ValidationException("Phone number must be in E.164 format (e.g. +14155550123).");
        }

        return trimmed;
    }

    private static string GenerateOtpCode() => RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
}
