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
    varsWatcher.onDidRequestNotification(async ({ pid, message }) => {
      const config = vscode.workspace.getConfiguration("terminalManager");
      if (!config.get<boolean>("notifications", false)) return;

      // Find the terminal whose PID (or ancestor PID) matches
      const terminals = tracker.getTerminals();
      for (const info of terminals) {
        const termPid = await info.terminal.processId;
        if (!termPid) continue;
        const vars = varsWatcher.getVars(termPid);
        if (vars?.notification !== message) continue;

        // Only notify for background terminals
        if (info.terminal === tracker.getActiveTerminal()) break;

        info.hasUnread = true;
        const choice = await vscode.window.showInformationMessage(
          `Terminal "${info.name}": ${message}`,
          "Show",
        );
        if (choice === "Show") {
          info.terminal.show();
        }
        break;
      }
    }),
  );
}

export function deactivate() {}
