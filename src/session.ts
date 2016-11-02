/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import os = require('os');
import fs = require('fs');
import net = require('net');
import path = require('path');
import utils = require('./utils');
import vscode = require('vscode');
import cp = require('child_process');
import settingsManager = require('./settings');

import { Logger } from './logging';
import { IFeature } from './feature';
import { LanguageClient, LanguageClientOptions, Executable, RequestType, NotificationType, StreamInfo } from 'vscode-languageclient';

export enum SessionStatus
{
    Initializing,
    Running,
    Failed
}

export class SessionManager {

    private ShowStatusBarMenuCommandName = "PowerShell.ShowStatusMenu";

    private hostVersion: string;
    private statusBarItem: vscode.StatusBarItem;
    private consoleTerminal: vscode.Terminal = undefined;
    private registeredCommands: vscode.Disposable[] = [];
    private languageServerClient: LanguageClient = undefined;

    constructor(
        private requiredEditorServicesVersion: string,
        private log: Logger,
        private extensionFeatures: IFeature[] = []) {

        // Get the current version of this extension
        this.hostVersion =
            vscode
                .extensions
                .getExtension("ms-vscode.PowerShell")
                .packageJSON
                .version;

        this.registerCommands();
        this.createStatusBarItem();
    }

    public start() {
        var settings = settingsManager.load(utils.PowerShellLanguageId);

        var bundledModulesPath = settings.developer.bundledModulesPath;
        if (!path.isAbsolute(bundledModulesPath)) {
            bundledModulesPath = path.resolve(__dirname, bundledModulesPath);
        }

        var startArgs =
            "-EditorServicesVersion '" + this.requiredEditorServicesVersion + "' " +
            "-HostName 'Visual Studio Code Host' " +
            "-HostProfileId 'Microsoft.VSCode' " +
            "-HostVersion '" + this.hostVersion + "' " +
            "-BundledModulesPath '" + bundledModulesPath + "' ";

        if (settings.developer.editorServicesWaitForDebugger) {
            startArgs += '-WaitForDebugger ';
        }
        if (settings.developer.editorServicesLogLevel) {
            startArgs += "-LogLevel '" + settings.developer.editorServicesLogLevel + "' "
        }

        // Find the path to powershell.exe based on the current platform
        // and the user's desire to run the x86 version of PowerShell
        var powerShellExePath = undefined;

        if (os.platform() == "win32") {
            powerShellExePath =
                settings.useX86Host || !process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432')
                ? process.env.windir + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
                : process.env.windir + '\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe';
        }
        else if (os.platform() == "darwin") {
            powerShellExePath = "/usr/local/bin/powershell";

            // Check for OpenSSL dependency on OS X
            if (!utils.checkIfFileExists("/usr/local/lib/libcrypto.1.0.0.dylib") ||
                !utils.checkIfFileExists("/usr/local/lib/libssl.1.0.0.dylib")) {
                    var thenable =
                        vscode.window.showWarningMessage(
                            "The PowerShell extension will not work without OpenSSL on Mac OS X",
                            "Show Documentation");

                    thenable.then(
                        (s) => {
                            if (s === "Show Documentation") {
                                cp.exec("open https://github.com/PowerShell/vscode-powershell/blob/master/docs/troubleshooting.md#1-powershell-intellisense-does-not-work-cant-debug-scripts");
                            }
                        });

                    // Don't continue initializing since Editor Services will not load successfully
                    this.setSessionFailure("Cannot start PowerShell Editor Services due to missing OpenSSL dependency.");
                    return;
                }
        }
        else {
            powerShellExePath = "/usr/bin/powershell";
        }

        // Is there a setting override for the PowerShell path?
        if (settings.developer.powerShellExePath &&
            settings.developer.powerShellExePath.trim().length > 0) {

            powerShellExePath = settings.developer.powerShellExePath;

            // If the path does not exist, show an error
            fs.access(
                powerShellExePath, fs.constants.X_OK,
                (err) => {
                    if (err) {
                        this.setSessionFailure(
                            "powershell.exe cannot be found or is not accessible at path " + powerShellExePath);
                    }
                    else {
                        this.startPowerShell(
                            powerShellExePath,
                            bundledModulesPath,
                            startArgs);
                    }
                });
        }
        else {
            this.startPowerShell(
                powerShellExePath,
                bundledModulesPath,
                startArgs);
        }
    }

