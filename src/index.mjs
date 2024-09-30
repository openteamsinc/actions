import fs from "fs/promises";
import core from "@actions/core";

import { getModifiedLines } from './utils/diffUtils.js';

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

async function run() {
    const ecosystem = core.getInput('package-ecosystem', { required: true });
    const annotateModifiedOnly = core.getInput('annotate-modified-only') === 'true';
    const filePath = ecosystem === 'pip' ? 'requirements.txt' : 'environment.yml';
    let modifiedLines = [];

    // Get modified lines if 'annotate-modified-only' is true, otherwise get all lines
    if (annotateModifiedOnly) {
        modifiedLines = await getModifiedLines(filePath);
    }

    // If no modified lines were found or not using 'annotate-modified-only', include all lines
    if (modifiedLines.length === 0) {
        const fileContents = await fs.readFile(filePath, 'utf-8');
        const totalLines = fileContents.split('\n').length;
        modifiedLines = Array.from({ length: totalLines }, (_, i) => i + 1);
    }

    await processLines(filePath, modifiedLines, ecosystem);
}

run();
