// *****************************************************************************
// Copyright (C) 2025 EclipseSource GmbH and others.
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
    Agent,
    getJsonOfResponse,
    isLanguageModelParsedResponse,
    LanguageModelRegistry,
    LanguageModelRequirement,
    LanguageModelService,
    PromptService,
    UserRequest,
} from '@theia/ai-core/lib/common';
import { generateUuid, ILogger, nls } from '@theia/core';
import { terminalPrompts } from './ai-terminal-assistant-prompt-template';
import { redactSecrets } from './terminal-widget-utils';
import { inject, injectable } from '@theia/core/shared/inversify';
import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

export class NoLanguageModelError extends Error {
    constructor() {
        super('No AI provider configured for the AI Terminal Agent.');
        this.name = 'NoLanguageModelError';
    }
}

export interface ErrorLines {
    errorLines: string[];
    errorLinesStart: number;
}
const ExplanationStep = z.object({
    label: z.string(),
    text: z.string(),
});
export type ExplanationStep = z.infer<typeof ExplanationStep>;
const ErrorDetailAI = z.object({
    category: z.string(),
    type: z.string(),
    file: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional(),
    explanationSteps: z.array(ExplanationStep),
    fixSteps: z.array(z.string()),
});
// ErrorDetail extends the AI output with errorLines, populated post-hoc by ErrorSourceResolutionService
export type ErrorDetail = z.infer<typeof ErrorDetailAI> & {
    errorLines?: ErrorLines;
};
const SummaryAI = z.object({
    isSuccessful: z.boolean(),
    outputSummary: z.string(),
    errors: z.array(ErrorDetailAI),
});
export type Summary = z.infer<typeof SummaryAI> & {
    errors: ErrorDetail[];
};

@injectable()
export class AiTerminalSummaryAgent implements Agent {
    id = 'Terminal Summary';
    name = 'Terminal Summary Assistant';
    description = nls.localize(
        'theia/ai/aiTerminalAssistant/agent/description',
        'This agent provides assistance to provide structured terminal output summaries. \
        It accesses the current directory, environment and the recent terminal output of the terminal session to provide context-aware assistance',
    );
    variables = [];
    functions = [];
    agentSpecificVariables = [
        {
            name: 'shell',
            usedInPrompt: true,
            description: nls.localize(
                'theia/ai/aiTerminalAssistant/agent/vars/shell/description',
                'The shell being used, e.g., /usr/bin/zsh.',
            ),
        },
        {
            name: 'cwd',
            usedInPrompt: true,
            description: nls.localize(
                'theia/ai/aiTerminalAssistant/agent/vars/cwd/description',
                'The current working directory.',
            ),
        },
        {
            name: 'recentTerminalContents',
            usedInPrompt: true,
            description: nls.localize(
                'theia/ai/aiTerminalAssistant/agent/vars/recentTerminalContents/description',
                'The last 0 to 50 recent lines visible in the terminal.',
            ),
        },
    ];
    prompts = terminalPrompts;
    languageModelRequirements: LanguageModelRequirement[] = [
        {
            purpose: 'summarize-terminal-output',
            identifier: 'default/universal',
        },
    ];

    @inject(LanguageModelRegistry)
    protected languageModelRegistry: LanguageModelRegistry;

    @inject(PromptService)
    protected promptService: PromptService;

    @inject(ILogger)
    protected logger: ILogger;

    @inject(LanguageModelService)
    protected languageModelService: LanguageModelService;

    async getSummary(
        cwd: string,
        recentTerminalContents: string[],
        shell?: string,
    ): Promise<Summary | undefined> {
        // Scrub obvious secrets from the captured buffer before anything leaves the IDE.
        recentTerminalContents = redactSecrets(recentTerminalContents);
        const lm = await this.languageModelRegistry.selectLanguageModel({
            agent: this.id,
            ...this.languageModelRequirements[0],
        });
        if (!lm) {
            throw new NoLanguageModelError();
        }
        const prompts = await this.resolvePrompts({ cwd, recentTerminalContents, shell });
        if (!prompts) {
            return undefined;
        }
        try {
            const result = await this.languageModelService.sendRequest(
                lm,
                this.buildLlmRequest(prompts.systemMessage, prompts.userRequest),
            );
            if (isLanguageModelParsedResponse(result)) {
                const parsedResult = SummaryAI.safeParse(result.parsed);
                if (parsedResult.success) {
                    return parsedResult.data;
                }
            }
            const jsonResult = await getJsonOfResponse(result);
            const parsedJsonResult = SummaryAI.safeParse(jsonResult);
            return parsedJsonResult.success ? parsedJsonResult.data : undefined;
        } catch (error) {
            this.logger.error('Error obtaining the command output summary.', error);
            return undefined;
        }
    }

    protected async resolvePrompts(parameters: {
        cwd: string;
        recentTerminalContents: string[];
        shell: string | undefined;
    }): Promise<{ systemMessage: string; userRequest: string } | undefined> {
        const systemMessage = await this.promptService
            .getResolvedPromptFragment('terminal-summary-system', parameters)
            .then((p) => p?.text);
        const userRequest = await this.promptService
            .getResolvedPromptFragment('terminal-summary-user', parameters)
            .then((p) => p?.text);
        if (!systemMessage || !userRequest) {
            this.logger.error(
                "The prompt service didn't return prompts for the AI Terminal Agent.",
            );
            return undefined;
        }
        return { systemMessage, userRequest };
    }

    protected buildLlmRequest(
        systemMessage: string,
        userRequest: string,
    ): UserRequest {
        return {
            messages: [
                { actor: 'ai', type: 'text', text: systemMessage },
                { actor: 'user', type: 'text', text: userRequest },
            ],
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'terminal-output-summary',
                    description: 'Structured summary of terminal output commands',
                    schema: zodToJsonSchema(SummaryAI),
                },
            },
            agentId: this.id,
            requestId: generateUuid(),
            sessionId: generateUuid(),
        };
    }
}
