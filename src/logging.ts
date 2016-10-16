/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import fs = require('fs');
import path = require('path');
import vscode = require('vscode');
import utils = require('./utils');
import { ILogger } from 'vscode-jsonrpc';

export enum LogLevel {
    Verbose,
    Normal,
    Warning,
    Error
}

// TODO:
// - Instead of creating log files with the timestamp, create a single
//   timestamped folder with plain log file names inside!
// - Add an "Open Extension Logs Folder" command to open the log folder for this session!
// - Use the new debug parameter approach to pass the current session
//   and log file path information to the debug adapter.

export class Logger {

    private showLogsCommand: vscode.Disposable;
    private logChannel: vscode.OutputChannel;
    private logFilePath: string;

    constructor(readonly MinimumLogLevel: LogLevel = LogLevel.Normal) {
        this.logChannel = vscode.window.createOutputChannel("PowerShell Extension Logs");

        var logBasePath = Logger.getLogBasePath();
        utils.ensurePathExists(logBasePath);

        this.logFilePath =
            path.resolve(
                logBasePath,
                Logger.getLogName("PowerShell"));

        this.showLogsCommand =
            vscode.commands.registerCommand(
                'PowerShell.ShowLogs',
                () => { this.showLogPanel(); })
    }

    public static getLogName(baseName: string): string {
        return Math.floor(Date.now() / 1000) + '-' +  baseName + '.log';
    }

    public static getLogBasePath(): string {
        return path.resolve(__dirname, "../logs");
    }

    public writeAtLevel(logLevel: LogLevel, message: string, ...additionalMessages: string[]) {
        if (logLevel >= this.MinimumLogLevel) {
            // TODO: Add timestamp
            this.logChannel.appendLine(message);
            fs.appendFile(this.logFilePath, message + "\r\n");

            additionalMessages.forEach((line) => {
                this.logChannel.appendLine(line);
                fs.appendFile(this.logFilePath, line + "\r\n");
            });
        }
    }

    public write(message: string, ...additionalMessages: string[]) {
        this.writeAtLevel(LogLevel.Normal, message, ...additionalMessages);
    }

    public writeVerbose(message: string, ...additionalMessages: string[]) {
        this.writeAtLevel(LogLevel.Verbose, message, ...additionalMessages);
    }

    public writeWarning(message: string, ...additionalMessages: string[]) {
        this.writeAtLevel(LogLevel.Warning, message, ...additionalMessages);
    }

    public writeAndShowWarning(message: string, ...additionalMessages: string[]) {
        this.writeWarning(message, ...additionalMessages);

        vscode.window.showWarningMessage(message, "Show Logs").then((selection) => {
            if (selection !== undefined) {
                this.showLogPanel();
            }
        });
    }

    public writeError(message: string, ...additionalMessages: string[]) {
        this.writeAtLevel(LogLevel.Error, message, ...additionalMessages);
    }

    public writeAndShowError(message: string, ...additionalMessages: string[]) {
        this.writeError(message, ...additionalMessages);

        vscode.window.showErrorMessage(message, "Show Logs").then((selection) => {
            if (selection !== undefined) {
                this.showLogPanel();
            }
        });
    }

    public dispose() {
        this.showLogsCommand.dispose();
        this.logChannel.dispose();
    }

    private showLogPanel() {
        this.logChannel.show();
    }
}

export class LanguageClientLogger implements ILogger {

    constructor(private logger: Logger) { }

    public error(message: string) {
        this.logger.writeError(message);
    }

    public warn(message: string) {
        this.logger.writeWarning(message);
    }

    public info(message: string) {
        this.logger.write(message);
    }

    public log(message: string) {
        this.logger.writeVerbose(message);
    }
}