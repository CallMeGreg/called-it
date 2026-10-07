FROM node:24-bookworm-slim AS web
WORKDIR /web
ENV CI=1
COPY clients/mobile/package.json clients/mobile/package-lock.json ./
RUN npm ci
COPY clients/mobile/ ./
RUN npm run export:web

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Directory.Build.props global.json ./
COPY src/CalledIt.Domain/CalledIt.Domain.csproj src/CalledIt.Domain/
COPY src/CalledIt.Application/CalledIt.Application.csproj src/CalledIt.Application/
COPY src/CalledIt.Infrastructure/CalledIt.Infrastructure.csproj src/CalledIt.Infrastructure/
COPY src/CalledIt.Api/CalledIt.Api.csproj src/CalledIt.Api/
RUN dotnet restore src/CalledIt.Api/CalledIt.Api.csproj

COPY src/ src/
RUN dotnet publish src/CalledIt.Api/CalledIt.Api.csproj -c Release -o /app --no-restore /p:UseAppHost=false

FROM build AS migration-build
COPY tools/TestDatabase/ tools/TestDatabase/
RUN dotnet publish tools/TestDatabase/TestDatabase.csproj -c Release -o /migration /p:UseAppHost=false
WORKDIR /src/tools/TestDatabase
RUN dotnet tool restore \
    && dotnet tool run dotnet-ef -- migrations script --idempotent \
        --project ../../src/CalledIt.Infrastructure --output /migration/migrations.sql \
    && grep -q '20261007031337_AddIsolatedTestRounds' /migration/migrations.sql

FROM mcr.microsoft.com/dotnet/runtime:10.0 AS migration
WORKDIR /app
COPY --from=migration-build /migration ./
USER $APP_UID
ENTRYPOINT ["dotnet", "TestDatabase.dll"]

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS api
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080 \
    DOTNET_TieredPGO=1
EXPOSE 8080
COPY --from=build /app ./
COPY --from=web /web/dist ./wwwroot/
USER $APP_UID
ENTRYPOINT ["dotnet", "CalledIt.Api.dll"]
