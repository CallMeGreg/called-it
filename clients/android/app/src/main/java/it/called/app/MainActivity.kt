package it.called.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

// Compose entry point with the simplest possible routing: sign-in until authenticated, then Today.
class MainActivity : ComponentActivity() {
    private val api = ApiClient()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    var authed by remember { mutableStateOf(false) }
                    if (authed) TodayScreen(api) else SignInScreen(api) { authed = true }
                }
            }
        }
    }
}

// Placeholder sign-in. A real build swaps manual code entry for Google Sign-In, which yields the
// id_token passed to POST /api/auth/login.
@Composable
fun SignInScreen(api: ApiClient, onAuthed: () -> Unit) {
    var phone by remember { mutableStateOf("+15555550100") }
    var code by remember { mutableStateOf("") }
    var otpSent by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Called It", style = MaterialTheme.typography.headlineLarge)
        OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("Phone (E.164)") })
        if (otpSent) {
            OutlinedTextField(value = code, onValueChange = { code = it }, label = { Text("SMS code") })
            Button(onClick = {
                scope.launch {
                    api.login(
                        LoginRequest(
                            phoneE164 = phone, code = code,
                            provider = "Google", idToken = "REPLACE_WITH_REAL_ID_TOKEN",
                            platform = "Android",
                        )
                    )
                    onAuthed()
                }
            }) { Text("Verify & sign in") }
        } else {
            Button(onClick = { scope.launch { api.requestOtp(phone); otpSent = true } }) {
                Text("Text me a code")
            }
        }
    }
}
