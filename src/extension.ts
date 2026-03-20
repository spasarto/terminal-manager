import * as vscode from "vscode";
import { TerminalTracker } from "./terminalTracker";
import { TerminalVarsWatcher } from "./terminalVarsWatcher";
import { TerminalManagerViewProvider } from "./webviewProvider";

export function activate(context: vscode.ExtensionContext) {
  const tracker = new TerminalTracker();
  const varsWatcher = new TerminalVarsWatcher();
  const provider = new TerminalManagerViewProvider(tracker, varsWatcher, context.extensionUri);

  context.subscriptions.push(
    tracker,
    varsWatcher,
    provider,
    vscode.window.registerWebviewViewProvider(TerminalManagerViewProvider.viewType, provider),
  );
}

export function deactivate() {}
