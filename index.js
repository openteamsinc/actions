const fs = require('fs/promises');
const core = require('@actions/core');

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

function parseFlowDependencies(flowString) {
    // Remove leading and trailing brackets
    const content = flowString.replace(/^\[|\]$/g, '');
    // Split by commas and trim whitespace
    return content.split(',').map(dep => dep.trim()).filter(dep => dep);
}

// Fetch package information from the Score API
async function fetchPackageScore(packageName, ecosystem) {
    let url;
    if (ecosystem === 'pip') {
        url = `https://openteams-score.vercel.app/api/package/pypi/${packageName}`;
    } else if (ecosystem === 'conda') {
        url = `https://openteams-score.vercel.app/api/package/conda/conda-forge/${packageName}`;
    } else {
        throw new Error(`Unknown ecosystem: ${ecosystem}`);
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

async function annotatePackage(packageName, ecosystem, filePath, lineNumber) {
    try {
        const response = await fetchPackageScore(packageName, ecosystem);
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
            core.notice(`Package ${packageName} (${ecosystem}): (Maturity: ${maturityValue}, Health: ${healthRiskValue}). ${recommendation}`, {
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
                await annotatePackage(packageName, 'pip', filePath, index);
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

async function* getDependenciesWithLineNumbers(filePath) {
    const fileContent = await fs.readFile(filePath, 'utf8');
    const lines = fileContent.split('\n');

    let inDependencies = false;
    let inPipSection = false;
    let lineNumber = 0;

    for (const line of lines) {
        lineNumber++;
        const trimmedLine = line.trim();

        // Check for 'dependencies:'
        if (trimmedLine.startsWith('dependencies:')) {
            inDependencies = true;
            inPipSection = false;

            // Check for flow-style dependencies
            const depsLine = trimmedLine.substring('dependencies:'.length).trim();
            if (depsLine.startsWith('[')) {
                // Handle flow-style dependencies
                const deps = parseFlowDependencies(depsLine);
                for (const dep of deps) {
                    yield { dependency: dep, lineNumber, ecosystem: 'conda' };
                }
                inDependencies = false;
            }
            continue;
        }

        if (inDependencies) {
            // Check for '- pip:' indicating the start of the pip section
            if (trimmedLine.startsWith('- pip:')) {
                inPipSection = true;

                // Check for flow-style pip dependencies
                const pipDepsLine = trimmedLine.substring('- pip:'.length).trim();
                if (pipDepsLine.startsWith('[')) {
                    const pipDeps = parseFlowDependencies(pipDepsLine);
                    for (const dep of pipDeps) {
                        yield { dependency: dep, lineNumber, ecosystem: 'pip' };
                    }
                    inPipSection = false;
                }
                continue;
            }

            if (inPipSection) {
                // Handle block-style pip dependencies
                if (trimmedLine.startsWith('-')) {
                    const dep = trimmedLine.substring(1).trim();
                    yield { dependency: dep, lineNumber, ecosystem: 'pip' };
                } else if (trimmedLine === '') {
                    // Ignore empty lines
                    continue;
                } else {
                    // End of pip section
                    inPipSection = false;
                }
            } else {
                // Handle block-style conda dependencies
                if (trimmedLine.startsWith('-')) {
                    const dep = trimmedLine.substring(1).trim();
                    yield { dependency: dep, lineNumber, ecosystem: 'conda' };
                } else if (trimmedLine === '') {
                    // Ignore empty lines
                    continue;
                } else {
                    // End of dependencies section
                    inDependencies = false;
                }
            }
        }
    }
}

async function processCondaEnvironment(filePath) {
    try {
        for await (const { dependency, lineNumber, ecosystem } of getDependenciesWithLineNumbers(filePath)) {
            const packageName = stripVersion(dependency);
            if (packageName && isValidPackageName(packageName)) {
                await annotatePackage(packageName, ecosystem, filePath, lineNumber);
            } else {
                core.error(`Invalid package name: ${packageName}`, {
                    file: filePath,
                    startLine: lineNumber,
                    endLine: lineNumber
                });
            }
        }
    } catch (error) {
        core.setFailed(`Failed to process ${filePath}: ${error.message}`);
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
