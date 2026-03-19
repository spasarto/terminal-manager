import * as vscode from 'vscode';
import { TerminalTracker } from './terminalTracker';
import { TerminalManagerViewProvider } from './webviewProvider';

export function activate(context: vscode.ExtensionContext) {
  const tracker = new TerminalTracker();
  const provider = new TerminalManagerViewProvider(tracker, context.extensionUri);

  context.subscriptions.push(
    tracker,
    provider,
    vscode.window.registerWebviewViewProvider(
      TerminalManagerViewProvider.viewType,
      provider,
    ),
  );
}

export function deactivate() {}
