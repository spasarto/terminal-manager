import { execFile } from "node:child_process";
import * as vscode from "vscode";

export interface TerminalInfo {
  terminal: vscode.Terminal;
  name: string;
  isRunning: boolean;
  runningCommand: string;
  processIcon: string;
  processColor: string;
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

interface ProcessStyleRule {
  match: string;
  icon?: string;
  color?: string;
}

export class TerminalTracker implements vscode.Disposable {
  private terminals: Map<vscode.Terminal, TerminalInfo> = new Map();
  private disposables: vscode.Disposable[] = [];
  private activeTerminal: vscode.Terminal | undefined;
  private pollInterval: ReturnType<typeof setInterval> | undefined;
  private idleTimers: Map<vscode.Terminal, ReturnType<typeof setTimeout>> = new Map();

  /** How long to wait after a command ends before marking idle (ms) */
  private static readonly IDLE_DEBOUNCE_MS = 5000;

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
        const timer = this.idleTimers.get(t);
        if (timer) {
          clearTimeout(timer);
          this.idleTimers.delete(t);
        }
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

      // Shell integration for running/idle detection.
      // Idle transition is debounced so that gaps between sequential
      // sub-commands (e.g. Claude Code tool calls) don't flicker to idle.
      vscode.window.onDidStartTerminalShellExecution((e) => {
        // Cancel any pending idle transition
        const timer = this.idleTimers.get(e.terminal);
        if (timer) {
          clearTimeout(timer);
          this.idleTimers.delete(e.terminal);
        }
        const info = this.terminals.get(e.terminal);
        if (info) {
          const cmd = e.execution.commandLine.value.trim();
          info.runningCommand = cmd.split(/\s+/)[0].split("/").pop() || cmd;
          if (!info.isRunning) {
            info.isRunning = true;
          }
          this._onDidChange.fire();
        }
      }),
      vscode.window.onDidEndTerminalShellExecution((e) => {
        // Clear any existing timer first
        const existing = this.idleTimers.get(e.terminal);
        if (existing) {
          clearTimeout(existing);
        }
        // Debounce the idle transition
        const timer = setTimeout(async () => {
          this.idleTimers.delete(e.terminal);
          const info = this.terminals.get(e.terminal);
          if (!info?.isRunning) return;

          // Check if a child process is still running (e.g. interactive REPL)
          const pid = await e.terminal.processId;
          if (pid) {
            const childName = await this.getChildProcessName(pid);
            if (childName) {
              // Keep existing command name if we have one (matches user's processStyles regex),
              // otherwise use the detected name (e.g. after a window reload)
              if (!info.runningCommand) {
                info.runningCommand = childName;
              }
              this._onDidChange.fire();
              return;
            }
          }

          info.isRunning = false;
          info.runningCommand = "";
          this._onDidChange.fire();
        }, TerminalTracker.IDLE_DEBOUNCE_MS);
        this.idleTimers.set(e.terminal, timer);
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

    // Detect already-running processes in restored terminals.
    // Shell execution events only fire for new commands, so after a reload
    // we probe child processes to find anything that was already running.
    this.detectRunningProcesses();
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
      runningCommand: "",
      processIcon: "",
      processColor: "",
      hasUnread: false,
      cwd: "",
      iconId: "terminal",
      color: "",
      lastFocusedAt: Date.now(),
      lastOutputAt: 0,
    });
  }

  private async detectRunningProcesses(): Promise<void> {
    let changed = false;
    for (const [terminal, info] of this.terminals) {
      const pid = await terminal.processId;
      if (!pid) continue;
      const childName = await this.getChildProcessName(pid);
      if (childName && !info.isRunning) {
        info.isRunning = true;
        info.runningCommand = childName;
        changed = true;
      }
    }
    if (changed) {
      this._onDidChange.fire();
    }
  }

  private getChildProcessName(pid: number): Promise<string | undefined> {
    return new Promise((resolve) => {
      // Find child processes of the terminal shell, skipping the shell itself.
      // Walk down the process tree to find the deepest meaningful process.
      execFile("pgrep", ["-P", String(pid)], (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve(undefined);
          return;
        }
        const childPids = stdout.trim().split("\n");
        // Get the command name of the first child
        execFile("ps", ["-o", "comm=", "-p", childPids[0]], (err2, stdout2) => {
          if (err2 || !stdout2.trim()) {
            resolve(undefined);
            return;
          }
          resolve(stdout2.trim().split("/").pop());
        });
      });
    });
  }

  getTerminals(): TerminalInfo[] {
    const config = vscode.workspace.getConfiguration("terminalManager");
    const styles = config.get<StyleRule[]>("tabStyles", []);
    const processStyles = config.get<ProcessStyleRule[]>("processStyles", []);

    const result: TerminalInfo[] = [];
    for (const [terminal, info] of this.terminals) {
      info.name = terminal.name;
      this.applyStyle(info, styles);
      this.applyProcessStyle(info, processStyles);
      result.push(info);
    }
    return result;
  }

  private applyStyle(info: TerminalInfo, styles: StyleRule[]): void {
    // Defaults from creationOptions
    const opts = info.terminal.creationOptions as vscode.TerminalOptions;
    let iconId = "terminal";
    if (opts.iconPath && "id" in opts.iconPath) {
      iconId = opts.iconPath.id;
    }
    let color = typeof opts.color?.id === "string" ? opts.color.id : "";

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

  private applyProcessStyle(info: TerminalInfo, processStyles: ProcessStyleRule[]): void {
    info.processIcon = "";
    info.processColor = "";

    if (!info.isRunning || !info.runningCommand) return;

    for (const rule of processStyles) {
      try {
        if (new RegExp(rule.match).test(info.runningCommand)) {
          if (rule.icon) {
            info.processIcon = rule.icon;
            if (info.iconId === "terminal") {
              info.iconId = rule.icon;
            }
          }
          if (rule.color) {
            info.processColor = rule.color;
            if (!info.color) {
              info.color = rule.color;
            }
          }
          break;
        }
      } catch {
        // Invalid regex, skip
      }
    }
  }

  getActiveTerminal(): vscode.Terminal | undefined {
    return this.activeTerminal;
  }

  dispose(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    for (const d of this.disposables) d.dispose();
    this._onDidChange.dispose();
  }
}
