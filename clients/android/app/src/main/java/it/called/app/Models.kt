package it.called.app

import kotlinx.serialization.Serializable

// @Serializable DTOs mirroring clients/shared/openapi.yaml. Prefer generating these with
// openapi-generator; spelled out here so the scaffold reads clearly.

enum class Side { A, B }

@Serializable
data class LoginRequest(
    val phoneE164: String,
    val code: String,
    val provider: String,       // "Apple" | "Google"
    val idToken: String,
    val displayName: String? = null,
    val platform: String? = null, // "iOS" | "Android"
    val pushToken: String? = null,
)

@Serializable
data class AuthResult(
    val accessToken: String,
    val accessTokenExpiresAt: String,
    val refreshToken: String,
    val userId: String,
    val displayName: String,
    val isAdmin: Boolean,
)

@Serializable
data class DailySetQuestionView(
    val questionId: String,
    val categoryCode: String,
    val categoryName: String,
    val text: String,
    val sideALabel: String,
    val sideBLabel: String,
    val myPick: Side? = null,
    val mySkip: Boolean,
    val outcome: String,        // Unresolved | SideA | SideB | Void
)

@Serializable
data class DailySetView(
    val id: String,
    val dropAtUtc: String,
    val locksAtUtc: String,
    val isOpen: Boolean,
    val questions: List<DailySetQuestionView>,
)

@Serializable
data class SubmitGuessRequest(
    val questionId: String,
    val pick: Side? = null,
    val skip: Boolean,
)

@Serializable
data class GuessResult(
    val questionId: String,
    val categoryCode: String,
    val pick: Side? = null,
    val isSkip: Boolean,
    val submittedAt: String,
)

@Serializable
data class LeaderboardRow(
    val rank: Long,
    val userId: String,
    val displayName: String,
    val score: Double,
    val isMe: Boolean,
)

@Serializable
data class LeaderboardResult(
    val type: String,
    val scope: String,
    val categoryCode: String? = null,
    val rows: List<LeaderboardRow>,
)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class RequestOtpRequest(val phoneE164: String)
