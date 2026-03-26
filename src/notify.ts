import { execFile } from "node:child_process";
import * as os from "node:os";
import * as vscode from "vscode";

type NotificationMode = "off" | "vscode" | "system" | "both";

function getMode(): NotificationMode {
  const config = vscode.workspace.getConfiguration("terminalManager");
  const value = config.get<string | boolean>("notifications", "off");
  // Backward compat: boolean true → "vscode", false → "off"
  if (value === true) return "vscode";
  if (value === false) return "off";
  return (value as NotificationMode) || "off";
}

function sendSystemNotification(title: string, body: string): void {
  const platform = os.platform();
  if (platform === "darwin") {
    execFile(
      "terminal-notifier",
      ["-sender", "com.microsoft.VSCode", "-title", title, "-message", body],
      () => {},
    );
  } else if (platform === "linux") {
    execFile("notify-send", [title, body], () => {});
  }
}

export function notify(message: string, terminal: vscode.Terminal): void {
  const mode = getMode();
  if (mode === "off") return;

  if (mode === "vscode" || mode === "both") {
    vscode.window
      .showInformationMessage(`Terminal "${terminal.name}": ${message}`, "Show")
      .then((choice) => {
        if (choice === "Show") {
          terminal.show();
        }
      });
  }

  if (mode === "system" || mode === "both") {
    sendSystemNotification("Terminal Manager", `${terminal.name}: ${message}`);
  }
}

export function isEnabled(): boolean {
  return getMode() !== "off";
}
