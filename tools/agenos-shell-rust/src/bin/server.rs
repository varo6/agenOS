use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tiny_http::{Header, Method, Response, Server, StatusCode};

const HOST: &str = "0.0.0.0";
const PORT: u16 = 4174;
const STATIC_DIR: &str = "/usr/local/share/agenos-ui";
const SHELL_CONFIG_PATH: &str = "/etc/agenos/shell.json";
const SYSTEM_APPLICATIONS_DIR: &str = "/usr/share/applications";
const APP_WORKSPACE: &str = "2:app";
const APP_WORKSPACES: &[&str] = &["2:app", "3:web", "4:media", "5:work"];
const HOME_WORKSPACE: &str = "1:home";
const INSTALLER_URL: &str = "http://127.0.0.1:4173";
const BOOT_MODES: &[&str] = &["installer", "home", "app", "system"];

#[derive(Serialize, Deserialize, Clone)]
struct AppConfig {
    #[serde(rename = "desktopId")]
    desktop_id: String,
    name: String,
    description: String,
    #[serde(rename = "iconName")]
    icon_name: Option<String>,
    exec: String,
    categories: Vec<String>,
    source: String,
    hidden: bool,
}

#[derive(Deserialize)]
struct ShellConfigFile {
    #[serde(rename = "bootMode")]
    boot_mode: Option<String>,
    #[serde(rename = "startupAppDesktopId")]
    startup_app_desktop_id: Option<String>,
    #[serde(rename = "maintenanceEnabled")]
    maintenance_enabled: Option<bool>,
}

#[derive(Serialize)]
struct BootstrapPayload {
    #[serde(rename = "sessionToken")]
    session_token: String,
    #[serde(rename = "bootMode")]
    boot_mode: String,
    #[serde(rename = "isLiveSession")]
    is_live_session: bool,
    #[serde(rename = "maintenanceEnabled")]
    maintenance_enabled: bool,
    #[serde(rename = "startupAppDesktopId")]
    startup_app_desktop_id: Option<String>,
    #[serde(rename = "installerEnabled")]
    installer_enabled: bool,
}

fn is_live_session() -> bool {
    if Path::new("/run/live/medium").exists() {
        return true;
    }

    fs::read_to_string("/proc/cmdline")
        .map(|cmdline| cmdline.contains("boot=live") || cmdline.contains("components"))
        .unwrap_or(false)
}

fn load_bootstrap_payload(session_token: &str) -> BootstrapPayload {
    let live = is_live_session();
    let default_boot_mode = if live { "installer" } else { "home" }.to_string();
    let mut boot_mode = default_boot_mode;
    let mut startup_app_desktop_id = None;
    let mut maintenance_enabled = true;

    if let Ok(raw) = fs::read_to_string(SHELL_CONFIG_PATH) {
        if let Ok(config) = serde_json::from_str::<ShellConfigFile>(&raw) {
            if let Some(candidate) = config.boot_mode {
                if BOOT_MODES.contains(&candidate.as_str()) {
                    boot_mode = candidate;
                }
            }
            startup_app_desktop_id = config.startup_app_desktop_id;
            maintenance_enabled = config.maintenance_enabled.unwrap_or(true);
        }
    }

    if boot_mode == "installer" && !live {
        boot_mode = "home".to_string();
    }

    BootstrapPayload {
        session_token: session_token.to_string(),
        boot_mode,
        is_live_session: live,
        maintenance_enabled,
        startup_app_desktop_id,
        installer_enabled: live,
    }
}

fn generate_session_token() -> String {
    let mut bytes = [0u8; 32];
    if let Ok(mut file) = fs::File::open("/dev/urandom") {
        if file.read_exact(&mut bytes).is_ok() {
            return bytes.iter().map(|byte| format!("{:02x}", byte)).collect();
        }
    }

    let fallback = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{:032x}", fallback)
}

fn token_is_valid(request: &tiny_http::Request, session_token: &str) -> bool {
    request.headers().iter().any(|header| {
        header.field.equiv("X-Session-Token") && header.value.as_str() == session_token
    })
}

fn require_token(
    request: &tiny_http::Request,
    session_token: &str,
) -> Option<Response<std::io::Cursor<Vec<u8>>>> {
    if token_is_valid(request, session_token) {
        return None;
    }

    Some(send_json(
        StatusCode(403),
        json!({"ok": false, "message": "Token de sesión inválido."}),
    ))
}

