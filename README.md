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
