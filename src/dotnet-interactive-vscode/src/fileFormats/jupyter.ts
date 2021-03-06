// Copyright (c) .NET Foundation and contributors. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { CellKind, CellOutput, CellOutputKind, NotebookCell, NotebookDocument } from "../interfaces/vscode";
import { JupyterCell, JupyterMetadata, JupyterNotebook, JupyterOutput } from "../interfaces/jupyter";
import { editorLanguageAliases, getNotebookSpecificLanguage, getSimpleLanguage } from "../interactiveNotebook";
import { splitAndCleanLines, createUri } from "../utilities";

export function parseAsJupyterNotebook(contents: string): NotebookDocument {
    const jupyterJson = JSON.parse(contents);
    const notebook = jupyterToNotebook(jupyterJson);
    return notebook;
}

export function serializeAsJupyterNotebook(notebook: NotebookDocument): string {
    const jupyterNotebook = notebookToJupyter(notebook);
    const contents = JSON.stringify(jupyterNotebook, null, 1);
    return contents;
}

function notebookToJupyter(document: NotebookDocument): JupyterNotebook {
    // VS Code Notebooks don't have the concept of a global notebook language, so we have to fake it.
    let notebookLanguage = 'dotnet-interactive.csharp';
    let cells: Array<JupyterCell> = [];
    for (let cell of document.cells) {
        let jcell: JupyterCell | undefined = undefined;
        switch (cell.cellKind) {
            case CellKind.Markdown:
                jcell = {
                    cell_type: 'markdown',
                    metadata: {},
                    source: cell.document.getText()
                };
                break;
            case CellKind.Code:
                let cellSource = splitAndEnsureNewlineTerminators(cell.document.getText());
                if (cell.language !== notebookLanguage) {
                    cellSource.unshift(`#!${getSimpleLanguage(cell.language)}\r\n`);
                }
                jcell = {
                    cell_type: 'code',
                    execution_count: 1,
                    metadata: {},
                    source: cellSource,
                    outputs: cell.outputs.map(convertCellOutputToJupyter).filter(notUndefined)
                };
                break;
            default:
                break;
        }

        if (jcell) {
            cells.push(jcell);
        }
    }

    let metadataLanguage = getSimpleLanguage(notebookLanguage);
    let metadata: JupyterMetadata = {
        kernelspec: {
            display_name: displayNameFromLanguage(metadataLanguage),
            language: shortLanguageName(metadataLanguage),
            name: `.net-${metadataLanguage}`
        },
        language_info: {
            file_extension: fileExtensionFromLanguage(metadataLanguage),
            mimetype: `text/x-${metadataLanguage}`,
            name: shortLanguageName(metadataLanguage),
            pygments_lexer: metadataLanguage,
            version: versionFromLanguage(metadataLanguage)
        }
    };
    let notebook: JupyterNotebook = {
        cells: cells,
        metadata: metadata,
        nbformat: 4,
        nbformat_minor: 4
    };
    return notebook;
}

function jupyterToNotebook(jupyter: JupyterNotebook): NotebookDocument {
    let cells: Array<NotebookCell> = [];
    for (let jcell of jupyter.cells) {
        switch (jcell.cell_type) {
            case 'code':
                const { cellLanguage, cellContents } = getCellLanguageAndContents(jcell.source, expandLanguageName(jupyter.metadata.kernelspec.language));
                const cellText = cellContents.join('\n');
                cells.push({
                    cellKind: CellKind.Code,
                    document: {
                        uri: createUri('unused'),
                        getText: () => cellText
                    },
                    language: getNotebookSpecificLanguage(cellLanguage),
                    outputs: convertJupyterOutputsToCellOutputs(jcell.outputs)
                });
                break;
            case 'markdown':
                cells.push({
                    cellKind: CellKind.Markdown,
                    document: {
                        uri: createUri('unused'),
                        getText: () => splitAndCleanLines(jcell.source).join('\n')
                    },
                    language: 'dotnet-interactive.markdown',
                    outputs: []
                });
                break;
        }
    }
    return {
        cells
    };
}

