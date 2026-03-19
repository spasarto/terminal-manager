import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ClaudeStatus {
  [key: string]: unknown;
}

const STATUS_DIR = path.join(os.tmpdir(), 'terminal-manager-claude');

export class ClaudeStatusWatcher implements vscode.Disposable {
  private statuses: Map<number, ClaudeStatus> = new Map(); // pid -> status
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
        if (filename && filename.endsWith('.json')) {
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
        if (file.endsWith('.json')) {
          this.loadFile(path.join(STATUS_DIR, file));
        }
      }
    } catch {
      // ignore
    }
  }

  private loadFile(filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as ClaudeStatus;
      const pid = parseInt(path.basename(filePath, '.json'), 10);
      if (!isNaN(pid)) {
        this.statuses.set(pid, data);
        this._onDidChange.fire();
      }
    } catch {
      // Invalid file, ignore
    }
  }

  getStatus(pid: number): ClaudeStatus | undefined {
    return this.statuses.get(pid);
  }

  /** Resolve a dotted path like "context_window.remaining_percentage" from the status JSON */
  static resolveField(status: ClaudeStatus, fieldPath: string): unknown {
    const parts = fieldPath.split('.');
    let current: unknown = status;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  dispose(): void {
    this.watcher?.close();
    this._onDidChange.dispose();
  }

  static get statusDir(): string {
    return STATUS_DIR;
  }
}
