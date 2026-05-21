// *****************************************************************************
// Copyright (C) 2025 EclipseSource GmbH.
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
import {
    AiTerminalSummaryAgent,
    ErrorDetail,
    NoLanguageModelError,
    Summary,
} from './terminal-output-analysis-agent';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWidgetImpl } from '@theia/terminal/lib/browser/terminal-widget-impl';
import { Emitter, Event, ILogger, MessageService } from '@theia/core';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import { TaskWatcher } from '@theia/task/lib/common';
import { TaskService } from '@theia/task/lib/browser/task-service';
import { ErrorSourceResolutionService } from './error-source-resolution-service';
import { HiddenTerminalService } from './hidden-terminal-service';
import { getRecentTerminalCommands, getTerminalShell } from './terminal-widget-utils';

export interface SummaryRequest {
    cwd: string;
    shell: string;
    recentTerminalContents: string[];
}

export const SummaryService = Symbol('SummaryService');

export interface SummaryService {
    readonly onAllTerminalsClosed: Event<void>;
    readonly onCurrentTerminalBufferChanged: Event<void>;
    readonly onSummaryRequestStarted: Event<void>;
    readonly onSummaryRequestFinished: Event<Summary | undefined>;
    readonly onTaskStarted: Event<void>;
    readonly onTaskExited: Event<void>;
    readonly onCachedOutputChanged: Event<void>;

    currentSummary: Summary | undefined;
    currentErrorLines: string[];
    isTaskRunning: boolean;
    hasCachedOutput: boolean;
    isStandAlone: boolean;

    requestSummary(isManualReRequest?: boolean): Promise<void>;
    sendSummaryRequest(request: SummaryRequest): Promise<Summary | undefined>;
    sendSummaryRequestForLastUsedTerminal(): Promise<Summary | undefined>;
    openErrorInEditor(error: ErrorDetail): Promise<void>;
    writeToCurrentTerminal(command: string): Promise<void>;
    getBufferContent(): Promise<string[]>;
}

@injectable()
export class SummaryServiceImpl implements SummaryService {
    @inject(AiTerminalSummaryAgent)
    protected readonly agent: AiTerminalSummaryAgent;

    @inject(TerminalService)
    protected readonly terminalService: TerminalService;

    @inject(DebugSessionManager)
    protected readonly debugSessionManager: DebugSessionManager;

    @inject(ErrorSourceResolutionService)
    protected readonly errorSourceResolutionService: ErrorSourceResolutionService;

    @inject(TaskService)
    protected readonly taskService: TaskService;

    @inject(TaskWatcher)
    protected readonly taskWatcher: TaskWatcher;

    @inject(HiddenTerminalService)
    protected readonly hiddenTerminalService: HiddenTerminalService;

    @inject(ILogger)
    protected readonly logger: ILogger;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    protected readonly onAllTerminalsClosedEmitter = new Emitter<void>();
    readonly onAllTerminalsClosed: Event<void> =
        this.onAllTerminalsClosedEmitter.event;

    protected readonly onSummaryRequestStartedEmitter = new Emitter<void>();
    readonly onSummaryRequestStarted: Event<void> =
        this.onSummaryRequestStartedEmitter.event;

    protected readonly onSummaryRequestFinishedEmitter = new Emitter<
        Summary | undefined
    >();
    readonly onSummaryRequestFinished: Event<Summary | undefined> =
        this.onSummaryRequestFinishedEmitter.event;

    protected readonly onTaskStartedEmitter = new Emitter<void>();
    readonly onTaskStarted: Event<void> = this.onTaskStartedEmitter.event;

    protected readonly onTaskExitedEmitter = new Emitter<void>();
    readonly onTaskExited: Event<void> = this.onTaskExitedEmitter.event;

    get onCurrentTerminalBufferChanged(): Event<void> {
        return this.hiddenTerminalService.onBufferChanged;
    }

    get onCachedOutputChanged(): Event<void> {
        return this.hiddenTerminalService.onCachedOutputChanged;
    }

    protected _currentSummary: Summary | undefined;
    get currentSummary(): Summary | undefined {
        return this._currentSummary;
    }

    protected _currentErrorLines: string[] = [];
    get currentErrorLines(): string[] {
        return this._currentErrorLines;
    }

    protected _summaryDebounce: ReturnType<typeof setTimeout> | undefined;
    protected _isRequestInFlight = false;

    protected _isTaskRunning = false;
    get isTaskRunning(): boolean {
        return this._isTaskRunning;
    }

    get hasCachedOutput(): boolean {
        return this.hiddenTerminalService.hasCachedOutput;
    }

    get isStandAlone(): boolean {
        return this.hiddenTerminalService.isStandAlone;
    }

