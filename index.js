const fs = require('fs/promises');
const core = require('@actions/core');
const yaml = require('js-yaml');

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

// Fetch package information from the Score API
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

async function processLines(filePath, lines) {
    for (let index = 1; index <= lines.length; index++) {
        const line = lines[index - 1]; // Keep lines including empty ones

        if (!line.trim()) {
            // Skip processing empty lines, but continue incrementing line count
            continue;
        }

        const packageName = processPackageLine(line);
        if (packageName) {
            if (!isValidPackageName(packageName)) {
                core.error(`Invalid package name: ${packageName}`, {
                    file: filePath,
                    startLine: index,
                    endLine: index
                });
            } else {
                await annotatePackage(packageName, filePath, index);
            }
        }
    }
}

async function processPipRequirements(filePath) {
    try {
        const lines = (await fs.readFile(filePath, 'utf-8')).split('\n');
        await processLines(filePath, lines);
    } catch (error) {
        core.setFailed(`Failed to read ${filePath}: ${error.message}`);
    }
}

async function processCondaEnvironment(filePath) {
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const environment = yaml.load(fileContent);

        if (environment?.dependencies) {
            const lines = fileContent.split('\n');
            await processLines(filePath, lines);
        } else {
            core.setFailed(`No dependencies found in ${filePath}`);
        }
    } catch (error) {
        core.setFailed(`Failed to read ${filePath}: ${error.message}`);
    }
}

// Main entry point for the GitHub Action
async function run() {
    const ecosystem = core.getInput('package-ecosystem', { required: true });

    if (ecosystem === 'pip') {
        await processPipRequirements('requirements.txt');
    } else if (ecosystem === 'conda') {
        await processCondaEnvironment('environment.yml');
    } else {
        core.setFailed(`Unsupported package ecosystem: ${ecosystem}`);
    }
}

run();