function getCellLanguageAndContents(contents: string | Array<string>, defaultLanguage: string): { cellLanguage: string, cellContents: Array<string> } {
    let lines = splitAndCleanLines(contents);
    if (lines.length > 0 && lines[0].startsWith('#!')) {
        let possibleLanguageAlias = lines[0].substr(2).trimRight();
        let languageName = editorLanguageAliases.get(possibleLanguageAlias);
        if (languageName) {
            return {
                cellLanguage: languageName,
                cellContents: lines.splice(1)
            };
        }
    }

    return {
        cellLanguage: defaultLanguage,
        cellContents: lines
    };
}

function expandLanguageName(languageName: string): string {
    switch (languageName) {
        case 'C#':
            return 'csharp';
        case 'F#':
            return 'fsharp';
        default:
            return languageName;
    }
}

function notUndefined<T>(x: T | undefined): x is T {
    return x !== undefined;
}

function convertCellOutputToJupyter(output: CellOutput): JupyterOutput | undefined {
    switch (output.outputKind) {
        case CellOutputKind.Error:
            return {
                output_type: 'error',
                ename: output.ename,
                evalue: output.evalue,
                traceback: output.traceback
            };
        case CellOutputKind.Rich:
            return {
                output_type: 'execute_result',
                execution_count: 1,
                data: convertCellOutputDataToJupyter(output.data),
                metadata: {}
            };
        case CellOutputKind.Text:
            return {
                output_type: 'display_data',
                data: {
                    'text/plain': splitAndEnsureNewlineTerminators(output.text)
                },
                metadata: {}
            };
        default:
            return undefined;
    }
}

function convertCellOutputDataToJupyter(data: { [key: string]: string }): { [key: string]: string[] } {
    let result: { [key: string]: string[] } = {};
    for (let key in data) {
        result[key] = splitAndEnsureNewlineTerminators(data[key]);
    }

    return result;
}

function convertJupyterOutputsToCellOutputs(outputs: JupyterOutput[] | undefined): CellOutput[] {
    if (!outputs) {
        return [];
    }

    return outputs.map(convertJupyterOutputToCellOutput);
}

function convertJupyterOutputToCellOutput(output: JupyterOutput): CellOutput {
    switch (output.output_type) {
        case 'error':
            return {
                outputKind: CellOutputKind.Error,
                ename: output.ename,
                evalue: output.evalue,
                traceback: output.traceback
            };
        case 'execute_result':
            return {
                outputKind: CellOutputKind.Rich,
                data: output.data
            };
        case 'display_data':
            return {
                outputKind: CellOutputKind.Text,
                text: output.data['text/plain']
            };
        default:
            // unknown, but we have to return something
            return {
                outputKind: CellOutputKind.Text,
                text: ''
            };
    }
}

function displayNameFromLanguage(language: string): string {
    switch (language) {
        case 'csharp':
            return '.NET (C#)';
        case 'fsharp':
            return '.NET (F#)';
        case 'powershell':
            return '.NET (PowerShell)';
        default:
            return 'unknown';
    }
}

function fileExtensionFromLanguage(language: string): string {
    switch (language) {
        case 'csharp':
            return '.cs';
        case 'fsharp':
            return '.fs';
        case 'powershell':
            return '.ps1';
        default:
            return 'unknown';
    }
}

function shortLanguageName(language: string): string {
    switch (language) {
        case 'csharp':
            return 'C#';
        case 'fsharp':
            return 'F#';
        default:
            return language;
    }
}

function versionFromLanguage(language: string): string {
    switch (language) {
        case 'csharp':
            return '8.0';
        case 'fsharp':
            return '4.5';
        case 'powershell':
            return '7.0';
        default:
            return 'unknown';
    }
}

function splitAndEnsureNewlineTerminators(source: string): Array<string> {
    // With the exception of markdown text, jupyter stores strings in an array, one entry per line, where each line has
    // a terminating `\r\n` except for the last line.
    let lines = splitAndCleanLines(source);
    for (let i = 0; i < lines.length - 1; i++) {
        lines[i] += '\r\n';
    }

    return lines;
}
