using Xunit;

// Minimal-host configuration uses process environment variables; hosts must not change them in parallel.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
