import * as vscode from 'vscode';
import { TerminalTracker } from './terminalTracker';
import { TerminalManagerViewProvider } from './webviewProvider';
import { TerminalVarsWatcher } from './terminalVarsWatcher';

export function activate(context: vscode.ExtensionContext) {
  const tracker = new TerminalTracker();
  const varsWatcher = new TerminalVarsWatcher();
  const provider = new TerminalManagerViewProvider(tracker, varsWatcher, context.extensionUri);

  context.subscriptions.push(
    tracker,
    varsWatcher,
    provider,
    vscode.window.registerWebviewViewProvider(
      TerminalManagerViewProvider.viewType,
      provider,
    ),
  );
}

export function deactivate() {}
