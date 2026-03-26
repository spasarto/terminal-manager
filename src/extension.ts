import * as vscode from "vscode";
import { isEnabled, notify } from "./notify";
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
    varsWatcher.onDidRequestNotification(async ({ pid, message }) => {
      if (!isEnabled()) return;

      // Match the terminal by comparing vars object references.
      // loadFile sets all symlinked PIDs to the same object, so this
      // correctly identifies the terminal even when PIDs differ.
      const targetVars = varsWatcher.getVars(pid);
      if (!targetVars) return;

      const terminals = tracker.getTerminals();
      for (const info of terminals) {
        const termPid = await info.terminal.processId;
        if (!termPid) continue;
        const vars = varsWatcher.getVars(termPid);
        if (vars !== targetVars) continue;

        // Only notify for background terminals
        if (info.terminal === tracker.getActiveTerminal()) continue;

        info.hasUnread = true;
        // Strip timestamp suffix added by notification hook for uniqueness
        const displayMessage = message.replace(/ @\d+$/, "");
        notify(displayMessage, info.terminal);
        break;
      }
    }),
  );
}

export function deactivate() {}
