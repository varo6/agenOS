#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("AgenOS Installer")
            .fullscreen(true)
            .visible(true)
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AgenOS Installer");
}
