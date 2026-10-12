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

export const SECRET_REDACTION_PLACEHOLDER = '[REDACTED]';

// Matches KEY=VALUE / KEY: VALUE pairs where the key name looks like a secret.
// Covers typical `.env` contents and `env` output, e.g. GITHUB_TOKEN=..., AWS_SECRET_ACCESS_KEY=..., DB_PASSWORD=..., MY_API_KEY=..., SSH_AUTH_SOCK=..., DOCKER_AUTH_CONFIG=...
// Also handles quoted arguments and JSON-style keys, e.g. "DB_PASSWORD": "..." or 'token=...'.
const SECRET_ASSIGNMENT = /(^|\s|export\s+|["'])([A-Za-z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)[A-Za-z0-9_.-]*|[A-Za-z0-9_.-]+_KEY)(["']?\s*[=:]\s*)(\S.*)$/i;

// Matches HTTP Authorization headers, e.g. "Authorization: Basic ...".
const AUTHORIZATION_HEADER = /(authorization\s*:\s*)(\S.*)$/i;

// Matches bearer tokens wherever they appear, e.g. "Bearer eyJ...".
const BEARER_TOKEN = /(bearer\s+)\S+/gi;

// Matches AWS-style access key IDs, e.g. AKIAIOSFODNN7EXAMPLE.
const AWS_ACCESS_KEY_ID = /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|AIPA)[0-9A-Z]{12,}\b/g;

// Matches credentials embedded in a connection URL, e.g. postgres://user:password@host/db or
// redis://:password@host. The key name (DATABASE_URL, REDIS_URL, ...) does not look like a secret,
// so SECRET_ASSIGNMENT does not fire; this redacts the password portion wherever such a URL appears.
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)([^\s/@]+)(@)/gi;

/**
 * Redacts obvious secrets from captured terminal lines before they are sent to a language model.
 * Operates line by line and preserves the surrounding text so the summary stays useful.
 */
export function redactSecrets(lines: string[]): string[] {
    return lines.map(redactSecretsFromLine);
}

function redactSecretsFromLine(line: string): string {
    let result = line.replace(
        SECRET_ASSIGNMENT,
        (_match, prefix, key, separator) => `${prefix}${key}${separator}${SECRET_REDACTION_PLACEHOLDER}`,
    );
    result = result.replace(
        AUTHORIZATION_HEADER,
        (_match, prefix) => `${prefix}${SECRET_REDACTION_PLACEHOLDER}`,
    );
    result = result.replace(BEARER_TOKEN, (_match, prefix) => `${prefix}${SECRET_REDACTION_PLACEHOLDER}`);
    result = result.replace(AWS_ACCESS_KEY_ID, SECRET_REDACTION_PLACEHOLDER);
    result = result.replace(
        URL_CREDENTIALS,
        (_match, prefix, _password, suffix) => `${prefix}${SECRET_REDACTION_PLACEHOLDER}${suffix}`,
    );
    return result;
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