fn discover_apps() -> Vec<AppConfig> {
    let mut apps: HashMap<String, AppConfig> = HashMap::new();
    let user_apps = format!(
        "{}/.local/share/applications",
        std::env::var("HOME").unwrap_or_else(|_| "/root".to_string())
    );

    for (dir, source) in [
        (Path::new(SYSTEM_APPLICATIONS_DIR), "system"),
        (Path::new(&user_apps), "user"),
    ] {
        if !dir.exists() {
            continue;
        }

        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) != Some("desktop") {
                    continue;
                }

                if let Some(parsed) = parse_desktop_file(&path, source) {
                    apps.insert(parsed.desktop_id.clone(), parsed);
                }
            }
        }
    }

    let mut visible: Vec<AppConfig> = apps.into_values().filter(|app| !app.hidden).collect();
    visible.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));

    visible.extend([
        AppConfig {
            desktop_id: "internal:terminal".to_string(),
            name: "Terminal de mantenimiento".to_string(),
            description: "Abre foot dentro de la sesión Wayland actual.".to_string(),
            icon_name: Some("utilities-terminal".to_string()),
            exec: "maintenance:terminal".to_string(),
            categories: vec!["System".to_string()],
            source: "internal".to_string(),
            hidden: true,
        },
        AppConfig {
            desktop_id: "internal:classic-installer".to_string(),
            name: "Instalación avanzada con Calamares".to_string(),
            description: "Abre Calamares clásico con el flujo completo.".to_string(),
            icon_name: Some("system-software-install".to_string()),
            exec: "maintenance:classic-installer".to_string(),
            categories: vec!["System".to_string()],
            source: "internal".to_string(),
            hidden: true,
        },
        AppConfig {
            desktop_id: "internal:reload-shell".to_string(),
            name: "Recargar shell".to_string(),
            description: "Reinicia el instalador sin reiniciar el sistema.".to_string(),
            icon_name: Some("view-refresh".to_string()),
            exec: "maintenance:reload-shell".to_string(),
            categories: vec!["System".to_string()],
            source: "internal".to_string(),
            hidden: true,
        },
    ]);

    visible
}

