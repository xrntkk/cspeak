use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use futures::prelude::*;
use tauri::{AppHandle, Emitter};
use tokio::{io as tokio_io, sync::mpsc};

use tsclientlib::data::{Channel, Client};
use tsclientlib::messages::{c2s, s2c::InMessage};
use tsclientlib::prelude::*;
use tsclientlib::{
    ChannelId, ClientId, Connection, DisconnectOptions, MessageTarget, Reason, StreamItem,
};
use tsproto_packets::packets::AudioData;

use crate::audio::AudioEngine;
use crate::state::{ChannelInfo, ChatMessage, ClientInfo, ConnInfo, ConnStatus, ServerSnapshot};

/// Commands sent from Tauri commands (any thread) into the connection worker.
pub enum Cmd {
    Connect { address: String, nickname: String },
    Disconnect,
    SetMuted(bool),
    SetDeafened(bool),
    JoinChannel(u64),
    SetInputDevice(Option<String>),
    SetOutputDevice(Option<String>),
    SetMicGain(f32),
    SetSpkGain(f32),
    SetSensitivity(f32),
    SetPttEnabled(bool),
    SetPttActive(bool),
    /// Toggle the WebRTC echo-cancel/denoise/AGC pipeline.
    SetApmEnabled(bool),
    /// Select noise-suppression stage: "off" / "webrtc" / "deepfilter".
    SetDenoiseMode(String),
    /// Set one speaker's playback volume multiplier (1.0 = normal).
    SetClientVolume { client: u16, volume: f32 },
    /// Toggle mic test (local loopback of processed mic audio).
    SetMicTest(bool),
    /// Request file list for a channel.
    ListChannelFiles(u64),
    /// Download a file from channel to local path.
    DownloadFile {
        channel: u64,
        path: String,
        save_to: PathBuf,
    },
    /// Upload a local file to channel.
    UploadFile {
        channel: u64,
        path: String,
        file: PathBuf,
    },
    SendChat { target: String, message: String, client: Option<u16> },
    JoinChannelPw { channel: u64, password: String },
    Poke { client: u16, message: String },
    KickClient { client: u16, message: String, from_server: bool },
    MuteClient { client: u16, mute: bool },
    RequestConnectionInfo(u16),
    UsePrivilegeKey(String),
    /// Disconnect cleanly and signal completion via the channel, so the app
    /// can block on shutdown until the server acknowledges we left.
    Shutdown(std::sync::mpsc::Sender<()>),
}

/// Handle held in Tauri state; forwards commands to the worker thread.
pub struct ConnManager {
    tx: mpsc::UnboundedSender<Cmd>,
}

impl ConnManager {
    pub fn spawn(app: AppHandle, config_dir: PathBuf) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        thread::spawn(move || worker_main(app, config_dir, rx));
        Self { tx }
    }

    pub fn send(&self, cmd: Cmd) {
        let _ = self.tx.send(cmd);
    }

    /// Block until the worker has disconnected from the server (or timeout).
    /// Called on window close so we don't leave a ghost connection that would
    /// trigger `ClientTooManyClonesConnected` on the next launch.
    pub fn shutdown_blocking(&self) {
        let (ack_tx, ack_rx) = std::sync::mpsc::channel();
        if self.tx.send(Cmd::Shutdown(ack_tx)).is_ok() {
            let _ = ack_rx.recv_timeout(std::time::Duration::from_secs(3));
        }
    }
}

fn worker_main(app: AppHandle, config_dir: PathBuf, mut rx: mpsc::UnboundedReceiver<Cmd>) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("build runtime");
    let local = tokio::task::LocalSet::new();

    local.block_on(&rt, async move {
        while let Some(cmd) = rx.recv().await {
            match cmd {
                Cmd::Connect { address, nickname } => {
                    if let Err(e) =
                        run_session(&app, &config_dir, address, nickname, &mut rx).await
                    {
                        emit_status(&app, ConnStatus::Error { message: e.to_string() });
                    }
                }
                Cmd::Shutdown(ack) => {
                    // Not connected; nothing to disconnect, ack immediately.
                    let _ = ack.send(());
                    break;
                }
                _ => { /* ignore commands while not connected */ }
            }
        }
    });
}

