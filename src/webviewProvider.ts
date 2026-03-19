import * as vscode from 'vscode';
import { TerminalTracker, TerminalInfo } from './terminalTracker';

export class TerminalManagerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'terminalManager.view';

  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly tracker: TerminalTracker,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.disposables.push(
      tracker.onDidChange(() => this.updateView()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('terminalManager.fields') || e.affectsConfiguration('terminalManager.styles')) {
          this.updateView();
        }
      }),
    );
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    const extensionUri = this.extensionUri;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [extensionUri],
    };

    const codiconUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'),
    );

    webviewView.webview.html = this.getHtml(codiconUri);

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case 'ready': {
          this.updateView();
          break;
        }
        case 'selectTerminal': {
          const terminals = this.tracker.getTerminals();
          const info = terminals[message.index];
          if (info) {
            info.terminal.show();
          }
          break;
        }
        case 'killTerminal': {
          const terminals = this.tracker.getTerminals();
          const info = terminals[message.index];
          if (info) {
            info.terminal.dispose();
          }
          break;
        }
      }
    });
  }

  private getFields(): string[] {
    const config = vscode.workspace.getConfiguration('terminalManager');
    return config.get<string[]>('fields', ['name', 'status', 'unread']);
  }

  private updateView(): void {
    if (!this.view) return;

    const terminals = this.tracker.getTerminals();
    const activeTerminal = this.tracker.getActiveTerminal();
    const fields = this.getFields();

    const data = terminals.map((info) => ({
      name: info.name,
      isRunning: info.isRunning,
      hasUnread: info.hasUnread,
      isActive: info.terminal === activeTerminal,
      iconId: info.iconId,
      color: info.color,
    }));

    this.view.webview.postMessage({ type: 'update', terminals: data, fields });
  }

  private getHtml(codiconUri: vscode.Uri): string {
    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${codiconUri}">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: transparent;
    }
    .terminal-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
    }
    .terminal-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
    }
    .terminal-item:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .terminal-item.active {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .terminal-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .terminal-icon {
      font-size: 1em;
      width: 16px;
      text-align: center;
      flex-shrink: 0;
    }
    .terminal-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }
    .terminal-row-secondary {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85em;
      opacity: 0.8;
      padding-left: 22px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 6px;
      border-radius: 8px;
      font-size: 0.85em;
    }
    .badge-running {
      background: var(--vscode-testing-runAction);
      color: var(--vscode-editor-background);
    }
    .badge-idle {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .badge-unread {
      background: var(--vscode-notificationsInfoIcon-foreground);
      color: var(--vscode-editor-background);
    }
    .kill-btn {
      opacity: 0;
      background: none;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 1em;
    }
    .terminal-item:hover .kill-btn {
      opacity: 0.6;
    }
    .kill-btn:hover {
      opacity: 1 !important;
      background: var(--vscode-toolbar-hoverBackground);
    }
    .empty-state {
      padding: 16px;
      text-align: center;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <div class="terminal-list" id="list">
    <div class="empty-state">No terminals open</div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const list = document.getElementById('list');

    // Map of VS Code ThemeColor ids to CSS variable names
    const colorMap = {
      'terminal.ansiBlack': 'var(--vscode-terminal-ansiBlack)',
      'terminal.ansiRed': 'var(--vscode-terminal-ansiRed)',
      'terminal.ansiGreen': 'var(--vscode-terminal-ansiGreen)',
      'terminal.ansiYellow': 'var(--vscode-terminal-ansiYellow)',
      'terminal.ansiBlue': 'var(--vscode-terminal-ansiBlue)',
      'terminal.ansiMagenta': 'var(--vscode-terminal-ansiMagenta)',
      'terminal.ansiCyan': 'var(--vscode-terminal-ansiCyan)',
      'terminal.ansiWhite': 'var(--vscode-terminal-ansiWhite)',
    };

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'update') {
        renderTerminals(message.terminals, message.fields);
      }
    });

    function renderTerminals(terminals, fields) {
      if (terminals.length === 0) {
        list.innerHTML = '<div class="empty-state">No terminals open</div>';
        return;
      }

      list.innerHTML = terminals.map((t, i) => {
        const parts = [];
        const secondaryParts = [];

        for (const field of fields) {
          switch (field) {
            case 'name': {
              const resolvedColor = t.color
                ? (colorMap[t.color] || t.color)
                : '';
              const colorStyle = resolvedColor
                ? ' style="color:' + resolvedColor + '"'
                : '';
              parts.push(
                '<div class="terminal-row">' +
                  '<span class="terminal-icon codicon codicon-' + escapeHtml(t.iconId) + '"' + colorStyle + '></span>' +
                  '<span class="terminal-name">' + escapeHtml(t.name) + '</span>' +
                  '<button class="kill-btn" onclick="event.stopPropagation(); killTerminal(' + i + ')" title="Kill terminal">\\u2715</button>' +
                '</div>'
              );
              break;
            }
            case 'status': {
              const badge = t.isRunning
                ? '<span class="badge badge-running">running</span>'
                : '<span class="badge badge-idle">idle</span>';
              secondaryParts.push(badge);
              break;
            }
            case 'unread': {
              if (t.hasUnread) {
                secondaryParts.push('<span class="badge badge-unread">unread</span>');
              }
              break;
            }
          }
        }

        if (secondaryParts.length > 0) {
          parts.push('<div class="terminal-row-secondary">' + secondaryParts.join('') + '</div>');
        }

        return '<div class="terminal-item ' + (t.isActive ? 'active' : '') + '"' +
          ' onclick="selectTerminal(' + i + ')"' +
          ' title="' + escapeHtml(t.name) + '">' +
          parts.join('') +
          '</div>';
      }).join('');
    }

    function selectTerminal(index) {
      vscode.postMessage({ type: 'selectTerminal', index });
    }

    function killTerminal(index) {
      vscode.postMessage({ type: 'killTerminal', index });
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Signal to the extension that the webview is ready
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
