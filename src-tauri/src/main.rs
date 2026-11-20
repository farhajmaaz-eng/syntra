#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    webview::{NewWindowResponse, WebviewWindowBuilder},
    AppHandle, Manager, RunEvent, State, Url, WebviewUrl, WebviewWindow,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct Desktop {
    origin: Mutex<Option<Url>>,
    closing: AtomicBool,
    done: Mutex<Option<mpsc::Receiver<()>>>,
}

impl Desktop {
    fn allows(&self, url: &Url) -> bool {
        self.origin.lock().unwrap().as_ref()
            .is_some_and(|origin| origin.origin() == url.origin())
    }
}

fn open_external(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "https" | "http")
        && url.username().is_empty()
        && url.password().is_none()
    {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

fn notification(app: &AppHandle, text: &str) {
    let _ = app.notification().builder().title("Syntra Studio").body(text).show();
}

fn verify_window(window: &WebviewWindow, desktop: &Desktop) -> Result<(), String> {
    if window.label() != "main" || !window.url().is_ok_and(|url| desktop.allows(&url)) {
        Err("Desktop command unavailable outside the Syntra workspace.".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
async fn pick_project_folder(
    window: WebviewWindow,
    desktop: State<'_, Arc<Desktop>>,
) -> Result<Option<String>, String> {
    verify_window(&window, &desktop)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_parent(&window).set_title("Choose a Syntra project folder")
            .blocking_pick_folder()
            .map(|path| path.into_path().map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string()))
            .transpose()
    }).await.map_err(|e| e.to_string())?
}

fn show_window(app: &AppHandle, desktop: Arc<Desktop>, url: Url) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        return window.navigate(url);
    }
    let refresh = MenuItem::with_id(app, "refresh", "Reload workspace", true, Some("Ctrl+R"))?;
    let search = MenuItem::with_id(app, "search", "Search workspace", true, Some("Ctrl+K"))?;
    let data_folder = MenuItem::with_id(app, "data", "Open data folder", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Exit", true, Some("Alt+F4"))?;
    let file = Submenu::with_items(app, "File", true, &[&data_folder, &quit])?;
    let workspace = Submenu::with_items(app, "Workspace", true, &[&search, &refresh])?;
    let menu = Menu::with_items(app, &[&file, &workspace])?;
    let navigation_desktop = desktop.clone();
    let navigation_app = app.clone();
    let new_window_app = app.clone();
    let new_window_desktop = desktop.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Syntra Studio")
        .inner_size(1380.0, 900.0)
        .min_inner_size(800.0, 620.0)
        .menu(menu)
        .on_navigation(move |url| {
            if navigation_desktop.allows(url) {
                return true;
            }
            open_external(&navigation_app, url);
            false
        })
        .on_new_window(move |url, _| {
            if new_window_desktop.allows(&url) {
                return NewWindowResponse::Allow;
            }
            open_external(&new_window_app, &url);
            NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

fn supervise(app: AppHandle, desktop: Arc<Desktop>, runtime: PathBuf, data: PathBuf) {
    let mut attempts = 0;
    while !desktop.closing.load(Ordering::Acquire) {
        let notifications = app.clone();
        match backend::Backend::launch(&runtime, &data, move |kind| match kind {
            "attention" => notification(&notifications, "An agent needs your input in Syntra."),
            "review" => notification(&notifications, "New work is ready for review."),
            _ => {}
        }) {
            Ok(mut backend) => {
                if desktop.closing.load(Ordering::Acquire) {
                    backend.shutdown();
                    return;
                }
                let origin = Url::parse(&format!("http://127.0.0.1:{}/", backend.port)).unwrap();
                let url = origin.join(&format!("__syntra_desktop/{}", backend.token)).unwrap();
                *desktop.origin.lock().unwrap() = Some(origin);
                let handle = app.clone();
                let state = desktop.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Err(error) = show_window(&handle, state, url) {
                        eprintln!("Syntra window failed: {error}");
                        handle.dialog().message("Syntra could not open its window. Check that Microsoft Edge WebView2 is installed.")
                            .kind(MessageDialogKind::Error).show(move |_| handle.exit(1));
                    }
                });
                loop {
                    if desktop.closing.load(Ordering::Acquire) {
                        backend.shutdown();
                        return;
                    }
                    if !matches!(backend.child.try_wait(), Ok(None)) {
                        break;
                    }
                    thread::sleep(Duration::from_millis(200));
                }
                *desktop.origin.lock().unwrap() = None;
                drop(backend);
                if attempts == 0 {
                    notification(&app, "The local service stopped. Syntra is restarting it.");
                    attempts += 1;
                    continue;
                }
                report_failure(&app, "The local service stopped again. Restart Syntra to reopen your saved workspace.");
                return;
            }
            Err(error) => {
                eprintln!("Syntra backend failed: {error}");
                report_failure(&app, &format!("The local service could not start. See desktop.log in {}.\n{error}", data.display()));
                return;
            }
        }
    }
}

fn report_failure(app: &AppHandle, detail: &str) {
    let handle = app.clone();
    app.dialog().message(detail).title("Syntra Desktop").kind(MessageDialogKind::Error)
        .show(move |_| handle.exit(1));
}

fn main() {
    let desktop = Arc::new(Desktop::default());
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(desktop.clone())
        .invoke_handler(tauri::generate_handler![pick_project_folder])
        .on_menu_event(|app, event| {
            let Some(window) = app.get_webview_window("main") else { return; };
            match event.id().as_ref() {
                "quit" => app.exit(0),
                "refresh" if verify_window(&window, app.state::<Arc<Desktop>>().inner()).is_ok() => {
                    let _ = window.reload();
                }
                "search" if verify_window(&window, app.state::<Arc<Desktop>>().inner()).is_ok() => {
                    let _ = window.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));");
                }
                "data" => {
                    if let Ok(path) = app.path().app_local_data_dir() {
                        let _ = app.opener().open_path(path.to_string_lossy(), None::<&str>);
                    }
                }
                _ => {}
            }
        })
        .setup(move |app| {
            let data = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let runtime = app.path().resource_dir()?.join("runtime");
            let (tx, rx) = mpsc::channel();
            *desktop.done.lock().unwrap() = Some(rx);
            let handle = app.handle().clone();
            let state = desktop.clone();
            thread::spawn(move || {
                supervise(handle, state, runtime, data);
                let _ = tx.send(());
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("initialize Syntra Desktop")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                let desktop = app.state::<Arc<Desktop>>();
                desktop.closing.store(true, Ordering::Release);
                if let Some(done) = desktop.done.lock().unwrap().take() {
                    let _ = done.recv_timeout(Duration::from_secs(19));
                };
            }
        });
}
