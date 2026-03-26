import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

export type TerminalVars = Record<string, string>;

const STATUS_DIR = path.join(os.tmpdir(), "terminal-manager");

export interface NotificationEvent {
  pid: number;
  message: string;
}

export class TerminalVarsWatcher implements vscode.Disposable {
  private vars: Map<number, TerminalVars> = new Map(); // pid -> vars
  private previousNotifications: Map<string, string> = new Map(); // realpath -> last notification
  private idleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map(); // realpath -> debounce timer
  private watcher: fs.FSWatcher | undefined;

  /** How long after the last vars update before considering Claude idle (ms) */
  private static readonly IDLE_DEBOUNCE_MS = 10_000;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private readonly _onDidRequestNotification = new vscode.EventEmitter<NotificationEvent>();
  readonly onDidRequestNotification = this._onDidRequestNotification.event;

  constructor() {
    this.ensureDir();
    this.startWatching();
    this.loadAll();
  }

  private ensureDir(): void {
    try {
      fs.mkdirSync(STATUS_DIR, { recursive: true });
    } catch {
      // ignore
    }
  }

  private startWatching(): void {
    try {
      this.watcher = fs.watch(STATUS_DIR, (_event, filename) => {
        if (filename?.endsWith(".json")) {
          this.loadFile(path.join(STATUS_DIR, filename));
        }
      });
    } catch {
      // Directory may not exist yet
    }
  }

  private loadAll(): void {
    try {
      const files = fs.readdirSync(STATUS_DIR);
      for (const file of files) {
        if (file.endsWith(".json")) {
          this.loadFile(path.join(STATUS_DIR, file));
        }
      }
    } catch {
      // ignore
    }
  }

  private loadFile(filePath: string): void {
    try {
      // Resolve symlinks so all PIDs pointing to the same file get updated
      const realPath = fs.realpathSync(filePath);
      const content = fs.readFileSync(realPath, "utf-8");
      const data = JSON.parse(content);
      if (typeof data !== "object" || data === null) return;

      // Flatten to string values
      const flat: TerminalVars = {};
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null && value !== "") {
          flat[key] = String(value);
        }
      }

      // Find all PIDs (filenames and symlinks) that resolve to this real path
      const pids = this.findPidsForRealPath(realPath);
      const triggerPid = parseInt(path.basename(filePath, ".json"), 10);
      if (!Number.isNaN(triggerPid) && !pids.includes(triggerPid)) {
        pids.push(triggerPid);
      }

      for (const pid of pids) {
        this.vars.set(pid, flat);
      }

      // Detect explicit notification transitions (from Notification hook)
      const notification = flat.notification || "";
      const prev = this.previousNotifications.get(realPath) || "";
      if (notification && notification !== prev) {
        this._onDidRequestNotification.fire({ pid: triggerPid, message: notification });
      }
      this.previousNotifications.set(realPath, notification);

      // Idle detection: reset debounce timer on every vars update.
      // When updates stop (Claude is idle), fire a notification.
      // Skip if there's already an explicit notification (e.g. approval prompt).
      const existingTimer = this.idleTimers.get(realPath);
      if (existingTimer) clearTimeout(existingTimer);

      if (!notification) {
        const timer = setTimeout(() => {
          this.idleTimers.delete(realPath);
          this._onDidRequestNotification.fire({
            pid: triggerPid,
            message: "Claude is done",
          });
        }, TerminalVarsWatcher.IDLE_DEBOUNCE_MS);
        this.idleTimers.set(realPath, timer);
      }

      this._onDidChange.fire();
    } catch {
      // Invalid file, ignore
    }
  }

  private findPidsForRealPath(realPath: string): number[] {
    const pids: number[] = [];
    try {
      const files = fs.readdirSync(STATUS_DIR);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const resolved = fs.realpathSync(path.join(STATUS_DIR, file));
          if (resolved === realPath) {
            const pid = parseInt(path.basename(file, ".json"), 10);
            if (!Number.isNaN(pid)) {
              pids.push(pid);
            }
          }
        } catch {
          // broken symlink, skip
        }
      }
    } catch {
      // ignore
    }
    return pids;
  }

  getVars(pid: number): TerminalVars | undefined {
    return this.vars.get(pid);
  }

  dispose(): void {
    this.watcher?.close();
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    this._onDidChange.dispose();
    this._onDidRequestNotification.dispose();
  }

  static get statusDir(): string {
    return STATUS_DIR;
  }
}
