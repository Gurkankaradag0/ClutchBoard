fn main() {
    // Dev builds read HDEV_API_KEY from ../.env; release builds never embed it.
    println!("cargo:rerun-if-changed=../.env");
    if let Ok(env) = std::fs::read_to_string("../.env") {
        if let Some(key) = env
            .lines()
            .find_map(|l| l.trim().strip_prefix("HDEV_API_KEY="))
        {
            println!(
                "cargo:rustc-env=HDEV_API_KEY_DEV={}",
                key.trim().trim_matches('"')
            );
        }
    }
    tauri_build::build()
}