    @preDestroy()
    protected dispose(): void {
        clearTimeout(this._summaryDebounce);
    }

    @postConstruct()
    protected initialize(): void {
        this.debugSessionManager.onDidStartDebugSession(() => {
            this._isTaskRunning = true;
            this.hiddenTerminalService.setTaskRunning(true);
            this.onTaskStartedEmitter.fire();
        });

        this.debugSessionManager.onDidDestroyDebugSession(async () => {
            this._isTaskRunning = false;
            this.hiddenTerminalService.setTaskRunning(false);
            this.onTaskExitedEmitter.fire();
            await this.requestSummary();
            this.hiddenTerminalService.createNewTerminal().catch((err) => {
                this.logger.error(
                    'Error recreating hidden terminal after debug session exit:',
                    err,
                );
            });
        });

        this.hiddenTerminalService.createNewTerminal().catch((err) => {
            this.logger.error('Error creating initial hidden terminal:', err);
        });

        this.taskWatcher.onTaskCreated(() => {
            this._isTaskRunning = true;
            this.hiddenTerminalService.setTaskRunning(true);
            this.hiddenTerminalService.clearCachedOutput();
            this.onTaskStartedEmitter.fire();
        });

        this.taskWatcher.onTaskExit(async () => {
            clearTimeout(this._summaryDebounce);
            this._summaryDebounce = setTimeout(async () => {
                const running = await this.taskService.getRunningTasks();
                if (running.length === 0) {
                    this._isTaskRunning = false;
                    this.hiddenTerminalService.setTaskRunning(false);
                    this.onTaskExitedEmitter.fire();
                    await this.requestSummary();
                    this.hiddenTerminalService.createNewTerminal().catch((err) => {
                        this.logger.error(
                            'Error recreating hidden terminal after task exit:',
                            err,
                        );
                    });
                }
            }, 500);
        });
    }

    async requestSummary(isManualReRequest?: boolean): Promise<void> {
        if (this._isRequestInFlight) {
            return;
        }
        this._isRequestInFlight = true;
        this.onSummaryRequestStartedEmitter.fire();
        this.errorSourceResolutionService.clearDecorations();
        try {
            const { cachedOutput, isStandAlone } = this.hiddenTerminalService;
            const summary =
                isManualReRequest && isStandAlone && cachedOutput
                    ? await this.agent.getSummary(
                        cachedOutput.cwd,
                        cachedOutput.recentTerminalContents,
                        cachedOutput.shell,
                    )
                    : await this.sendSummaryRequestForLastUsedTerminal();
            if (!summary) {
                this.messageService.error(
                    'AI Terminal Assistant: Summary request failed. The AI model returned no result.',
                );
            }
            this._currentSummary = summary
                ? await this.errorSourceResolutionService.enrichErrorsWithFileContent(
                    summary,
                )
                : undefined;
        } catch (error) {
            if (error instanceof NoLanguageModelError) {
                this.messageService.error(
                    'AI Terminal Assistant: No AI provider configured. Please configure a language model in the AI settings.',
                );
            } else {
                this.messageService.error(
                    `AI Terminal Assistant: Summary request failed. ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            this.logger.error('Error requesting terminal summary:', error);
            this._currentSummary = undefined;
        } finally {
            this._isRequestInFlight = false;
            this.onSummaryRequestFinishedEmitter.fire(this.currentSummary);
        }
    }

    async sendSummaryRequest(
        request: SummaryRequest,
    ): Promise<Summary | undefined> {
        const { cwd, shell, recentTerminalContents } = request;
        return this.agent.getSummary(cwd, recentTerminalContents, shell);
    }

    async sendSummaryRequestForLastUsedTerminal(): Promise<
        Summary | undefined
    > {
        const lastUsedTerminal = this.terminalService.lastUsedTerminal;
        if (lastUsedTerminal) {
            const cwd = (
                await (lastUsedTerminal as TerminalWidgetImpl).cwd
            ).toString();
            const shell = await getTerminalShell(lastUsedTerminal);
            const recentTerminalContents =
                getRecentTerminalCommands(lastUsedTerminal);
            this.logger.debug('terminal contents: ', recentTerminalContents);
            return this.agent.getSummary(cwd, recentTerminalContents, shell);
        }
        throw new Error('No active terminal found.');
    }

    async openErrorInEditor(error: ErrorDetail): Promise<void> {
        return this.errorSourceResolutionService.openErrorInEditor(error);
    }

    async writeToCurrentTerminal(command: string): Promise<void> {
        return this.hiddenTerminalService.writeToTerminal(command);
    }

    async getBufferContent(): Promise<string[]> {
        return this.hiddenTerminalService.getBufferContent();
    }

}
