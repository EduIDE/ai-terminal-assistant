// *****************************************************************************
// Copyright (C) 2026 EclipseSource GmbH.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';

export function getRecentTerminalCommands(terminal: TerminalWidget): string[] {
    // TODO: implementation of fetch terminal command from last command block, enable when upstream fix is merged
    // if (terminalPreferences['terminal.integrated.enableCommandHistory']) {
    //     const commandHistory =
    //         terminal.commandHistoryState?.commandHistory ?? [];
    //     if (commandHistory.length === 0) {
    //         return [];
    //     }
    //     const lastTerminalBlock = commandHistory[commandHistory.length - 1];
    //     return [`${lastTerminalBlock.command}\n${lastTerminalBlock.output}`];
    // }

    const maxLines = 100;
    const length = terminal.buffer.length;
    return terminal.buffer.getLines(
        Math.max(0, length - maxLines),
        Math.min(maxLines, length),
    );
}

export async function getTerminalShell(
    terminal: TerminalWidget,
): Promise<string | undefined> {
    try {
        const processInfo = await terminal.processInfo;
        return processInfo ? processInfo.executable : undefined;
    } catch {
        return undefined;
    }
}
