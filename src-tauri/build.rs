fn main() {
    let manifest = tauri_build::AppManifest::new()
        .commands(&["pick_project_folder"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("build Syntra Desktop");
}
