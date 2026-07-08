package it.called.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

// The daily card: shows the live set and lets the player pick a side or skip before the 6-hour lock.
@Composable
fun TodayScreen(api: ApiClient) {
    var set by remember { mutableStateOf<DailySetView?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        runCatching { api.today() }
            .onSuccess { set = it; error = null }
            .onFailure { error = it.message }
    }

    LaunchedEffect(Unit) { load() }

    val current = set
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Today", style = MaterialTheme.typography.headlineMedium)
        when {
            current != null -> LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                items(current.questions) { q ->
                    QuestionRow(q, locked = !current.isOpen) { side, skip ->
                        scope.launch {
                            api.submit(SubmitGuessRequest(q.questionId, side, skip))
                            load()
                        }
                    }
                }
            }
            error != null -> Text("No card yet: $error")
            else -> Text("Loading…")
        }
    }
}

@Composable
private fun QuestionRow(q: DailySetQuestionView, locked: Boolean, onPick: (Side?, Boolean) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(q.categoryName.uppercase(), style = MaterialTheme.typography.labelSmall)
        Text(q.text, style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { onPick(Side.A, false) },
                enabled = !locked,
                colors = if (q.myPick == Side.A) ButtonDefaults.buttonColors()
                         else ButtonDefaults.filledTonalButtonColors(),
            ) { Text(q.sideALabel) }
            Button(
                onClick = { onPick(Side.B, false) },
                enabled = !locked,
                colors = if (q.myPick == Side.B) ButtonDefaults.buttonColors()
                         else ButtonDefaults.filledTonalButtonColors(),
            ) { Text(q.sideBLabel) }
            OutlinedButton(onClick = { onPick(null, true) }, enabled = !locked) { Text("Skip") }
        }
    }
}
