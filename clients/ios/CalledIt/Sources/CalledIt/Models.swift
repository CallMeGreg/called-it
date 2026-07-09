import Foundation

// Codable DTOs mirroring clients/shared/openapi.yaml. Prefer generating these with openapi-generator;
// they are spelled out here so the scaffold compiles and reads clearly.

enum Side: String, Codable { case A, B }

struct LoginRequest: Codable {
    let phoneE164: String
    let code: String
    let provider: String       // "Apple" | "Google"
    let idToken: String
    let displayName: String?
    let platform: String?      // "iOS"
    let pushToken: String?
}

struct AuthResult: Codable {
    let accessToken: String
    let accessTokenExpiresAt: Date
    let refreshToken: String
    let userId: String
    let displayName: String
    let isAdmin: Bool
}

struct DailySetQuestionView: Codable, Identifiable {
    var id: String { questionId }
    let questionId: String
    let categoryCode: String
    let categoryName: String
    let text: String
    let sideALabel: String
    let sideBLabel: String
    let myPick: Side?
    let mySkip: Bool
    let outcome: String        // Unresolved | SideA | SideB | Void
}

struct DailySetView: Codable {
    let id: String
    let dropAtUtc: Date
    let locksAtUtc: Date
    let isOpen: Bool
    let questions: [DailySetQuestionView]
}

struct SubmitGuessRequest: Codable {
    let questionId: String
    let pick: Side?
    let skip: Bool
}

struct GuessResult: Codable {
    let questionId: String
    let categoryCode: String
    let pick: Side?
    let isSkip: Bool
    let submittedAt: Date
}

struct LeaderboardRow: Codable, Identifiable {
    var id: String { userId }
    let rank: Int
    let userId: String
    let displayName: String
    let score: Double
    let isMe: Bool
}

struct LeaderboardResult: Codable {
    let type: String
    let scope: String
    let categoryCode: String?
    let rows: [LeaderboardRow]
}
