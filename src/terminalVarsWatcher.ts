import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

export type TerminalVars = Record<string, string>;

const STATUS_DIR = path.join(os.tmpdir(), "terminal-manager");

export class TerminalVarsWatcher implements vscode.Disposable {
  private vars: Map<number, TerminalVars> = new Map(); // pid -> vars
  private watcher: fs.FSWatcher | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

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
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      const pid = parseInt(path.basename(filePath, ".json"), 10);
      if (!Number.isNaN(pid) && typeof data === "object" && data !== null) {
        // Flatten to string values
        const flat: TerminalVars = {};
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined && value !== null && value !== "") {
            flat[key] = String(value);
          }
        }
        this.vars.set(pid, flat);
        this._onDidChange.fire();
      }
    } catch {
      // Invalid file, ignore
    }
  }

  getVars(pid: number): TerminalVars | undefined {
    return this.vars.get(pid);
  }

  dispose(): void {
    this.watcher?.close();
    this._onDidChange.dispose();
  }

  static get statusDir(): string {
    return STATUS_DIR;
  }
}
