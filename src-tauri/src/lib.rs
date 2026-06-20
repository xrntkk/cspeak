mod audio;
mod connection;
mod identity;
mod market;
mod state;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use connection::{Cmd, ConnManager};
use serde::Serialize;
use tauri::Manager;

struct AppState {
    conn: Mutex<Option<ConnManager>>,
}

#[tauri::command]
fn connect(state: tauri::State<AppState>, address: String, nickname: String) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::Connect { address, nickname });
    }
}

#[tauri::command]
fn disconnect(state: tauri::State<AppState>) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::Disconnect);
    }
}

#[tauri::command]
fn set_muted(state: tauri::State<AppState>, muted: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetMuted(muted));
    }
}

#[tauri::command]
fn set_deafened(state: tauri::State<AppState>, deafened: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetDeafened(deafened));
    }
}

#[tauri::command]
fn join_channel(state: tauri::State<AppState>, channel: u64) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::JoinChannel(channel));
    }
}

#[tauri::command]
fn list_devices() -> (Vec<String>, Vec<String>) {
    audio::list_devices()
}

#[tauri::command]
fn set_input_device(state: tauri::State<AppState>, name: Option<String>) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetInputDevice(name));
    }
}

#[tauri::command]
fn set_output_device(state: tauri::State<AppState>, name: Option<String>) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetOutputDevice(name));
    }
}

#[tauri::command]
fn set_mic_gain(state: tauri::State<AppState>, gain: f32) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetMicGain(gain));
    }
}

#[tauri::command]
fn set_spk_gain(state: tauri::State<AppState>, gain: f32) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetSpkGain(gain));
    }
}

#[tauri::command]
fn set_sensitivity(state: tauri::State<AppState>, threshold: f32) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetSensitivity(threshold));
    }
}

#[tauri::command]
fn set_ptt_enabled(state: tauri::State<AppState>, enabled: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetPttEnabled(enabled));
    }
}

#[tauri::command]
fn set_ptt_active(state: tauri::State<AppState>, active: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetPttActive(active));
    }
}

#[tauri::command]
fn set_apm_enabled(state: tauri::State<AppState>, enabled: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetApmEnabled(enabled));
    }
}

#[tauri::command]
fn set_denoise_mode(state: tauri::State<AppState>, mode: String) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetDenoiseMode(mode));
    }
}

#[tauri::command]
fn set_client_volume(state: tauri::State<AppState>, client: u16, volume: f32) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetClientVolume { client, volume });
    }
}

#[tauri::command]
fn set_mic_test(state: tauri::State<AppState>, on: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetMicTest(on));
    }
}

#[tauri::command]
fn list_channel_files(state: tauri::State<AppState>, channel: u64) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::ListChannelFiles(channel));
    }
}

#[tauri::command]
fn download_file(
    state: tauri::State<AppState>,
    channel: u64,
    path: String,
    save_to: String,
) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::DownloadFile {
            channel,
            path,
            save_to: PathBuf::from(save_to),
        });
    }
}

#[tauri::command]
fn upload_file(
    state: tauri::State<AppState>,
    channel: u64,
    path: String,
    file: String,
) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::UploadFile {
            channel,
            path,
            file: PathBuf::from(file),
        });
    }
}

#[tauri::command]
fn send_chat(state: tauri::State<AppState>, target: String, message: String) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SendChat { target, message });
    }
}

#[tauri::command]
fn join_channel_pw(state: tauri::State<AppState>, channel: u64, password: String) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::JoinChannelPw { channel, password });
    }
}

#[tauri::command]
fn poke(state: tauri::State<AppState>, client: u16, message: String) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::Poke { client, message });
    }
}

#[tauri::command]
fn kick_client(state: tauri::State<AppState>, client: u16, message: String, from_server: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::KickClient { client, message, from_server });
    }
}

#[tauri::command]
fn mute_client(state: tauri::State<AppState>, client: u16, mute: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::MuteClient { client, mute });
    }
}

#[tauri::command]
fn request_connection_info(state: tauri::State<AppState>, client: u16) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::RequestConnectionInfo(client));
    }
}

#[tauri::command]
fn use_privilege_key(state: tauri::State<AppState>, token: String) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::UsePrivilegeKey(token));
    }
}

#[derive(Clone, Serialize)]
struct UpdateInfo {
    current_version: String,
    latest_version: Option<String>,
    download_url: Option<String>,
    release_notes: Option<String>,
}

#[tauri::command]
async fn check_update() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/repos/xrntkk/cspeak/releases/latest")
        .header("User-Agent", "csspeak-updater")
        .header("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let tag = json["tag_name"].as_str().unwrap_or("").trim_start_matches('v');
    let latest_version = if tag.is_empty() { None } else { Some(tag.to_string()) };
    let download_url = json["html_url"].as_str().map(String::from);
    let release_notes = json["body"].as_str().map(String::from);

    Ok(UpdateInfo { current_version, latest_version, download_url, release_notes })
}

#[tauri::command]
async fn market_price_single(
    key: String,
    market_hash_name: String,
) -> Result<Vec<market::PlatformPrice>, String> {
    market::price_single(&key, &market_hash_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn market_item_kline(
    key: String,
    market_hash_name: String,
    platform: String,
    kline_type: String,
) -> Result<Vec<market::Candle>, String> {
    market::item_kline(&key, &market_hash_name, &platform, &kline_type)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn market_broad_index(key: String) -> Result<market::BroadIndex, String> {
    market::broad_index(&key).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn market_list(
    sort_type: i64,
    page_size: i64,
    next_id: String,
) -> Result<market::MarketListPage, String> {
    market::market_list(sort_type, page_size, &next_id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            conn: Mutex::new(None),
        })
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let manager = ConnManager::spawn(app.handle().clone(), config_dir);
            app.state::<AppState>().conn.lock().unwrap().replace(manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            set_muted,
            set_deafened,
            join_channel,
            list_devices,
            set_input_device,
            set_output_device,
            set_mic_gain,
            set_spk_gain,
            set_sensitivity,
            set_ptt_enabled,
            set_ptt_active,
            set_apm_enabled,
            set_denoise_mode,
            set_client_volume,
            set_mic_test,
            list_channel_files,
            download_file,
            upload_file,
            send_chat,
            join_channel_pw,
            poke,
            kick_client,
            mute_client,
            request_connection_info,
            use_privilege_key,
            check_update,
            market_price_single,
            market_item_kline,
            market_broad_index,
            market_list
        ])
        .on_window_event(|window, event| {
            // Disconnect cleanly before the window closes, so the server
            // releases our connection (avoids ClientTooManyClonesConnected).
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(conn) = window.state::<AppState>().conn.lock().unwrap().as_ref() {
                    conn.shutdown_blocking();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