fn parse_desktop_file(path: &Path, source: &str) -> Option<AppConfig> {
    let desktop_id = path.file_name()?.to_str()?.to_string();
    if desktop_id == "agenos-installer.desktop" || desktop_id == "agenos-classic-installer.desktop"
    {
        return None;
    }

    let ini = ini::Ini::load_from_file(path).ok()?;
    let section = ini.section(Some("Desktop Entry"))?;

    if section.get("Type") != Some(&"Application".to_string()) {
        return None;
    }

    let hidden = section
        .get("Hidden")
        .map_or(false, |value| value == "true" || value == "1")
        || section
            .get("NoDisplay")
            .map_or(false, |value| value == "true" || value == "1");
    let categories = section
        .get("Categories")
        .map(|value| {
            value
                .split(';')
                .filter(|category| !category.is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    let name = section
        .get("Name")
        .map(|value| value.to_string())
        .unwrap_or_else(|| {
            desktop_id
                .split('.')
                .next()
                .unwrap_or(&desktop_id)
                .to_string()
        });

    Some(AppConfig {
        desktop_id,
        name,
        description: section
            .get("Comment")
            .map(|value| value.to_string())
            .unwrap_or_default()
            .trim()
            .to_string(),
        icon_name: section.get("Icon").map(|value| value.to_string()),
        exec: section
            .get("Exec")
            .map(|value| value.to_string())
            .unwrap_or_default()
            .trim()
            .to_string(),
        categories,
        source: source.to_string(),
        hidden,
    })
}

fn sanitize_exec(exec_line: &str) -> Vec<String> {
    let exec_line = exec_line.replace("%%", "__AGENOS_PERCENT__");
    let mut sanitized = String::new();
    let mut chars = exec_line.chars().peekable();

    while let Some(character) = chars.next() {
        if character == '%' {
            if let Some(&next) = chars.peek() {
                if "fFuUdDnNickvm".contains(next) {
                    chars.next();
                    continue;
                }
            }
        }
        sanitized.push(character);
    }

    let sanitized = sanitized.replace("__AGENOS_PERCENT__", "%");
    shlex::split(&sanitized)
        .unwrap_or_else(|| sanitized.split_whitespace().map(String::from).collect())
}

fn sway_command(command: &str) {
    let _ = Command::new("swaymsg")
        .arg(command)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn spawn_pkexec(args: &[&str]) -> (bool, Option<String>) {
    let mut child = match Command::new("pkexec")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => return (false, Some(error.to_string())),
    };

    thread::sleep(Duration::from_millis(100));
    match child.try_wait() {
        Ok(Some(status)) if status.success() => (true, None),
        Ok(Some(status)) => (
            false,
            Some(format!(
                "Error: helper exit code {}",
                status.code().unwrap_or(-1)
            )),
        ),
        Ok(None) => (true, None),
        Err(error) => (false, Some(error.to_string())),
    }
}

fn spawn_shell_helper(action: &str) -> (bool, Option<String>) {
    spawn_pkexec(&["/usr/local/bin/agenos-shell-helper", action])
}

fn spawn_installer_helper(args: &[&str]) -> (bool, Option<String>) {
    let mut command_args = vec!["/usr/local/bin/agenos-installer-helper"];
    command_args.extend_from_slice(args);
    spawn_pkexec(&command_args)
}

fn send_json(status: StatusCode, payload: serde_json::Value) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(payload.to_string())
        .with_status_code(status)
        .with_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap())
}

fn proxy_to_installer(req: &mut tiny_http::Request) -> Response<std::io::Cursor<Vec<u8>>> {
    let url = format!("{}{}", INSTALLER_URL, req.url());
    let result = if req.method() == &Method::Post {
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        ureq::post(&url)
            .set("Content-Type", "application/json")
            .send_string(&body)
    } else {
        ureq::get(&url).call()
    };

    match result {
        Ok(resp) => {
            let status = StatusCode(resp.status());
            if let Ok(json_body) = resp.into_json::<serde_json::Value>() {
                send_json(status, json_body)
            } else {
                send_json(
                    StatusCode(500),
                    json!({"ok": false, "message": "Respuesta no JSON del instalador"}),
                )
            }
        }
        Err(ureq::Error::Status(code, resp)) => {
            let status = StatusCode(code);
            if let Ok(json_body) = resp.into_json::<serde_json::Value>() {
                send_json(status, json_body)
            } else {
                send_json(
                    status,
                    json!({"ok": false, "message": "Error del instalador"}),
                )
            }
        }
        Err(error) => send_json(
            StatusCode(502),
            json!({"ok": false, "message": error.to_string()}),
        ),
    }
}

fn safe_static_path(path: &str) -> Option<PathBuf> {
    let mut target = PathBuf::from(STATIC_DIR);
    for component in Path::new(path.trim_start_matches('/')).components() {
        match component {
            Component::Normal(part) => target.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(target)
}

fn response_from_file(path: &Path) -> Option<Response<Box<dyn std::io::Read + Send + 'static>>> {
    let file = fs::File::open(path).ok()?;
    let content_type = match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
    {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css",
        "js" => "application/javascript",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "json" => "application/json",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    };

    Some(
        Response::from_file(file)
            .with_header(Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap())
            .boxed(),
    )
}

fn serve_index(session_token: &str) -> Response<Box<dyn std::io::Read + Send + 'static>> {
    let index_path = Path::new(STATIC_DIR).join("index.html");
    match fs::read_to_string(index_path) {
        Ok(body) => {
            let bootstrap = json!({"sessionToken": session_token}).to_string();
            Response::from_string(body.replace("__AGENOS_SHELL_BOOTSTRAP__", &bootstrap))
                .with_header(
                    Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
                        .unwrap(),
                )
                .boxed()
        }
        Err(_) => Response::empty(StatusCode(404)).boxed(),
    }
}

fn serve_static(
    path: &str,
    session_token: &str,
) -> Response<Box<dyn std::io::Read + Send + 'static>> {
    let Some(target) = safe_static_path(path) else {
        return Response::empty(StatusCode(400)).boxed();
    };

    if path == "/"
        || path.is_empty()
        || path == "/index.html"
        || !target.exists()
        || target.is_dir()
    {
        return serve_index(session_token);
    }

    response_from_file(&target).unwrap_or_else(|| Response::empty(StatusCode(404)).boxed())
}

