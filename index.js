const fs = require('fs/promises');
const core = require('@actions/core');
const github = require('@actions/github');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Validate package names using a regex (for valid package name characters)
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

// Fetch package information from Score API
async function fetchPackageScore(packageName) {
    const url = `https://openteams-score.vercel.app/api/package/pypi/${packageName}`;
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

async function annotatePackage(packageName, filePath, lineNumber) {
    try {
        const response = await fetchPackageScore(packageName);
        if (response && response.source) {
            const { maturity, health_risk } = response.source;
            const maturityValue = maturity ? maturity.value : 'Unknown';
            const healthRiskValue = health_risk ? health_risk.value : 'Unknown';

            let recommendation = '';

            if (maturityValue === 'Mature' && healthRiskValue === 'Healthy') {
                recommendation = 'This package is likely to enhance stability and maintainability with minimal risks.';
            } else if (maturityValue === 'Mature' && healthRiskValue === 'Moderate Risk') {
                recommendation = 'The package is stable but may introduce some moderate risks.';
            } else if (maturityValue === 'Mature' && healthRiskValue === 'High Risk') {
                recommendation = 'The package is stable but introduces high risks.';
            } else if (maturityValue === 'Developing' && healthRiskValue === 'Healthy') {
                recommendation = 'The package is in development but poses low risks.';
            } else if (maturityValue === 'Experimental' || healthRiskValue === 'High Risk') {
                recommendation = 'This package may pose significant risks to stability and maintainability.';
            } else if (maturityValue === 'Legacy') {
                recommendation = 'This package is legacy and may not be stable, consider alternatives.';
            } else {
                recommendation = 'Insufficient data to make an informed recommendation.';
            }

            // Add annotation to the specific file and line number
            core.notice(`Package ${packageName}: (Maturity: ${maturityValue}, Health: ${healthRiskValue}). ${recommendation}`, {
                file: filePath,
                startLine: lineNumber,
                endLine: lineNumber
            });
        } else {
            core.error(`Package ${packageName} not found.`, {
                file: filePath,
                startLine: lineNumber,
                endLine: lineNumber
            });
        }
    } catch (error) {
        core.error(`Error looking up package ${packageName}: ${error.message}`, {
            file: filePath,
            startLine: lineNumber,
            endLine: lineNumber
        });
    }
}

// Fetch modified lines in the PR
async function getModifiedLines(filePath) {
    const { context } = github;
    const baseRef = context.payload.pull_request.base.ref;
    const headRef = context.payload.pull_request.head.ref;

    try {
        // Fetch and check out the base branch to diff against
        await execPromise(`git fetch origin ${baseRef}`);
        await execPromise(`git checkout ${baseRef}`);

        // Get the diff between the base branch and the current branch
        const { stdout, stderr } = await execPromise(`git diff origin/${baseRef} ${headRef} -- ${filePath}`);
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
        core.setFailed(`Error getting modified lines: ${error.message}`);
        return [];
    }
}

async function run() {
    const filePath = 'requirements.txt';
    const ecosystem = core.getInput('package-ecosystem', { required: true });
    const annotateModifiedOnly = core.getInput('annotate-modified-only') === 'true';

    if (ecosystem !== 'pip') {
        core.setFailed(`Unsupported package ecosystem: ${ecosystem}`);
        return;
    }

    let modifiedLines = [];
    if (annotateModifiedOnly) {
        modifiedLines = await getModifiedLines(filePath);
        if (modifiedLines.length === 0) {
            core.info(`No modified lines found in ${filePath}`);
            return;
        }
    }

    try {
        const packages = (await fs.readFile(filePath, 'utf-8')).split('\n').filter(pkg => pkg);

        packages.forEach((packageLine, index) => {
            const packageName = processPackageLine(packageLine);
            const lineNumber = index + 1;

            if (packageName) {
                if (!isValidPackageName(packageName)) {
                    core.error(`Invalid package name: ${packageName}`, {
                        file: filePath,
                        startLine: lineNumber,
                        endLine: lineNumber
                    });
                    return;
                }

                if (!annotateModifiedOnly || modifiedLines.includes(lineNumber)) {
                    annotatePackage(packageName, filePath, lineNumber);
                }
            }
        });
    } catch (error) {
        core.setFailed(`Failed to read ${filePath}: ${error.message}`);
    }
}

run();
