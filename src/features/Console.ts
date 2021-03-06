/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import vscode = require('vscode');
import { LanguageClient, RequestType, NotificationType } from 'vscode-languageclient';

export namespace ShowChoicePromptRequest {
    export const type: RequestType<ShowChoicePromptRequestArgs, ShowChoicePromptResponseBody, string> =
        { get method() { return 'powerShell/showChoicePrompt'; } };
}

export namespace ShowInputPromptRequest {
    export const type: RequestType<ShowInputPromptRequestArgs, ShowInputPromptResponseBody, string> =
        { get method() { return 'powerShell/showInputPrompt'; } };
}

interface ChoiceDetails {
    label: string;
    helpMessage: string;
}

interface ShowInputPromptRequestArgs {
    name: string;
    label: string;
}

interface ShowChoicePromptRequestArgs {
    caption: string;
    message: string;
    choices: ChoiceDetails[];
    defaultChoice: number;
}

interface ShowChoicePromptResponseBody {
    chosenItem: string;
    promptCancelled: boolean;
}

interface ShowInputPromptResponseBody {
    responseText: string;
    promptCancelled: boolean;
}

function showChoicePrompt(
    promptDetails: ShowChoicePromptRequestArgs,
    client: LanguageClient) : Thenable<ShowChoicePromptResponseBody> {

    var quickPickItems =
        promptDetails.choices.map<vscode.QuickPickItem>(choice => {
            return {
                label: choice.label,
                description: choice.helpMessage
            }
        });

    // Shift the default item to the front of the
    // array so that the user can select it easily
    if (promptDetails.defaultChoice > -1 &&
        promptDetails.defaultChoice < promptDetails.choices.length) {

        var defaultChoiceItem = quickPickItems[promptDetails.defaultChoice];
        quickPickItems.splice(promptDetails.defaultChoice, 1);

        // Add the default choice to the head of the array
        quickPickItems = [defaultChoiceItem].concat(quickPickItems);
    }

    // For some bizarre reason, the quick pick dialog does not
    // work if I return the Thenable immediately at this point.
    // It only works if I save the thenable to a variable and
    // return the variable instead...
    var resultThenable =
        vscode.window
            .showQuickPick(
                quickPickItems,
                { placeHolder: promptDetails.caption + " - " + promptDetails.message })
            .then(onItemSelected);

    return resultThenable;
}

function showInputPrompt(
    promptDetails: ShowInputPromptRequestArgs,
    client: LanguageClient) : Thenable<ShowInputPromptResponseBody> {

    var resultThenable =
        vscode.window.showInputBox({
            placeHolder: promptDetails.name + ": "
        }).then(onInputEntered)

    return resultThenable;
}

function onItemSelected(chosenItem: vscode.QuickPickItem): ShowChoicePromptResponseBody {
    if (chosenItem !== undefined) {
        return {
            promptCancelled: false,
            chosenItem: chosenItem.label
        };
    }
    else {
        // User cancelled the prompt, send the cancellation
        return {
            promptCancelled: true,
            chosenItem: undefined
        };
    }
}

function onInputEntered(responseText: string): ShowInputPromptResponseBody {
    if (responseText !== undefined) {
        return {
            promptCancelled: false,
            responseText: responseText
        }
    }
    else {
        return {
            promptCancelled: true,
            responseText: undefined
        }
    }
}

export function registerConsoleCommands(terminal: vscode.Terminal, client: LanguageClient): void {

    client.onRequest(
        ShowChoicePromptRequest.type,
        promptDetails => showChoicePrompt(promptDetails, client));

    client.onRequest(
        ShowInputPromptRequest.type,
        promptDetails => showInputPrompt(promptDetails, client));
}