fn find_workspace<'a>(
    node: &'a serde_json::Value,
    workspace_name: &str,
    target: &mut Option<&'a serde_json::Value>,
) {
    if target.is_some() {
        return;
    }

    if node.get("type").and_then(|value| value.as_str()) == Some("workspace")
        && node.get("name").and_then(|value| value.as_str()) == Some(workspace_name)
    {
        *target = Some(node);
        return;
    }

    for key in ["nodes", "floating_nodes"] {
        if let Some(children) = node.get(key).and_then(|value| value.as_array()) {
            for child in children {
                find_workspace(child, workspace_name, target);
            }
        }
    }
}

fn count_windows(node: &serde_json::Value) -> usize {
    let node_type = node
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let self_count = if (node_type == "con" || node_type == "floating_con")
        && (node.get("window").map_or(false, |value| !value.is_null())
            || node.get("app_id").map_or(false, |value| !value.is_null()))
    {
        1
    } else {
        0
    };

    let child_count = ["nodes", "floating_nodes"]
        .iter()
        .filter_map(|key| node.get(key).and_then(|value| value.as_array()))
        .flat_map(|children| children.iter())
        .map(count_windows)
        .sum::<usize>();

    self_count + child_count
}

fn workspace_window_count(workspace_name: &str) -> usize {
    let Ok(output) = Command::new("swaymsg")
        .args(["-t", "get_tree", "-r"])
        .output()
    else {
        return 0;
    };
    if !output.status.success() {
        return 0;
    }

    let Ok(tree) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return 0;
    };

    let mut target = None;
    find_workspace(&tree, workspace_name, &mut target);
    target.map(count_windows).unwrap_or(0)
}

fn focused_workspace_name() -> Option<String> {
    let Ok(output) = Command::new("swaymsg")
        .args(["-t", "get_tree", "-r"])
        .output()
    else {
        return None;
    };
    if !output.status.success() {
        return None;
    }

    let Ok(tree) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return None;
    };

    fn find_focused_workspace(node: &serde_json::Value) -> Option<String> {
        if node.get("type").and_then(|value| value.as_str()) == Some("workspace")
            && node.get("focused").and_then(|value| value.as_bool()) == Some(true)
        {
            return node
                .get("name")
                .and_then(|value| value.as_str())
                .map(str::to_string);
        }

        for key in ["nodes", "floating_nodes"] {
            if let Some(children) = node.get(key).and_then(|value| value.as_array()) {
                for child in children {
                    if let Some(workspace) = find_focused_workspace(child) {
                        return Some(workspace);
                    }
                }
            }
        }

        None
    }

    find_focused_workspace(&tree)
}

fn start_workspace_monitor() {
    thread::spawn(|| loop {
        if let Some(workspace) = focused_workspace_name() {
            if APP_WORKSPACES.contains(&workspace.as_str())
                && workspace_window_count(&workspace) == 0
            {
                sway_command(&format!("workspace \"{}\"", HOME_WORKSPACE));
            }
        } else if workspace_window_count(APP_WORKSPACE) == 0 {
            sway_command(&format!("workspace \"{}\"", HOME_WORKSPACE));
        }
        thread::sleep(Duration::from_secs(1));
    });
}

