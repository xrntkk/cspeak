use std::fs;
use std::path::PathBuf;

use tsclientlib::Identity;

/// Load the persisted identity from disk, or create + save a new one.
/// The identity is the client's stable cryptographic key — losing it means
/// the server sees a brand-new user (permissions/assignments reset).
pub fn load_or_create(config_dir: &PathBuf) -> anyhow::Result<Identity> {
    let path = config_dir.join("identity.json");
    if let Ok(data) = fs::read_to_string(&path) {
        if let Ok(id) = serde_json::from_str::<Identity>(&data) {
            return Ok(id);
        }
    }
    let id = Identity::create();
    fs::create_dir_all(config_dir)?;
    fs::write(&path, serde_json::to_string_pretty(&id)?)?;
    Ok(id)
}
