import { exec } from 'child_process';
import util from 'util';
import core from '@actions/core';
import github from '@actions/github';

const execPromise = util.promisify(exec);

export async function getModifiedLines(filePath) {
    const { context } = github;
    const baseRef = context.payload.pull_request?.base?.ref;

    if (!baseRef) {
        core.setFailed("Error: Base branch (baseRef) is missing. Please ensure the pull request is targeting a valid base branch.");
        return [];
    }

    try {
        await execPromise(`git fetch origin ${baseRef}`);
        const { stdout, stderr } = await execPromise(`git diff origin/${baseRef} HEAD -- ${filePath}`);
        if (stderr) {
            throw new Error(`Error fetching diff: ${stderr}`);
        }

        const patchLines = stdout.split('\n');
        const modifiedLines = [];
        let lineNumber = 0;

        for (const line of patchLines) {
            if (line.startsWith('@@')) {
                const match = /@@ -\d+,\d+ \+(\d+),/.exec(line);
                lineNumber = match ? parseInt(match[1], 10) : lineNumber;
            } else if (line.startsWith('+') && !line.startsWith('+++')) {
                modifiedLines.push(lineNumber);
                lineNumber++;
            } else if (!line.startsWith('-')) {
                lineNumber++;
            }
        }

        return modifiedLines;
    } catch (error) {
        core.setFailed(`Error getting modified lines from commit diff: ${error.message}`);
        return [];
    }
}