fn main() {
    let server = match Server::http(format!("{}:{}", HOST, PORT)) {
        Ok(server) => server,
        Err(error) => {
            eprintln!(
                "[agenos-shell] failed to listen on http://{}:{}: {}",
                HOST, PORT, error
            );
            std::process::exit(1);
        }
    };
    println!("[agenos-shell] listening on http://{}:{}", HOST, PORT);

    let session_token = generate_session_token();
    start_workspace_monitor();

    for mut request in server.incoming_requests() {
        let path = request.url().to_string();
        let method = request.method().clone();

        if path.starts_with("/api/installer/") {
            let resp = proxy_to_installer(&mut request);
            let _ = request.respond(resp);
            continue;
        }

        if method == Method::Get {
            if path == "/health" {
                let _ = request.respond(send_json(StatusCode(200), json!({"ok": true})));
                continue;
            }
            if path == "/api/bootstrap" {
                let _ = request.respond(send_json(
                    StatusCode(200),
                    serde_json::to_value(load_bootstrap_payload(&session_token)).unwrap(),
                ));
                continue;
            }
            if path == "/api/apps" {
                if let Some(resp) = require_token(&request, &session_token) {
                    let _ = request.respond(resp);
                    continue;
                }
                let _ = request.respond(send_json(
                    StatusCode(200),
                    serde_json::to_value(discover_apps()).unwrap(),
                ));
                continue;
            }

            let _ = request.respond(serve_static(&path, &session_token));
            continue;
        }

        if method == Method::Post {
            if path.starts_with("/api/") {
                if let Some(resp) = require_token(&request, &session_token) {
                    let _ = request.respond(resp);
                    continue;
                }
            }

            if path == "/api/apps/open" {
                let mut body = String::new();
                let _ = request.as_reader().read_to_string(&mut body);
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(desktop_id) = val.get("desktopId").and_then(|value| value.as_str())
                    {
                        if let Some(app) = discover_apps()
                            .into_iter()
                            .find(|app| app.desktop_id == desktop_id)
                        {
                            if app.source != "internal" {
                                let cmd = sanitize_exec(&app.exec);
                                if !cmd.is_empty() {
                                    sway_command(&format!(
                                        "[workspace=\"{}\"] kill",
                                        APP_WORKSPACE
                                    ));
                                    sway_command(&format!("workspace \"{}\"", APP_WORKSPACE));
                                    let spawn_result = Command::new(&cmd[0])
                                        .args(&cmd[1..])
                                        .stdin(Stdio::null())
                                        .stdout(Stdio::null())
                                        .stderr(Stdio::null())
                                        .spawn();

                                    match spawn_result {
                                        Ok(_) => {
                                            let _ = request.respond(send_json(
                                                StatusCode(202),
                                                json!({"ok": true, "message": format!("Abriendo {} en {}.", app.name, APP_WORKSPACE)}),
                                            ));
                                            continue;
                                        }
                                        Err(error) => {
                                            let _ = request.respond(send_json(
                                                StatusCode(422),
                                                json!({"ok": false, "message": error.to_string()}),
                                            ));
                                            continue;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                let _ = request.respond(send_json(
                    StatusCode(400),
                    json!({"ok": false, "message": "App no encontrada o inválida."}),
                ));
                continue;
            }

            if path == "/api/system/poweroff" || path == "/api/system/reboot" {
                let action = if path.ends_with("poweroff") {
                    "poweroff"
                } else {
                    "reboot"
                };
                let (ok, msg) = spawn_shell_helper(action);
                let status = if ok { StatusCode(202) } else { StatusCode(500) };
                let _ = request.respond(send_json(status, json!({"ok": ok, "message": msg})));
                continue;
            }

            if path == "/api/system/maintenance" {
                let mut body = String::new();
                let _ = request.as_reader().read_to_string(&mut body);
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(action) = val.get("action").and_then(|value| value.as_str()) {
                        if action == "classic-installer" {
                            if !is_live_session() {
                                let _ = request.respond(send_json(
                                    StatusCode(403),
                                    json!({"ok": false, "message": "Calamares clásico solo está disponible en la sesión live."}),
                                ));
                                continue;
                            }
                            let (ok, msg) = spawn_installer_helper(&["classic"]);
                            let status = if ok { StatusCode(202) } else { StatusCode(500) };
                            let _ = request
                                .respond(send_json(status, json!({"ok": ok, "message": msg})));
                            continue;
                        }
                        if action == "terminal" || action == "reload-shell" {
                            let (ok, msg) = spawn_shell_helper(action);
                            let status = if ok { StatusCode(202) } else { StatusCode(500) };
                            let _ = request
                                .respond(send_json(status, json!({"ok": ok, "message": msg})));
                            continue;
                        }
                    }
                }
                let _ = request.respond(send_json(
                    StatusCode(400),
                    json!({"ok": false, "message": "Acción inválida"}),
                ));
                continue;
            }
        }

        let _ = request.respond(send_json(
            StatusCode(404),
            json!({"ok": false, "message": "Ruta no encontrada."}),
        ));
    }
}
