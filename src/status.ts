import vscode = require('vscode');

export enum ExtensionStatus
{
    Initializing,
    Running,
    Failed
}

var statusBarItem: vscode.StatusBarItem;

function getStatusBarItem() {
    if (statusBarItem == undefined) {
        statusBarItem =
            vscode.window.createStatusBarItem(
                vscode.StatusBarAlignment.Right,
                Number.MAX_VALUE);

        statusBarItem.show();
    }

    return statusBarItem;
}

function getStatusColor(status: ExtensionStatus): string {
    switch (status) {
        case ExtensionStatus.Initializing:
            return ";";

        default:
            break;
    }
}

export function setExtensionStatus(statusText: string, status: ExtensionStatus): void {
    var item = getStatusBarItem();

    // Set color and icon for 'Running' by default
    var statusIconText = "$(terminal) ";
    var statusColor = "#affc74";

    if (status == ExtensionStatus.Initializing) {
        statusIconText = "$(sync) ";
        statusColor = "#f3fc74";
    }
    else if (status == ExtensionStatus.Failed) {
        statusIconText = "$(alert) ";
        statusColor = "#fcc174";
    }

    item.color = statusColor;
    item.text = statusIconText + statusText;
}