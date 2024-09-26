import fs from "fs/promises";
import core from "@actions/core";
import github from '@actions/github';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

function isValidPackageName(packageName) {
    const packageNamePattern = /^[a-zA-Z0-9._-]+$/;
    return packageNamePattern.test(packageName);
}

function stripVersion(packageLine) {
    return packageLine.split(/[<>=~!]/)[0].trim();
}

function processPackageLine(line) {
    const cleanLine = line.split('#')[0].trim();
    if (!cleanLine || cleanLine.startsWith('-')) return null;
    return stripVersion(cleanLine);
}

// Fetch package information from the Score API for both pip and conda
async function fetchPackageScore(packageName, ecosystem) {
    let url;
    if (ecosystem === 'pip') {
        url = `https://openteams-score.vercel.app/api/package/pypi/${packageName}`;
    } else if (ecosystem === 'conda') {
        url = `https://openteams-score.vercel.app/api/package/conda/conda-forge/${packageName}`;
    } else {
        throw new Error(`Unsupported package ecosystem: ${ecosystem}`);
    }

    try {
        const response = await fetch(url);
        if (response.ok) {
            return await response.json();
        } else {
            throw new Error(`Request failed with status code ${response.status}`);
        }
    } catch (error) {
        throw new Error(`Error fetching package ${packageName}: ${error.message}`);
    }
}

async function annotatePackage(packageName, filePath, lineNumber, ecosystem) {
    try {
        const response = await fetchPackageScore(packageName, ecosystem);
        if (response && response.source) {
            const { maturity, health_risk } = response.source;
            const maturityValue = maturity ? maturity.value : 'Unknown';
            const healthRiskValue = health_risk ? health_risk.value : 'Unknown';

            let recommendation = '';
            let logFunction = core.notice; // Default log level is notice

            // Determine log level and recommendation based on maturity and health risk
            if (maturityValue === 'Mature' && healthRiskValue === 'Healthy') {
                recommendation = 'This package is likely to enhance stability and maintainability with minimal risks.';
                logFunction = core.notice; // Healthy package, log as notice
            } else if (maturityValue === 'Mature' && healthRiskValue === 'Moderate Risk') {
                recommendation = 'The package is stable but may introduce some moderate risks.';
                logFunction = core.warning; // Moderate risk, log as warning
            } else if (maturityValue === 'Mature' && healthRiskValue === 'High Risk') {
                recommendation = 'The package is stable but introduces high risks.';
                logFunction = core.error; // High risk, log as error
            } else if (maturityValue === 'Developing' && healthRiskValue === 'Healthy') {
                recommendation = 'The package is in development but poses low risks.';
                logFunction = core.notice; // Developing but healthy, log as notice
            } else if (maturityValue === 'Experimental' || healthRiskValue === 'High Risk') {
                recommendation = 'This package may pose significant risks to stability and maintainability.';
                logFunction = core.error; // Experimental or high risk, log as error
            } else if (maturityValue === 'Legacy') {
                recommendation = 'This package is legacy and may not be stable, consider alternatives.';
                logFunction = core.warning; // Legacy package, log as warning
            } else if (
                ['Not Found', 'Unknown', 'Placeholder'].includes(maturityValue) || 
                ['Not Found', 'Unknown', 'Placeholder', 'Healthy'].includes(healthRiskValue)
            ) {
                recommendation = 'Insufficient data to make an informed recommendation.';
                logFunction = core.notice; // Uncertain data or healthy, log as notice
            } else {
                recommendation = 'Insufficient data to make an informed recommendation.';
                logFunction = core.warning; // General warning for unspecified cases
            }

            // Add annotation to the specific file and line number
            logFunction(`Package ${packageName} (${ecosystem}): (Maturity: ${maturityValue}, Health: ${healthRiskValue}). ${recommendation}`, {
                file: filePath,
                startLine: lineNumber,
                endLine: lineNumber
            });
        } else {
            // When the package is not found, use core.notice
            core.notice(`Package ${packageName} (${ecosystem}) not found.`, {
                file: filePath,
                startLine: lineNumber,
                endLine: lineNumber
            });
        }
    } catch (error) {
        core.error(`Error looking up package ${packageName} (${ecosystem}): ${error.message}`, {
            file: filePath,
            startLine: lineNumber,
            endLine: lineNumber
        });
    }
}

async function processLines(filePath, modifiedLineNumbers, ecosystem) {
    try {
        // Read all lines from the file
        const allLines = (await fs.readFile(filePath, 'utf-8')).split('\n');

        // Iterate over the modified line numbers, and fetch corresponding lines
        for (const lineNumber of modifiedLineNumbers) {
            // Get the line content using the line number (adjust for zero-index)
            const line = allLines[lineNumber - 1];

            // Ensure line is a string before calling trim()
            if (typeof line !== 'string') {
                core.warning(`Skipping non-string line at line number ${lineNumber}: ${JSON.stringify(line)}`);
                continue;
            }

            if (!line.trim()) continue;

            const packageName = processPackageLine(line);
            if (packageName) {
                if (!isValidPackageName(packageName)) {
                    core.error(`Invalid package name: ${packageName}`, {
                        file: filePath,
                        startLine: lineNumber,
                        endLine: lineNumber
                    });
                } else {
                    await annotatePackage(packageName, filePath, lineNumber, ecosystem);
                }
            }
        }
    } catch (error) {
        core.setFailed(`Failed to process lines in ${filePath}: ${error.message}`);
    }
}

