use nix::unistd::{setgid, setuid, Uid, User};
use std::env;
use std::process::{exit, Command};

fn original_uid() -> u32 {
    if let Ok(val) = env::var("PKEXEC_UID") {
        if let Ok(uid) = val.parse::<u32>() {
            return uid;
        }
    }
    Uid::current().as_raw()
}

fn user_env(uid: u32, home: &str) -> Vec<(String, String)> {
    let runtime_dir = format!("/run/user/{}", uid);

    vec![
        ("HOME".to_string(), home.to_string()),
        (
            "LANG".to_string(),
            env::var("LANG").unwrap_or_else(|_| "C.UTF-8".to_string()),
        ),
        (
            "PATH".to_string(),
            env::var("PATH").unwrap_or_else(|_| {
                "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin".to_string()
            }),
        ),
        (
            "DISPLAY".to_string(),
            env::var("DISPLAY").unwrap_or_default(),
        ),
        (
            "WAYLAND_DISPLAY".to_string(),
            env::var("WAYLAND_DISPLAY").unwrap_or_default(),
        ),
        (
            "XDG_RUNTIME_DIR".to_string(),
            env::var("XDG_RUNTIME_DIR").unwrap_or(runtime_dir),
        ),
        (
            "XDG_SESSION_TYPE".to_string(),
            env::var("XDG_SESSION_TYPE").unwrap_or_else(|_| "wayland".to_string()),
        ),
        (
            "XDG_CURRENT_DESKTOP".to_string(),
            env::var("XDG_CURRENT_DESKTOP").unwrap_or_else(|_| "AgenOS".to_string()),
        ),
        (
            "DBUS_SESSION_BUS_ADDRESS".to_string(),
            env::var("DBUS_SESSION_BUS_ADDRESS").unwrap_or_default(),
        ),
    ]
}

fn command_as_original_user(command: &[&str], wait: bool) -> i32 {
    let uid_raw = original_uid();
    let user = match User::from_uid(Uid::from_raw(uid_raw)) {
        Ok(Some(u)) => u,
        _ => {
            eprintln!("Failed to get user info for uid {}", uid_raw);
            return 1;
        }
    };

    let uid = Uid::from_raw(uid_raw);
    let gid = user.gid;

    if setgid(gid).is_err() {
        eprintln!("Failed to setgid");
        return 1;
    }
    if setuid(uid).is_err() {
        eprintln!("Failed to setuid");
        return 1;
    }

    let envs = user_env(uid_raw, user.dir.to_str().unwrap_or("/"));

    let mut cmd = Command::new(command[0]);
    cmd.args(&command[1..]);
    cmd.env_clear();
    for (k, v) in envs {
        cmd.env(k, v);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());

    if wait {
        match cmd.status() {
            Ok(status) => status.code().unwrap_or(1),
            Err(error) => {
                eprintln!("Failed to run {}: {}", command[0], error);
                1
            }
        }
    } else {
        match cmd.spawn() {
            Ok(_) => 0,
            Err(error) => {
                eprintln!("Failed to spawn {}: {}", command[0], error);
                1
            }
        }
    }
}

fn terminal() -> i32 {
    command_as_original_user(&["/usr/bin/foot"], false)
}

fn reload_shell() -> ! {
    let uid = original_uid().to_string();
    let mut cmd = Command::new("pkill");
    cmd.args(&[
        "-u",
        &uid,
        "-f",
        "agenos-installer-app|agenos-system-app|/opt/agenos/installer/agenos-installer$|agenos-installer-ui|/opt/agenos/installer/agenos-installer-ui|agenos-system-ui|/opt/agenos/system/agenos-system-ui"
    ]);

    match cmd.status() {
        Ok(status) => {
            let code = status.code().unwrap_or(1);
            if code == 0 || code == 1 {
                exit(code);
            }
            exit(code);
        }
        Err(_) => exit(1),
    }
}

fn power(action: &str) -> ! {
    let mut cmd = Command::new("/usr/bin/systemctl");
    cmd.arg(action);
    match cmd.status() {
        Ok(status) => exit(status.code().unwrap_or(1)),
        Err(_) => exit(1),
    }
}

fn restart_agent() -> i32 {
    match Command::new("/usr/bin/systemctl")
        .args(["restart", "agenos-openclaw.service"])
        .status()
    {
        Ok(status) => status.code().unwrap_or(1),
        Err(error) => {
            eprintln!("Failed to restart agenos-openclaw.service: {}", error);
            1
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!(
            "Usage: {} <action>",
            args.get(0).unwrap_or(&"agenos-shell-helper".to_string())
        );
        exit(2);
    }

    match args[1].as_str() {
        "terminal" => exit(terminal()),
        "reload-shell" => reload_shell(),
        "restart-agent" => exit(restart_agent()),
        "poweroff" => power("poweroff"),
        "reboot" => power("reboot"),
        _ => exit(2),
    }
}
