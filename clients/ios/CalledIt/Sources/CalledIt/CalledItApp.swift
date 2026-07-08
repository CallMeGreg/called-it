import SwiftUI

// Entry point. Routes between a minimal sign-in screen and the daily card based on session state.
@main
struct CalledItApp: App {
    @StateObject private var session = Session()

    var body: some Scene {
        WindowGroup {
            Group {
                if session.isAuthenticated {
                    TodayView()
                        .environmentObject(session)
                } else {
                    SignInView()
                        .environmentObject(session)
                }
            }
        }
    }
}

// Placeholder sign-in. A real build swaps the manual code entry for Sign in with Apple / Google,
// which yields the id_token passed to POST /api/auth/login.
struct SignInView: View {
    @EnvironmentObject var session: Session
    @State private var phone = "+15555550100"
    @State private var code = ""
    @State private var otpSent = false

    var body: some View {
        VStack(spacing: 16) {
            Text("Called It").font(.largeTitle.bold())
            TextField("Phone (E.164)", text: $phone)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.phonePad)

            if otpSent {
                TextField("SMS code", text: $code)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.numberPad)
                Button("Verify & sign in") {
                    Task { try? await session.login(phone: phone, code: code) }
                }
                .buttonStyle(.borderedProminent)
            } else {
                Button("Text me a code") {
                    Task {
                        try? await session.requestOtp(phone: phone)
                        otpSent = true
                    }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding()
    }
}
