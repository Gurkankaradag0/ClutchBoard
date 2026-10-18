fn main() {
    // The NSIS installer to embed. tools/release.ts sets it; other builds get an empty file.
    println!("cargo:rerun-if-env-changed=CB_INSTALLER");
    if std::env::var_os("CB_INSTALLER").is_none() {
        let empty = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("empty.exe");
        std::fs::write(&empty, []).unwrap();
        println!("cargo:rustc-env=CB_INSTALLER={}", empty.display());
    }
    tauri_build::build()
}
