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
import {
    inject,
    injectable,
    postConstruct,
    preDestroy,
} from '@theia/core/shared/inversify';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { TerminalWidgetImpl } from '@theia/terminal/lib/browser/terminal-widget-impl';
import { Emitter, Event, ILogger } from '@theia/core';
import { Widget } from '@theia/core/lib/browser';
import { AiTerminalAssistantPreferences } from './ai-terminal-assistant-preferences';
import { getRecentTerminalCommands, getTerminalShell } from './terminal-widget-utils';

export interface CachedTerminalOutput {
    cwd: string;
    shell: string | undefined;
    recentTerminalContents: string[];
}

export const HiddenTerminalService = Symbol('HiddenTerminalService');

export interface HiddenTerminalService {
    readonly currentTerminal: TerminalWidget | undefined;
    readonly cachedOutput: CachedTerminalOutput | undefined;
    readonly hasCachedOutput: boolean;
    readonly isStandAlone: boolean;
    readonly onBufferChanged: Event<void>;
    readonly onCachedOutputChanged: Event<void>;

    setTaskRunning(isRunning: boolean): void;
    clearCachedOutput(): void;
    createNewTerminal(): Promise<void>;
    writeToTerminal(command: string): Promise<void>;
    getBufferContent(): Promise<string[]>;
}

@injectable()
export class HiddenTerminalServiceImpl implements HiddenTerminalService {
    @inject(TerminalService)
    protected readonly terminalService: TerminalService;

    @inject(AiTerminalAssistantPreferences)
    protected readonly preferences: AiTerminalAssistantPreferences;

    @inject(ILogger)
    protected readonly logger: ILogger;

    protected readonly onBufferChangedEmitter = new Emitter<void>();
    readonly onBufferChanged: Event<void> = this.onBufferChangedEmitter.event;

    protected readonly onCachedOutputChangedEmitter = new Emitter<void>();
    readonly onCachedOutputChanged: Event<void> =
        this.onCachedOutputChangedEmitter.event;

    protected _currentTerminal: TerminalWidget | undefined;
    get currentTerminal(): TerminalWidget | undefined {
        return this._currentTerminal;
    }

    protected _terminalBuffer: string[] = [];
    protected _hiddenContainer: HTMLDivElement | undefined;
    protected _isTaskRunning = false;
    protected _isStandAlone: boolean;
    protected _cachedOutput: CachedTerminalOutput | undefined;

    get cachedOutput(): CachedTerminalOutput | undefined {
        return this._cachedOutput;
    }

    get hasCachedOutput(): boolean {
        return this._cachedOutput !== undefined;
    }

    get isStandAlone(): boolean {
        return this._isStandAlone;
    }

    @postConstruct()
    protected initialize(): void {
        this._isStandAlone =
            this.preferences['ai-features.ai-terminal-assistant.mode'] === 'standalone';

        this.preferences.onPreferenceChanged((event) => {
            if (event.preferenceName === 'ai-features.ai-terminal-assistant.mode') {
                const newMode = this.preferences['ai-features.ai-terminal-assistant.mode'];
                this._isStandAlone = newMode === 'standalone';
                if (newMode === 'dedicated') {
                    if (this._currentTerminal && !this._currentTerminal.isDisposed) {
                        this._currentTerminal.dispose();
                    }
                    this.removeHiddenContainer();
                }
                if (newMode === 'standalone') {
                    if (!this._hiddenContainer) {
                        this.initializeHiddenContainer();
                    }
                    if (!this._currentTerminal || this._currentTerminal.isDisposed) {
                        this.createNewTerminal().catch((err) => {
                            this.logger.error(
                                'Error creating terminal after mode switch:',
                                err,
                            );
                        });
                    }
                }
            }
        });

        this.initializeHiddenContainer();
    }

    setTaskRunning(isRunning: boolean): void {
        this._isTaskRunning = isRunning;
    }

    clearCachedOutput(): void {
        this._cachedOutput = undefined;
        this.onCachedOutputChangedEmitter.fire();
    }

    protected initializeHiddenContainer(): void {
        this._hiddenContainer = document.createElement('div');
        this._hiddenContainer.id = 'ai-terminal-hidden-container';
        this._hiddenContainer.style.position = 'fixed';
        this._hiddenContainer.style.width = '2000px';
        this._hiddenContainer.style.height = '600px';
        this._hiddenContainer.style.overflow = 'hidden';
        // Use clip-path to make content invisible but keep element technically visible
        // This ensures phosphor's isVisible check passes
        this._hiddenContainer.style.clipPath = 'inset(100%)';
        this._hiddenContainer.style.pointerEvents = 'none';
        document.body.appendChild(this._hiddenContainer);
    }

    protected removeHiddenContainer(): void {
        if (this._hiddenContainer) {
            document.body.removeChild(this._hiddenContainer);
            this._hiddenContainer = undefined;
        }
    }

    async createNewTerminal(): Promise<void> {
        if (this._isStandAlone) {
            await this.cacheLastTerminalOutput();
        }
        if (this._currentTerminal && !this._currentTerminal.isDisposed) {
            this._currentTerminal.dispose();
        }
        this._terminalBuffer = [];

        if (!this._isStandAlone) {
            return;
        }

        this._currentTerminal = await this.terminalService.newTerminal({
            title: 'Hidden TaskTerminal',
            destroyTermOnClose: true,
            kind: 'task',
            hideFromUser: true,
            isTransient: true,
        });

        this._currentTerminal.onOutput(() => {
            if (this._isTaskRunning && this._currentTerminal) {
                const lines = this._currentTerminal.buffer.getLines(
                    0,
                    this._currentTerminal.buffer.length,
                );
                this._terminalBuffer = lines.reverse();
                this.onBufferChangedEmitter.fire();
            }
        });

        if (this._hiddenContainer) {
            Widget.attach(this._currentTerminal, this._hiddenContainer);
        }

        await this._currentTerminal.start();
        this._currentTerminal.update();
        // Wait a tick to ensure xterm.js is initialized after update
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }

    async writeToTerminal(command: string): Promise<void> {
        if (this._currentTerminal) {
            this._currentTerminal.sendText(command);
            this._currentTerminal.sendText('\r');
        } else {
            throw new Error('No current terminal to write to.');
        }
    }

    async getBufferContent(): Promise<string[]> {
        if (!this._currentTerminal) {
            return [];
        }
        const maxLines = 100;
        return this._currentTerminal.buffer.getLines(
            Math.max(0, this._currentTerminal.buffer.length - maxLines),
            maxLines,
        );
    }

    protected async cacheLastTerminalOutput(): Promise<void> {
        const lastUsedTerminal = this.terminalService.lastUsedTerminal;
        if (!lastUsedTerminal) {
            return;
        }
        try {
            const cwd = (
                await (lastUsedTerminal as TerminalWidgetImpl).cwd
            ).toString();
            const shell = await getTerminalShell(lastUsedTerminal);
            const recentTerminalContents =
                getRecentTerminalCommands(lastUsedTerminal);
            this._cachedOutput = { cwd, shell, recentTerminalContents };
            this.onCachedOutputChangedEmitter.fire();
        } catch (err) {
            this.logger.warn('Failed to cache terminal output:', err);
        }
    }

    @preDestroy()
    protected dispose(): void {
        this.onBufferChangedEmitter.dispose();
        this.onCachedOutputChangedEmitter.dispose();
    }
}
