<div align='center'>
<br />
<img src='./logo/theia.svg' alt='theia logo' width='125'>
<h2>EduIDE - AI Terminal Extension</h2>
</div>

## Overview
AI Terminal Theia extensions for the EduIDE 

## Features
- `@fangoling/ai-terminal-assistant`:
   - Summarize terminal output with ai assistance
   - Provide remediation steps in case of an error

## Privacy: terminal content egress

The assistant can send recent terminal output, the current working directory and the shell to the configured language model. Because terminal output can contain secrets, this is **off by default**.

- Set `ai-features.ai-terminal-assistant.enabled` to `true` to allow the assistant to automatically send terminal content when a task or debug session exits. When off, the assistant stays available but never sends terminal content on its own.
- Regardless of the setting, captured output is scrubbed before it leaves the IDE: lines that look like secrets (`*_TOKEN`, `*_SECRET`, `*_KEY`, `PASSWORD`, `Authorization:` headers, `Bearer` tokens, AWS-style access keys and `.env`-style `KEY=VALUE` pairs) have their values replaced with `[REDACTED]`.

## Getting started

Please install all necessary [prerequisites](https://github.com/eclipse-theia/theia/blob/master/doc/Developing.md#prerequisites).

## Running the browser example

    npm run build:browser
    npm run start:browser

*or:*

    npm run build:browser
    cd browser-app
    npm start

*or:* launch `Start Browser Backend` configuration from VS code.

Open http://localhost:3000 in the browser.

## Running the Electron example

    npm run build:electron
    npm run start:electron

*or:*

    npm run build:electron
    cd electron-app
    npm start

*or:* launch `Start Electron Backend` configuration from VS code.


## Developing with the browser example

Start watching all packages, including `browser-app`, of your application with

    npm run watch:browser

*or* watch only specific packages with

    cd 
    npm run watch

and the browser example.

    cd browser-app
    npm run watch

Run the example as [described above](#Running-the-browser-example)
## Developing with the Electron example

Start watching all packages, including `electron-app`, of your application with

    npm run watch:electron

*or* watch only specific packages with

    cd 
    npm run watch

and the Electron example.

    cd electron-app
    npm run watch

Run the example as [described above](#Running-the-Electron-example)

## Publishing 

Create a npm user and login to the npm registry, [more on npm publishing](https://docs.npmjs.com/getting-started/publishing-npm-packages).

    npm login

Publish packages with lerna to update versions properly across local packages, [more on publishing with lerna](https://github.com/lerna/lerna#publish).

    npx lerna publish
