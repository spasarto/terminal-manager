import * as vscode from 'vscode';
import { TerminalTracker } from './terminalTracker';
import { TerminalManagerViewProvider } from './webviewProvider';
import { ClaudeStatusWatcher } from './claudeStatusWatcher';

export function activate(context: vscode.ExtensionContext) {
  const tracker = new TerminalTracker();
  const claudeWatcher = new ClaudeStatusWatcher();
  const provider = new TerminalManagerViewProvider(tracker, claudeWatcher, context.extensionUri);

  context.subscriptions.push(
    tracker,
    claudeWatcher,
    provider,
    vscode.window.registerWebviewViewProvider(
      TerminalManagerViewProvider.viewType,
      provider,
    ),
  );
}

export function deactivate() {}
