use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct ChannelInfo {
    pub id: u64,
    pub parent: u64,
    pub name: String,
    pub order: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub id: u16,
    pub channel: u64,
    pub name: String,
    pub talking: bool,
    pub input_muted: bool,
    pub output_muted: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSnapshot {
    pub name: String,
    pub welcome_message: String,
    pub own_client: u16,
    pub channels: Vec<ChannelInfo>,
    pub clients: Vec<ClientInfo>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConnStatus {
    Connecting,
    Connected,
    Disconnected { reason: Option<String> },
    Error { message: String },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// "server", "channel", or "private".
    pub scope: String,
    pub from: String,
    pub from_id: u16,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnInfo {
    pub client_id: u16,
    /// Round-trip ping in milliseconds.
    pub ping_ms: Option<f64>,
    /// Server→client speech packet loss (0.0–1.0).
    pub packet_loss: Option<f32>,
}
