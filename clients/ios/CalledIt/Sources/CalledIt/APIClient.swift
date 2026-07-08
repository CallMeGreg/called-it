import Foundation

// Minimal async URLSession client. Generated code (openapi-generator) can replace this; it is kept
// hand-written here to show the bearer-auth + auto-refresh pattern against the OpenAPI contract.
actor APIClient {
    // Simulator talks to a locally-running API; point this at the Azure FQDN for device builds.
    static let baseURL = URL(string: "http://localhost:5080")!

    private let session = URLSession.shared
    private var accessToken: String?
    private var refreshToken: String?
    private var onTokens: ((AuthResult) -> Void)?

    func configure(access: String?, refresh: String?, onTokens: @escaping (AuthResult) -> Void) {
        self.accessToken = access
        self.refreshToken = refresh
        self.onTokens = onTokens
    }

    struct APIError: Error { let status: Int; let body: String }

    // MARK: - Public calls (subset — extend from the OpenAPI contract)

    func requestOtp(phoneE164: String) async throws {
        _ = try await send("/api/auth/otp", method: "POST",
                           body: ["phoneE164": phoneE164], authed: false) as Empty
    }

    func login(_ req: LoginRequest) async throws -> AuthResult {
        let result: AuthResult = try await send("/api/auth/login", method: "POST", body: req, authed: false)
        onTokens?(result)
        accessToken = result.accessToken
        refreshToken = result.refreshToken
        return result
    }

    func today() async throws -> DailySetView {
        try await send("/api/today", method: "GET", body: Optional<Empty>.none, authed: true)
    }

    func submit(_ req: SubmitGuessRequest) async throws -> GuessResult {
        try await send("/api/guesses", method: "POST", body: req, authed: true)
    }

    func leaderboard(type: String = "TotalScore", scope: String = "Global",
                     category: String? = nil, count: Int = 50) async throws -> LeaderboardResult {
        var path = "/api/leaderboards?type=\(type)&scope=\(scope)&count=\(count)"
        if let category { path += "&category=\(category)" }
        return try await send(path, method: "GET", body: Optional<Empty>.none, authed: true)
    }

    // MARK: - Transport

    private struct Empty: Codable {}

    private func send<TBody: Encodable, TResp: Decodable>(
        _ path: String, method: String, body: TBody?, authed: Bool, isRetry: Bool = false
    ) async throws -> TResp {
        var req = URLRequest(url: URL(string: path, relativeTo: Self.baseURL)!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authed, let accessToken { req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization") }
        if let body, !(body is Empty) { req.httpBody = try Self.encoder.encode(body) }

        let (data, response) = try await session.data(for: req)
        let http = response as! HTTPURLResponse

        if http.statusCode == 401, authed, !isRetry, try await refresh() {
            return try await send(path, method: method, body: body, authed: authed, isRetry: true)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        if TResp.self == Empty.self { return Empty() as! TResp }
        return try Self.decoder.decode(TResp.self, from: data)
    }

    private func refresh() async throws -> Bool {
        guard let refreshToken else { return false }
        do {
            let result: AuthResult = try await send("/api/auth/refresh", method: "POST",
                                                    body: ["refreshToken": refreshToken], authed: false)
            accessToken = result.accessToken
            self.refreshToken = result.refreshToken
            onTokens?(result)
            return true
        } catch { return false }
    }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; return e
    }()
    static let decoder: JSONDecoder = {
        let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d
    }()
}
