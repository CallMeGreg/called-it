import Foundation

// App-wide session/auth state. Tokens are held in memory in the scaffold; a real build persists them
// in the Keychain and restores on launch.
@MainActor
final class Session: ObservableObject {
    @Published var isAuthenticated = false
    @Published var displayName = ""
    @Published var isAdmin = false

    let api = APIClient()

    init() {
        Task {
            await api.configure(access: nil, refresh: nil) { [weak self] result in
                Task { @MainActor in self?.apply(result) }
            }
        }
    }

    func requestOtp(phone: String) async throws {
        try await api.requestOtp(phoneE164: phone)
    }

    // A real build supplies provider/idToken from Sign in with Apple / Google Sign-In.
    func login(phone: String, code: String) async throws {
        let req = LoginRequest(
            phoneE164: phone, code: code,
            provider: "Apple", idToken: "REPLACE_WITH_REAL_ID_TOKEN",
            displayName: nil, platform: "iOS", pushToken: nil)
        let result = try await api.login(req)
        apply(result)
    }

    private func apply(_ result: AuthResult) {
        displayName = result.displayName
        isAdmin = result.isAdmin
        isAuthenticated = true
        // TODO: persist result.accessToken / result.refreshToken to the Keychain.
    }
}
