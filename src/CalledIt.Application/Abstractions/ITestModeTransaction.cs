namespace CalledIt.Application.Abstractions;

/// <summary>Serializes TEST state changes across processes in one database transaction.</summary>
public interface ITestModeTransaction
{
    Task<T> ExecuteAsync<T>(Func<Task<T>> action, CancellationToken ct = default);
}
