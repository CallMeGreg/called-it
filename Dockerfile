# Multi-stage build for the Called It API (ASP.NET Core, .NET 8)
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Restore against just the project graph first for better layer caching.
COPY src/CalledIt.Domain/CalledIt.Domain.csproj src/CalledIt.Domain/
COPY src/CalledIt.Application/CalledIt.Application.csproj src/CalledIt.Application/
COPY src/CalledIt.Infrastructure/CalledIt.Infrastructure.csproj src/CalledIt.Infrastructure/
COPY src/CalledIt.Api/CalledIt.Api.csproj src/CalledIt.Api/
RUN dotnet restore src/CalledIt.Api/CalledIt.Api.csproj

COPY src/ src/
RUN dotnet publish src/CalledIt.Api/CalledIt.Api.csproj -c Release -o /app --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080 \
    DOTNET_TieredPGO=1
EXPOSE 8080
COPY --from=build /app ./
USER $APP_UID
ENTRYPOINT ["dotnet", "CalledIt.Api.dll"]