    public stop() {
        // Shut down existing session if there is one
        this.log.write("\r\n\r\nShutting down language client...");

        // Close the language server client
        if (this.languageServerClient !== undefined) {
            this.languageServerClient.stop();
            this.languageServerClient = undefined;
        }

        // Clean up the session file
        utils.deleteSessionFile();

        // Kill the PowerShell process we spawned via the console
        if (this.consoleTerminal !== undefined) {
            this.log.write("\r\nTerminating PowerShell process...");
            this.consoleTerminal.dispose();
            this.consoleTerminal = undefined;
        }
    }

    public dispose() : void {
        // Stop the current session
        this.stop();

        // Dispose of all commands
        this.registeredCommands.forEach(command => { command.dispose(); });
    }

    private registerCommands() : void {
        this.registeredCommands = [
            vscode.commands.registerCommand('PowerShell.RunSelection', () => { this.runSelectionInConsole(); }),
            vscode.commands.registerCommand('PowerShell.RestartSession', () => { this.restartSession(); }),
            vscode.window.onDidCloseTerminal((terminal) => this.onTerminalClosed(terminal)),
            vscode.commands.registerCommand(this.ShowStatusBarMenuCommandName, () => { this.showStatusMenu(); }),
            vscode.commands.registerCommand('PowerShell.GetSessionPath', () => {
                return this.getDebugAdapterArgs() })
        ]
    }

    private runSelectionInConsole() {
        var editor = vscode.window.activeTextEditor;
        var selectionRange: vscode.Range = undefined;

        if (!editor.selection.isEmpty) {
            selectionRange =
                new vscode.Range(
                    editor.selection.start,
                    editor.selection.end);
        }
        else {
            selectionRange = editor.document.lineAt(editor.selection.start.line).range;
        }

        var textToSend = editor.document.getText(selectionRange).trim();
        this.consoleTerminal.sendText(textToSend, true);

        // Does the text end with a curly brace?  Those need an extra newline
        if (textToSend.endsWith("}") && !selectionRange.isSingleLine) {
            this.consoleTerminal.sendText("", true);
        }
    }

    private startPowerShell(powerShellExePath: string, bundledModulesPath: string, startArgs: string) {
        try
        {
            this.setSessionStatus(
                "Starting PowerShell...",
                SessionStatus.Initializing);

            let startScriptPath =
                path.resolve(
                    __dirname,
                    '../scripts/Start-EditorServices.ps1');

            var editorServicesLogPath = this.log.getLogFilePath("EditorServices");

            startArgs +=
                "-LogPath '" + editorServicesLogPath + "' " +
                "-SessionDetailsPath '" + utils.getSessionFilePath() + "' ";

            var powerShellArgs = [
                "-NoProfile",
                "-NoExit"
            ]

            // Only add ExecutionPolicy param on Windows
            if (os.platform() == "win32") {
                powerShellArgs.push("-ExecutionPolicy", "Unrestricted")
            }

            powerShellArgs.push(
                "-Command",
                "& '" + startScriptPath + "' " + startArgs)

            // Make sure no old session file exists
            utils.deleteSessionFile();

            // Create the terminal and then display it if needed
            this.consoleTerminal =
                vscode.window.createTerminal(
                    "PowerShell Interactive Console",
                    powerShellExePath,
                    powerShellArgs);

            this.consoleTerminal.show();

            // Once the process has started, log the details
            this.consoleTerminal.processId.then((pid) => {
                this.log.write(
                    "powershell.exe started",
                    "    pid: " + pid,
                    "    exe: " + powerShellExePath,
                    "    bundledModulesPath: " + bundledModulesPath,
                    "    args: " + startScriptPath + ' ' + startArgs + "\r\n");
            })

            // Start the language client
            utils.waitForSessionFile(
                (sessionDetails, error) => {
                    if (sessionDetails) {
                        // Store the debug server port
                        this.updateLaunchConfiguration(sessionDetails.debugServicePort);

                        // Start the language service client
                        this.startLanguageClient(sessionDetails.languageServicePort);
                    }
                    else {
                        this.setSessionFailure("Could not start language server", error);
                    }
                });
        }
        catch (e)
        {
            this.setSessionFailure("The language service could not be started: ", e);
        }
    }