async function processPipRequirements(filePath) {
    try {
        const lines = (await fs.readFile(filePath, 'utf-8')).split('\n');
        await processLines(filePath, lines, 'pip');
    } catch (error) {
        core.setFailed(`Failed to read ${filePath}: ${error.message}`);
    }
}

async function* getDependenciesWithLineNumbers(filePath) {
    const fileContent = await fs.readFile(filePath, 'utf8');
    const lines = fileContent.split('\n');

    let inDependencies = false;
    let inPipDependencies = false;
    let lineNumber = 0;

    for (const line of lines) {
        lineNumber++;
        if (line.trim() === 'dependencies:') {
            inDependencies = true;
            continue;
        }
        if (inDependencies && line.trim() === '- pip:') {
            inPipDependencies = true;
            continue;
        }

        // Handle flow-style dependencies, e.g., "dependencies: [dep_a, dep_b]"
        if (inDependencies && line.trim().startsWith('- [')) {
            const dependencies = line
                .substring(line.indexOf('[') + 1, line.indexOf(']'))
                .split(',')
                .map(dep => dep.trim());

            for (const dependency of dependencies) {
                if (dependency) {
                    yield { dependency, lineNumber, ecosystem: 'conda' };
                }
            }
        }

        if (inDependencies && line.trim().startsWith('-') && !inPipDependencies && !line.trim().startsWith('- [')) {
            const dependency = line.trim().substring(2);
            yield { dependency, lineNumber, ecosystem: 'conda' };
        } else if (inPipDependencies && line.trim().startsWith('-')) {
            const dependency = line.trim().substring(2);
            yield { dependency, lineNumber, ecosystem: 'pip' };
        } else if (inPipDependencies && !line.trim().startsWith('-')) {
            inPipDependencies = false;
        }
    }
}

async function processCondaEnvironment(filePath) {
    try {
        for await (const dep of getDependenciesWithLineNumbers(filePath)) {
            const { dependency, lineNumber, ecosystem } = dep;
            const packageName = stripVersion(dependency);
            if (packageName && isValidPackageName(packageName)) {
                await annotatePackage(packageName, filePath, lineNumber, ecosystem);
            }
        }
    } catch (error) {
        core.setFailed(`Failed to read ${filePath}: ${error.message}`);
    }
}

// Fetch modified lines in the PR
async function getModifiedLines(filePath) {
    const { context } = github;
    const baseRef = context.payload.pull_request?.base?.ref;

    if (!baseRef) {
        core.setFailed("Error: Base branch (baseRef) is missing. Please ensure the pull request is targeting a valid base branch.");
        return [];
    }

    try {
        // Fetch the base branch to ensure we have the latest state of baseRef locally
        await execPromise(`git fetch origin ${baseRef}`);

        // Get the diff between the base branch and the current branch (HEAD)
        const { stdout, stderr } = await execPromise(`git diff origin/${baseRef} HEAD -- ${filePath}`);
        if (stderr) {
            throw new Error(`Error fetching diff: ${stderr}`);
        }

        const patchLines = stdout.split('\n');
        const modifiedLines = [];

        let lineNumber = 0;

        // Parse the diff to find the modified lines
        for (const line of patchLines) {
            if (line.startsWith('@@')) {
                const match = /@@ -\d+,\d+ \+(\d+),/.exec(line);
                lineNumber = match ? parseInt(match[1], 10) : lineNumber;
            } else if (line.startsWith('+') && !line.startsWith('+++')) {
                // Add the current line number if it's an addition
                modifiedLines.push(lineNumber);
                lineNumber++;
            } else if (!line.startsWith('-')) {
                // If it's a context line (not removed), increment the line number
                lineNumber++;
            }
        }

        return modifiedLines;
    } catch (error) {
        core.setFailed(`Error getting modified lines from commit diff: ${error.message}`);
        return [];
    }
}

async function run() {
    const ecosystem = core.getInput('package-ecosystem', { required: true });
    const annotateModifiedOnly = core.getInput('annotate-modified-only') === 'true';
    let modifiedLines = [];

    if (ecosystem === 'pip') {
        if (annotateModifiedOnly) {
            modifiedLines = await getModifiedLines('requirements.txt');
        }
        if (modifiedLines.length > 0) {
            await processLines('requirements.txt', modifiedLines, 'pip');
        } else {
            await processPipRequirements('requirements.txt');
        }
    } else if (ecosystem === 'conda') {
        if (annotateModifiedOnly) {
            modifiedLines = await getModifiedLines('environment.yml');
        }
        if (modifiedLines.length > 0) {
            await processLines('environment.yml', modifiedLines, 'conda');
        } else {
            await processCondaEnvironment('environment.yml');
        }
    } else {
        core.setFailed(`Unsupported package ecosystem: ${ecosystem}`);
    }
}

run();
