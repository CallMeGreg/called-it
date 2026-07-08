namespace CalledIt.Application.Abstractions;

/// <summary>
/// Produces a privacy-preserving HMAC hash of an E.164 phone number using a server-held pepper
/// (stored in Key Vault). Raw contact numbers are hashed on-device with the same scheme so they
/// never leave the phone in the clear.
/// </summary>
public interface IPhoneHasher
{
    string Hash(string phoneE164);
}