    private updateLaunchConfiguration(port: number) {
        var config = vscode.workspace.getConfiguration('launch');
        config.update('debugServer', port);

        // Make sure other settings are there
    }

    private startLanguageClient(port: number) {

        this.log.write("Connecting to language service on port " + port + "...\r\n");

        try
        {
            let connectFunc = () => {
                return new Promise<StreamInfo>(
                    (resolve, reject) => {
                        var socket = net.connect(port);
                        socket.on(
                            'connect',
                            () => {
                                this.log.write("Language service connected.");
                                resolve({writer: socket, reader: socket})
                            });
                    });
            };

            let clientOptions: LanguageClientOptions = {
                documentSelector: [utils.PowerShellLanguageId],
                synchronize: {
                    configurationSection: utils.PowerShellLanguageId,
                    //fileEvents: vscode.workspace.createFileSystemWatcher('**/.eslintrc')
                }
            }

            this.languageServerClient =
                new LanguageClient(
                    'PowerShell Editor Services',
                    connectFunc,
                    clientOptions);

            this.languageServerClient.onReady().then(
                () => {
                    this.setSessionStatus(
                        "Running",
                        SessionStatus.Running);

                    this.updateExtensionFeatures(this.languageServerClient)
                },
                (reason) => {
                    this.setSessionFailure("Could not start language service: ", reason);
                });

            this.languageServerClient.start();
        }
        catch (e)
        {
            this.setSessionFailure("The language service could not be started: ", e);
        }
    }

    private updateExtensionFeatures(languageClient: LanguageClient) {
        this.extensionFeatures.forEach(feature => {
            feature.setLanguageClient(languageClient);
        });
    }

    private restartSession() {
        this.stop();
        this.start();
    }

    private onTerminalClosed(terminal: vscode.Terminal) {
        if (terminal == this.consoleTerminal) {
            // Stop the session
            this.consoleTerminal = undefined;
            this.stop();

            this.setSessionStatus(
                "Terminated",
                SessionStatus.Failed);

            vscode.window.showErrorMessage(
                "The PowerShell Interactive Console has terminated, would you like to restart it?",
                "Yes", "No")
                .then((answer) => { if (answer === "Yes") { this.start(); }});
        }
    }

    private createStatusBarItem() {
        if (this.statusBarItem == undefined) {
            // Create the status bar item and place it right next
            // to the language indicator
            this.statusBarItem =
                vscode.window.createStatusBarItem(
                    vscode.StatusBarAlignment.Right,
                    1);

            this.statusBarItem.command = this.ShowStatusBarMenuCommandName;
            this.statusBarItem.show();
        }
    }

    private setSessionStatus(statusText: string, status: SessionStatus): void {
        // Set color and icon for 'Running' by default
        var statusIconText = "$(terminal) ";
        var statusColor = "#affc74";

        if (status == SessionStatus.Initializing) {
            statusIconText = "$(sync) ";
            statusColor = "#f3fc74";
        }
        else if (status == SessionStatus.Failed) {
            statusIconText = "$(alert) ";
            statusColor = "#fcc174";
        }

        this.statusBarItem.color = statusColor;
        this.statusBarItem.text = statusIconText + statusText;
    }

    private setSessionFailure(message: string, ...additionalMessages: string[]) {
        this.log.writeAndShowError(message, ...additionalMessages);

        this.setSessionStatus(
            "Initialization Error",
            SessionStatus.Failed);
    }

    private showStatusMenu() {
        // TODO: Generate the menu based on context
        vscode.window.showQuickPick(
            [ "Restart Current Session",
              "Switch to PowerShell (x86)" ]);
    }

    private getDebugAdapterArgs() {
        return "TEST!";
    }
}