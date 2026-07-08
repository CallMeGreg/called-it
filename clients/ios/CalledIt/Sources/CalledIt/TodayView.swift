import SwiftUI

// The daily card: shows the live set, lets the player pick a side or skip each question before the
// 6-hour lock, and reflects picks optimistically.
struct TodayView: View {
    @EnvironmentObject var session: Session
    @State private var set: DailySetView?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let set {
                    List(set.questions) { q in
                        QuestionRow(question: q, locked: !set.isOpen) { side, skip in
                            Task { await submit(q, side: side, skip: skip) }
                        }
                    }
                } else if let error {
                    ContentUnavailableViewCompat(title: "No card yet", message: error)
                } else {
                    ProgressView().task { await load() }
                }
            }
            .navigationTitle("Today")
            .toolbar { Button("Refresh") { Task { await load() } } }
        }
    }

    private func load() async {
        do { set = try await session.api.today(); error = nil }
        catch { self.error = "\(error)" }
    }

    private func submit(_ q: DailySetQuestionView, side: Side?, skip: Bool) async {
        let req = SubmitGuessRequest(questionId: q.questionId, pick: side, skip: skip)
        _ = try? await session.api.submit(req)
        await load()
    }
}

struct QuestionRow: View {
    let question: DailySetQuestionView
    let locked: Bool
    let onPick: (Side?, Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(question.categoryName.uppercased())
                .font(.caption).foregroundStyle(.secondary)
            Text(question.text).font(.headline)
            HStack {
                choice(question.sideALabel, side: .A)
                choice(question.sideBLabel, side: .B)
                Button("Skip") { onPick(nil, true) }
                    .buttonStyle(.bordered)
                    .disabled(locked)
            }
        }
        .padding(.vertical, 6)
    }

    private func choice(_ label: String, side: Side) -> some View {
        Button(label) { onPick(side, false) }
            .buttonStyle(.borderedProminent)
            .tint(question.myPick == side ? .accentColor : .gray)
            .disabled(locked)
    }
}

// Small shim so the scaffold builds on iOS 16 without ContentUnavailableView (iOS 17+).
struct ContentUnavailableViewCompat: View {
    let title: String
    let message: String
    var body: some View {
        VStack(spacing: 8) {
            Text(title).font(.headline)
            Text(message).font(.subheadline).foregroundStyle(.secondary)
        }
    }
}