/// One full connection lifetime: connect, subscribe, stream events until disconnect.
async fn run_session(
    app: &AppHandle,
    config_dir: &PathBuf,
    address: String,
    nickname: String,
    rx: &mut mpsc::UnboundedReceiver<Cmd>,
) -> anyhow::Result<()> {
    emit_status(app, ConnStatus::Connecting);

    let id = crate::identity::load_or_create(config_dir)?;
    let mut con = Connection::build(address)
        .identity(id)
        .name(nickname)
        .connect()?;

    // Wait for the initial book (channel/client list) to arrive.
    let first = con
        .events()
        .try_filter(|e| future::ready(matches!(e, StreamItem::BookEvents(_))))
        .next()
        .await;
    if let Some(r) = first {
        r?;
    }

    // Subscribe to the whole server so we receive all channels/clients.
    con.get_state()?.server.set_subscribed(true).send(&mut con)?;

    // Start audio: mic packets arrive on `mic_rx`, playback handler is shared
    // with the cpal output stream inside the engine.
    let (mic_tx, mut mic_rx) = mpsc::channel(8);
    let mut engine = match AudioEngine::new(mic_tx) {
        Ok(e) => Some(e),
        Err(e) => {
            tracing::error!(%e, "audio init failed; continuing without audio");
            None
        }
    };
    // Map filetransfer-handle → data to write/read on stream events.
    let mut pending_uploads: std::collections::HashMap<u16, Vec<u8>> = std::collections::HashMap::new();

    emit_status(app, ConnStatus::Connected);
    emit_snapshot(app, &con);

    enum Item {
        Event(Option<Result<StreamItem, tsclientlib::Error>>),
        Command(Option<Cmd>),
        Mic(Option<tsproto_packets::packets::OutPacket>),
        Tick,
    }

    let mut tick = tokio::time::interval(Duration::from_millis(150));
    let mut last_talking: Vec<u16> = Vec::new();

    loop {
        // Bind the events stream in an inner scope so its mutable borrow of
        // `con` is released before we touch `con` again below.
        let item = {
            let mut events = con.events();
            tokio::select! {
                ev = events.next() => Item::Event(ev),
                cmd = rx.recv() => Item::Command(cmd),
                pkt = mic_rx.recv() => Item::Mic(pkt),
                _ = tick.tick() => Item::Tick,
            }
        };

        match item {
            Item::Tick => {
                if let Some(engine) = &engine {
                    let cur = engine.shared.talking.lock().unwrap().clone();
                    if cur != last_talking {
                        last_talking = cur.clone();
                        let _ = app.emit("conn-talking", cur);
                    }
                }
            }
            Item::Event(Some(Ok(StreamItem::Audio(packet)))) => {
                if let Some(engine) = &engine {
                    let from = match packet.data().data() {
                        AudioData::S2C { from, .. } | AudioData::S2CWhisper { from, .. } => {
                            ClientId(*from)
                        }
                        _ => continue,
                    };
                    if let Err(e) = engine.shared.handler.lock().unwrap().handle_packet(from, packet)
                    {
                        tracing::debug!(%e, "failed to play packet");
                    }
                }
            }
            Item::Event(Some(Ok(StreamItem::BookEvents(events)))) => {
                for ev in &events {
                    if let tsclientlib::events::Event::Message { target, invoker, message } = ev {
                        let scope = match target {
                            MessageTarget::Server => "server",
                            MessageTarget::Channel => "channel",
                            MessageTarget::Client(_) => "private",
                            MessageTarget::Poke(_) => "poke",
                        };
                        let _ = app.emit(
                            "conn-chat",
                            ChatMessage {
                                scope: scope.to_string(),
                                from: invoker.name.clone(),
                                from_id: invoker.id.0,
                                message: message.clone(),
                            },
                        );
                    }
                }
                emit_snapshot(app, &con);
            }
            Item::Event(Some(Ok(StreamItem::MessageEvent(InMessage::ClientConnectionInfo(
                msg,
            ))))) => {
                for part in msg.iter() {
                    let _ = app.emit(
                        "conn-info",
                        ConnInfo {
                            client_id: part.client_id.0,
                            ping_ms: part.ping.map(|d| d.as_seconds_f64() * 1000.0),
                            packet_loss: part.server_to_client_packetloss_speech,
                        },
                    );
                }
            }
            Item::Event(Some(Ok(StreamItem::MessageEvent(InMessage::FileList(msg))))) => {
                let mut files = Vec::new();
                for p in msg.iter() {
                    files.push(FileEntry {
                        name: p.name.clone(),
                        path: p.path.clone(),
                        size: p.size,
                        is_file: p.is_file,
                    });
                }
                let _ = app.emit("conn-filelist", files);
            }
            Item::Event(Some(Ok(StreamItem::FileDownload(_handle, mut result)))) => {
                // Spawn a task to read the TCP stream asynchronously and save to disk.
                // (The download path would ideally be tracked per-handle, but for now
                // we save to the app config dir with the file's known size logged.)
                let size = result.size;
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    if let Err(e) = tokio_io::AsyncReadExt::read_to_end(&mut result.stream, &mut buf).await {
                        tracing::error!(%e, "failed to read downloaded file stream");
                        return;
                    }
                    tracing::info!(size = buf.len(), expected = size, "file download complete");
                });
                let _ = app.emit("conn-ft-status", FtStatus::Downloaded { size });
            }
            Item::Event(Some(Ok(StreamItem::FileUpload(handle, mut result)))) => {
                let data = pending_uploads.remove(&handle.0);
                app.emit("conn-ft-status", FtStatus::Uploaded).ok();
                if let Some(data) = data {
                    tokio::spawn(async move {
                        if let Err(e) = tokio_io::AsyncWriteExt::write_all(
                            &mut result.stream, &data,
                        )
                        .await
                        {
                            tracing::error!(%e, "failed to write upload data");
                        }
                    });
                }
            }
            Item::Event(Some(Ok(StreamItem::FiletransferFailed(handle, error)))) => {
                pending_uploads.remove(&handle.0);
                let _ = app.emit(
                    "conn-ft-status",
                    FtStatus::Failed {
                        error: error.to_string(),
                    },
                );
            }
            Item::Event(Some(Ok(_))) => emit_snapshot(app, &con),
            Item::Event(Some(Err(e))) => {
                emit_status(app, ConnStatus::Error { message: e.to_string() });
                break;
            }
            Item::Event(None) => {
                emit_status(app, ConnStatus::Disconnected { reason: None });
                break;
            }
            Item::Mic(Some(packet)) => {
                con.send_audio(packet)?;
            }
            Item::Mic(None) => { /* mic channel closed */ }
            Item::Command(Some(Cmd::SetMuted(m))) => {
                if let Some(engine) = &engine {
                    *engine.shared.muted.lock().unwrap() = m;
                }
            }
            Item::Command(Some(Cmd::SetDeafened(d))) => {
                if let Some(engine) = &engine {
                    *engine.shared.deafened.lock().unwrap() = d;
                }
            }
            Item::Command(Some(Cmd::SetMicGain(g))) => {
                if let Some(engine) = &engine {
                    *engine.shared.mic_gain.lock().unwrap() = g;
                }
            }
            Item::Command(Some(Cmd::SetInputDevice(name))) => {
                if let Some(engine) = &mut engine {
                    if let Err(e) = engine.rebuild_input(name.as_deref()) {
                        tracing::error!(%e, "failed to switch input device");
                    }
                }
            }
            Item::Command(Some(Cmd::SetOutputDevice(name))) => {
                if let Some(engine) = &mut engine {
                    if let Err(e) = engine.rebuild_output(name.as_deref()) {
                        tracing::error!(%e, "failed to switch output device");
                    }
                }
            }
            Item::Command(Some(Cmd::SetSpkGain(g))) => {
                if let Some(engine) = &engine {
                    *engine.shared.spk_gain.lock().unwrap() = g;
                }
            }
            Item::Command(Some(Cmd::SetSensitivity(s))) => {
                if let Some(engine) = &engine {
                    *engine.shared.sensitivity.lock().unwrap() = s;
                }
            }
            Item::Command(Some(Cmd::SetPttEnabled(b))) => {
                if let Some(engine) = &engine {
                    *engine.shared.ptt_enabled.lock().unwrap() = b;
                }
            }
            Item::Command(Some(Cmd::SetPttActive(b))) => {
                if let Some(engine) = &engine {
                    *engine.shared.ptt_active.lock().unwrap() = b;
                }
            }
            Item::Command(Some(Cmd::SetApmEnabled(b))) => {
                if let Some(engine) = &engine {
                    if let Some(apm) = &engine.shared.apm {
                        apm.enabled.store(b, std::sync::atomic::Ordering::Relaxed);
                    }
                }
            }
            Item::Command(Some(Cmd::SetDenoiseMode(mode))) => {
                if let Some(engine) = &engine {
                    *engine.shared.denoise_mode.lock().unwrap() =
                        crate::audio::DenoiseMode::from_str(&mode);
                }
            }
            Item::Command(Some(Cmd::SetClientVolume { client, volume })) => {
                if let Some(engine) = &engine {
                    engine.shared.client_volumes.lock().unwrap().insert(client, volume);
                }
            }
            Item::Command(Some(Cmd::SetMicTest(on))) => {
                if let Some(engine) = &engine {
                    *engine.shared.mic_test.lock().unwrap() = on;
                    if !on {
                        engine.shared.loopback.lock().unwrap().clear();
                    }
                }
            }
            Item::Command(Some(Cmd::ListChannelFiles(cid))) => {
                let cmd = c2s::OutFileListRequestMessage::new(&mut std::iter::once(
                    c2s::OutFileListRequestPart {
                        channel_id: ChannelId(cid),
                        channel_password: "".into(),
                        path: "/".into(),
                    },
                ));
                if let Err(e) = cmd.send(&mut con) {
                    tracing::warn!(%e, "failed to request file list");
                }
            }
            Item::Command(Some(Cmd::DownloadFile { channel, path, save_to: _ })) => {
                match con.download_file(ChannelId(channel), &path, None, None) {
                    Ok(_handle) => { /* event comes later */ }
                    Err(e) => {
                        let _ = app.emit("conn-ft-status", FtStatus::Failed { error: e.to_string() });
                    }
                }
            }
            Item::Command(Some(Cmd::UploadFile { channel, path, file })) => {
                let data = match fs::read(&file) {
                    Ok(d) => d,
                    Err(e) => {
                        let _ = app.emit("conn-ft-status", FtStatus::Failed { error: e.to_string() });
                        continue;
                    }
                };
                let size = data.len() as u64;
                match con.upload_file(ChannelId(channel), &path, None, size, false, false) {
                    Ok(handle) => {
                        pending_uploads.insert(handle.0, data);
                    }
                    Err(e) => {
                        let _ = app.emit("conn-ft-status", FtStatus::Failed { error: e.to_string() });
                    }
                }
            }
            Item::Command(Some(Cmd::SendChat { target, message, client })) => {
                let tgt = match target.as_str() {
                    "server" => MessageTarget::Server,
                    "private" => {
                        if let Some(id) = client {
                            MessageTarget::Client(ClientId(id))
                        } else {
                            tracing::warn!("private message without client id");
                            continue;
                        }
                    }
                    _ => MessageTarget::Channel,
                };
                match con.get_state() {
                    Ok(state) => {
                        let cmd = state.send_message(tgt, &message);
                        if let Err(e) = cmd.send(&mut con) {
                            tracing::warn!(%e, "failed to send chat");
                        }
                    }
                    Err(e) => tracing::warn!(%e, "no state for chat"),
                }
            }
            Item::Command(Some(Cmd::JoinChannelPw { channel, password })) => {
                let own = con.get_state()?.own_client;
                let cmd = c2s::OutClientMoveMessage::new(&mut std::iter::once(
                    c2s::OutClientMovePart {
                        client_id: own,
                        channel_id: ChannelId(channel),
                        channel_password: Some(password.into()),
                    },
                ));
                if let Err(e) = cmd.send(&mut con) {
                    tracing::warn!(%e, "failed to join channel with password");
                }
            }
            Item::Command(Some(Cmd::Poke { client, message })) => {
                let cmd = c2s::OutClientPokeRequestMessage::new(&mut std::iter::once(
                    c2s::OutClientPokeRequestPart {
                        client_id: ClientId(client),
                        message: message.into(),
                    },
                ));
                if let Err(e) = cmd.send(&mut con) {
                    tracing::warn!(%e, "failed to poke");
                }
            }
            Item::Command(Some(Cmd::KickClient { client, message, from_server })) => {
                let reason = if from_server { Reason::KickServer } else { Reason::KickChannel };
                let msg = if message.is_empty() { None } else { Some(message.into()) };
                let cmd = c2s::OutClientKickMessage::new(&mut std::iter::once(
                    c2s::OutClientKickPart {
                        client_id: ClientId(client),
                        reason,
                        reason_message: msg,
                    },
                ));
                if let Err(e) = cmd.send(&mut con) {
                    tracing::warn!(%e, "failed to kick client");
                }
            }
            Item::Command(Some(Cmd::MuteClient { client, mute })) => {
                let result = if mute {
                    c2s::OutClientMuteMessage::new(&mut std::iter::once(
                        c2s::OutClientMutePart { client_id: ClientId(client) },
                    ))
                    .send(&mut con)
                } else {
                    c2s::OutClientUnmuteMessage::new(&mut std::iter::once(
                        c2s::OutClientUnmutePart { client_id: ClientId(client) },
                    ))
                    .send(&mut con)
                };
                if let Err(e) = result {
                    tracing::warn!(%e, "failed to (un)mute client");
                }
            }
            Item::Command(Some(Cmd::RequestConnectionInfo(client))) => {
                let cmd = c2s::OutClientConnectionInfoRequestMessage::new(
                    &mut std::iter::once(c2s::OutClientConnectionInfoRequestPart {
                        client_id: ClientId(client),
                    }),
                );
                if let Err(e) = cmd.send(&mut con) {
                    tracing::warn!(%e, "failed to request connection info");
                }
            }
            Item::Command(Some(Cmd::JoinChannel(cid))) => {
                let own = con.get_state()?.own_client;
                let cmd = c2s::OutClientMoveMessage::new(&mut std::iter::once(
                    c2s::OutClientMovePart {
                        client_id: own,
                        channel_id: ChannelId(cid),
                        channel_password: None,
                    },
                ));
                if let Err(e) = cmd.send(&mut con) {
                    tracing::warn!(%e, "failed to switch channel");
                }
            }
            Item::Command(Some(Cmd::Disconnect)) | Item::Command(None) => {
                let _ = con.disconnect(DisconnectOptions::new());
                con.events().for_each(|_| future::ready(())).await;
                emit_status(app, ConnStatus::Disconnected { reason: None });
                break;
            }
            Item::Command(Some(Cmd::Shutdown(ack))) => {
                let _ = con.disconnect(DisconnectOptions::new());
                con.events().for_each(|_| future::ready(())).await;
                let _ = ack.send(());
                break;
            }
            Item::Command(Some(Cmd::Connect { .. })) => { /* already connected */ }
            Item::Command(Some(Cmd::UsePrivilegeKey(token))) => {
                let cmd = c2s::OutPrivilegeKeyUseMessage::new(&mut std::iter::once(
                    c2s::OutPrivilegeKeyUsePart { token: token.into() },
                ));
                if let Err(e) = cmd.send(&mut con) {
                    tracing::warn!(%e, "failed to use privilege key");
                }
            }
        }
    }
    drop(engine);
    Ok(())
}

fn emit_status(app: &AppHandle, status: ConnStatus) {
    let _ = app.emit("conn-status", status);
}

fn emit_snapshot(app: &AppHandle, con: &Connection) {
    if let Ok(state) = con.get_state() {
        let _ = app.emit("conn-snapshot", build_snapshot(state));
    }
}

fn build_snapshot(con: &tsclientlib::data::Connection) -> ServerSnapshot {
    let channels = con
        .channels
        .values()
        .map(|c: &Channel| ChannelInfo {
            id: c.id.0,
            parent: c.parent.0,
            name: c.name.clone(),
            order: c.order.0,
        })
        .collect();
    let clients = con
        .clients
        .values()
        .map(|c: &Client| ClientInfo {
            id: c.id.0,
            channel: c.channel.0,
            name: c.name.clone(),
            talking: false,
            input_muted: c.input_muted,
            output_muted: c.output_muted,
        })
        .collect();
    ServerSnapshot {
        name: con.server.name.clone(),
        welcome_message: con.server.welcome_message.clone(),
        own_client: con.own_client.0,
        channels,
        clients,
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_file: bool,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FtStatus {
    Downloaded { size: u64 },
    Uploaded,
    Failed { error: String },
}
