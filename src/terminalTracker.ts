import * as vscode from 'vscode';

export interface TerminalInfo {
  terminal: vscode.Terminal;
  name: string;
  isRunning: boolean;
  hasUnread: boolean;
  cwd: string;
  iconId: string;
  color: string;
  lastFocusedAt: number;
  lastOutputAt: number;
}

interface StyleRule {
  match: string;
  icon?: string;
  color?: string;
}

export class TerminalTracker implements vscode.Disposable {
  private terminals: Map<vscode.Terminal, TerminalInfo> = new Map();
  private disposables: vscode.Disposable[] = [];
  private activeTerminal: vscode.Terminal | undefined;
  private pollInterval: ReturnType<typeof setInterval> | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor() {
    // Track existing terminals
    for (const terminal of vscode.window.terminals) {
      this.addTerminal(terminal);
    }
    this.activeTerminal = vscode.window.activeTerminal;

    // Terminal lifecycle
    this.disposables.push(
      vscode.window.onDidOpenTerminal((t) => {
        this.addTerminal(t);
        this._onDidChange.fire();
      }),
      vscode.window.onDidCloseTerminal((t) => {
        this.terminals.delete(t);
        this._onDidChange.fire();
      }),
      vscode.window.onDidChangeActiveTerminal((t) => {
        // Mark the previously active terminal's unread as cleared
        // Mark the newly active terminal as read
        if (t) {
          const info = this.terminals.get(t);
          if (info) {
            info.hasUnread = false;
            info.lastFocusedAt = Date.now();
          }
        }
        this.activeTerminal = t;
        this._onDidChange.fire();
      }),

      // Shell integration for running/idle detection
      vscode.window.onDidStartTerminalShellExecution((e) => {
        const info = this.terminals.get(e.terminal);
        if (info) {
          info.isRunning = true;
          this._onDidChange.fire();
        }
      }),
      vscode.window.onDidEndTerminalShellExecution((e) => {
        const info = this.terminals.get(e.terminal);
        if (info) {
          info.isRunning = false;
          this._onDidChange.fire();
        }
      }),

      // Terminal name changes
      vscode.window.onDidChangeTerminalState((t) => {
        const info = this.terminals.get(t);
        if (info) {
          info.name = t.name;
          this._onDidChange.fire();
        }
      }),
    );

    // Approximate "unread" by marking terminals as unread when a command finishes
    // while they are not the active terminal (the real onDidWriteTerminalData is a proposed API)
    this.disposables.push(
      vscode.window.onDidEndTerminalShellExecution((e) => {
        const info = this.terminals.get(e.terminal);
        if (info && e.terminal !== this.activeTerminal) {
          info.hasUnread = true;
          info.lastOutputAt = Date.now();
          this._onDidChange.fire();
        }
      }),
    );

    // Poll for property changes (name, icon, color) that have no dedicated events.
    // terminal.name is live but icon/color are only on creationOptions (a snapshot),
    // so icon/color changes made via the UI cannot be detected.
    this.pollInterval = setInterval(() => this.pollForChanges(), 2000);
  }

  private pollForChanges(): void {
    let changed = false;
    for (const [terminal, info] of this.terminals) {
      if (info.name !== terminal.name) {
        info.name = terminal.name;
        changed = true;
      }
    }
    if (changed) {
      this._onDidChange.fire();
    }
  }

  private addTerminal(terminal: vscode.Terminal): void {
    this.terminals.set(terminal, {
      terminal,
      name: terminal.name,
      isRunning: false,
      hasUnread: false,
      cwd: '',
      iconId: 'terminal',
      color: '',
      lastFocusedAt: Date.now(),
      lastOutputAt: 0,
    });
  }

  getTerminals(): TerminalInfo[] {
    const styles = vscode.workspace
      .getConfiguration('terminalManager')
      .get<StyleRule[]>('styles', []);

    const result: TerminalInfo[] = [];
    for (const [terminal, info] of this.terminals) {
      info.name = terminal.name;
      this.applyStyle(info, styles);
      result.push(info);
    }
    return result;
  }

  private applyStyle(info: TerminalInfo, styles: StyleRule[]): void {
    // Defaults from creationOptions
    const opts = info.terminal.creationOptions as vscode.TerminalOptions;
    let iconId = 'terminal';
    if (opts.iconPath && 'id' in opts.iconPath) {
      iconId = opts.iconPath.id;
    }
    let color = typeof opts.color?.id === 'string' ? opts.color.id : '';

    // First matching style rule wins
    for (const rule of styles) {
      try {
        if (new RegExp(rule.match).test(info.name)) {
          if (rule.icon) iconId = rule.icon;
          if (rule.color) color = rule.color;
          break;
        }
      } catch {
        // Invalid regex, skip
      }
    }

    info.iconId = iconId;
    info.color = color;
  }

  getActiveTerminal(): vscode.Terminal | undefined {
    return this.activeTerminal;
  }

  dispose(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.disposables.forEach((d) => d.dispose());
    this._onDidChange.dispose();
  }
}
