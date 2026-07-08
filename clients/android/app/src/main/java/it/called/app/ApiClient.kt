package it.called.app

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

// Minimal Ktor client showing the bearer-auth + auto-refresh pattern against the OpenAPI contract.
// Generated code (openapi-generator) can replace this.
class ApiClient {
    companion object {
        // Android emulator reaches the host machine at 10.0.2.2; use the Azure FQDN for real builds.
        const val BASE_URL = "http://10.0.2.2:5080"
    }

    private val http = HttpClient(OkHttp) {
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true; encodeDefaults = true })
        }
    }

    private var accessToken: String? = null
    private var refreshToken: String? = null
    var onTokens: ((AuthResult) -> Unit)? = null

    suspend fun requestOtp(phoneE164: String) {
        call<Unit>("/api/auth/otp", HttpMethod.Post, RequestOtpRequest(phoneE164), authed = false)
    }

    suspend fun login(req: LoginRequest): AuthResult {
        val result = call<AuthResult>("/api/auth/login", HttpMethod.Post, req, authed = false)!!
        accessToken = result.accessToken
        refreshToken = result.refreshToken
        onTokens?.invoke(result)
        return result
    }

    suspend fun today(): DailySetView =
        call<DailySetView>("/api/today", HttpMethod.Get, null, authed = true)!!

    suspend fun submit(req: SubmitGuessRequest): GuessResult =
        call<GuessResult>("/api/guesses", HttpMethod.Post, req, authed = true)!!

    suspend fun leaderboard(
        type: String = "TotalScore", scope: String = "Global",
        category: String? = null, count: Int = 50,
    ): LeaderboardResult {
        var path = "/api/leaderboards?type=$type&scope=$scope&count=$count"
        if (category != null) path += "&category=$category"
        return call<LeaderboardResult>(path, HttpMethod.Get, null, authed = true)!!
    }

    private suspend inline fun <reified T> call(
        path: String, method: HttpMethod, body: Any?, authed: Boolean, isRetry: Boolean = false,
    ): T? {
        val response: HttpResponse = http.request(BASE_URL + path) {
            this.method = method
            if (authed) accessToken?.let { header("Authorization", "Bearer $it") }
            if (body != null) { contentType(ContentType.Application.Json); setBody(body) }
        }
        if (response.status.value == 401 && authed && !isRetry && refresh()) {
            return call(path, method, body, authed, isRetry = true)
        }
        check(response.status.isSuccess()) { "HTTP ${response.status.value} for $path" }
        return if (T::class == Unit::class) null else response.body()
    }

    private suspend fun refresh(): Boolean {
        val token = refreshToken ?: return false
        return runCatching {
            val result = call<AuthResult>("/api/auth/refresh", HttpMethod.Post,
                RefreshRequest(token), authed = false)!!
            accessToken = result.accessToken
            refreshToken = result.refreshToken
            onTokens?.invoke(result)
        }.isSuccess
    }
}
