/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import vscode = require('vscode');

import { IFeature } from './feature';
import { SessionManager } from './session';
import { PowerShellLanguageId } from './utils';
import { OpenInISEFeature } from './features/OpenInISE';
import { ExpandAliasFeature } from './features/ExpandAlias';
import { ShowHelpFeature } from './features/ShowOnlineHelp';
import { FindModuleFeature } from './features/PowerShellFindModule';
import { ExtensionCommandsFeature } from './features/ExtensionCommands';

// NOTE: We will need to find a better way to deal with the required
//       PS Editor Services version...
var requiredEditorServicesVersion = "0.7.9";

var sessionManager: SessionManager = undefined;
var extensionFeatures: IFeature[] = [];

export function activate(context: vscode.ExtensionContext): void {

    vscode.languages.setLanguageConfiguration(
        PowerShellLanguageId,
        {
            wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\=\+\[\{\]\}\\\|\;\'\"\,\.\<\>\/\?\s]+)/g,

            indentationRules: {
                // ^(.*\*/)?\s*\}.*$
                decreaseIndentPattern: /^(.*\*\/)?\s*\}.*$/,
                // ^.*\{[^}"']*$
                increaseIndentPattern: /^.*\{[^}"']*$/
            },

            comments: {
                lineComment: '#',
                blockComment: ['<#', '#>']
            },

            brackets: [
                ['{', '}'],
                ['[', ']'],
                ['(', ')'],
            ],

            __electricCharacterSupport: {
                docComment: { scope: 'comment.documentation', open: '/**', lineStart: ' * ', close: ' */' }
            },

            __characterPairSupport: {
                autoClosingPairs: [
                    { open: '{', close: '}' },
                    { open: '[', close: ']' },
                    { open: '(', close: ')' },
                    { open: '"', close: '"', notIn: ['string'] },
                    { open: '\'', close: '\'', notIn: ['string', 'comment'] }
                ]
            }
        });

    // Create features
    extensionFeatures = [
        new OpenInISEFeature(),
        new ExpandAliasFeature(),
        new ShowHelpFeature(),
        new FindModuleFeature(),
        new ExtensionCommandsFeature()
    ];

    sessionManager = new SessionManager(requiredEditorServicesVersion, extensionFeatures);
    sessionManager.start();
}

export function deactivate(): void {
    // Clean up all extension features
    extensionFeatures.forEach(feature => {
       feature.dispose();
    });

    // Dispose of the current session
    sessionManager.dispose();
}
