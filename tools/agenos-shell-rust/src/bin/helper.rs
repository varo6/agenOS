use nix::unistd::{setgid, setuid, Uid, User};
use std::env;
use std::process::{exit, Command, Stdio};

const PACKAGE_RESULT_PREFIX: &str = "AGENOS_PACKAGE_RESULT";

fn valid_debian_package_name(package: &str) -> bool {
    let bytes = package.as_bytes();
    if bytes.len() < 2
        || bytes.len() > 128
        || !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit()
    {
        return false;
    }

    bytes.iter().all(|byte| {
        byte.is_ascii_lowercase()
            || byte.is_ascii_digit()
            || *byte == b'+'
            || *byte == b'.'
            || *byte == b'-'
    })
}

fn package_install_args(package: &str) -> Option<Vec<&str>> {
    if !valid_debian_package_name(package) {
        return None;
    }
    Some(vec!["install", "--yes", "--no-remove", "--", package])
}

fn package_is_installed(package: &str) -> bool {
    match Command::new("/usr/bin/dpkg-query")
        .args(["-W", "-f=${db:Status-Abbrev}", package])
        .env_clear()
        .env("PATH", "/usr/sbin:/usr/bin:/sbin:/bin")
        .output()
    {
        Ok(output) => output.status.success() && output.stdout.starts_with(b"ii "),
        Err(_) => false,
    }
}

fn package_has_candidate(package: &str) -> bool {
    match Command::new("/usr/bin/apt-cache")
        .args(["policy", package])
        .env_clear()
        .env("PATH", "/usr/sbin:/usr/bin:/sbin:/bin")
        .env("LC_ALL", "C.UTF-8")
        .output()
    {
        Ok(output) if output.status.success() => {
            policy_has_exact_candidate(&output.stdout, package)
        }
        _ => false,
    }
}

fn policy_has_exact_candidate(output: &[u8], package: &str) -> bool {
    let expected_header = format!("{}:", package);
    let text = String::from_utf8_lossy(output);
    let mut in_exact_stanza = false;
    for line in text.lines() {
        if !line.starts_with(char::is_whitespace) {
            in_exact_stanza = line.trim() == expected_header;
            continue;
        }
        if in_exact_stanza {
            if let Some(candidate) = line.trim().strip_prefix("Candidate:") {
                let value = candidate.trim();
                return !value.is_empty() && value != "(none)";
            }
        }
    }
    false
}

fn install_package(package: &str) -> i32 {
    let args = match package_install_args(package) {
        Some(args) => args,
        None => {
            eprintln!("Invalid Debian package name.");
            return 2;
        }
    };

    if !Uid::effective().is_root() {
        eprintln!("Package installation requires the privileged helper through polkit.");
        return 1;
    }

    if package_is_installed(package) {
        println!("{} already-installed {}", PACKAGE_RESULT_PREFIX, package);
        return 0;
    }

    if !package_has_candidate(package) {
        eprintln!("The package has no exact candidate in the configured APT catalog.");
        println!("{} not-found {}", PACKAGE_RESULT_PREFIX, package);
        return 4;
    }

    let status = Command::new("/usr/bin/apt-get")
        .args(args)
        .env_clear()
        .env("PATH", "/usr/sbin:/usr/bin:/sbin:/bin")
        .env("LANG", "C.UTF-8")
        .env("LC_ALL", "C.UTF-8")
        .env("DEBIAN_FRONTEND", "noninteractive")
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status();

    match status {
        Ok(status) if status.success() => {
            println!("{} installed {}", PACKAGE_RESULT_PREFIX, package);
            0
        }
        Ok(status) => status.code().unwrap_or(1),
        Err(error) => {
            eprintln!("Failed to start apt-get: {}", error);
            1
        }
    }
}

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
    // El routing declarativo coloca foot en 5:work. Cambia primero al workspace
    // para que el terminal de mantenimiento nunca se abra fuera de la vista.
    command_as_original_user(
        &[
            "/usr/bin/sh",
            "-c",
            "swaymsg workspace '5:work' && exec /usr/bin/foot",
        ],
        false,
    )
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
            "Usage: {} <action> [typed-argument]",
            args.get(0).unwrap_or(&"agenos-shell-helper".to_string())
        );
        exit(2);
    }

    match args[1].as_str() {
        "terminal" => exit(terminal()),
        "reload-shell" => reload_shell(),
        "restart-agent" => exit(restart_agent()),
        "install-package" if args.len() == 3 => exit(install_package(&args[2])),
        "install-package" => {
            eprintln!("install-package requires exactly one Debian package name.");
            exit(2);
        }
        "poweroff" => power("poweroff"),
        "reboot" => power("reboot"),
        _ => exit(2),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_strict_debian_package_names() {
        for package in [
            "vlc",
            "firefox-esr",
            "libreoffice-writer",
            "g++",
            "libfoo2.0-1",
            "0ad",
        ] {
            assert!(
                valid_debian_package_name(package),
                "should accept {package}"
            );
        }
    }

    #[test]
    fn rejects_options_shell_metacharacters_paths_and_apt_selectors() {
        for package in [
            "-o",
            "--option",
            "v",
            "VLC",
            "vlc;id",
            "vlc && id",
            "$(id)",
            "`id`",
            "../../tmp/evil.deb",
            "./evil.deb",
            "vlc=3.0.0",
            "vlc:amd64",
            "vlc\nreboot",
            "fóo",
        ] {
            assert!(
                !valid_debian_package_name(package),
                "should reject {package:?}"
            );
            assert!(package_install_args(package).is_none());
        }
    }

    #[test]
    fn constructs_one_fixed_apt_get_install_operation() {
        assert_eq!(
            package_install_args("firefox-esr"),
            Some(vec!["install", "--yes", "--no-remove", "--", "firefox-esr"])
        );
    }

    #[test]
    fn requires_an_exact_candidate_from_apt_policy() {
        assert!(policy_has_exact_candidate(
            b"firefox-esr:\n  Installed: (none)\n  Candidate: 128.0esr-1\n",
            "firefox-esr"
        ));
        assert!(!policy_has_exact_candidate(
            b"spotify-client:\n  Installed: (none)\n  Candidate: (none)\n",
            "spotify-client"
        ));
        assert!(!policy_has_exact_candidate(
            b"other:\n  Candidate: 1.0\n",
            "firefox-esr"
        ));
        assert!(!policy_has_exact_candidate(
            b"firefox-esr:\n  Candidate:\n",
            "firefox-esr"
        ));
    }
}
