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
            logFunction(`Package ${packageName}: (Maturity: ${maturityValue}, Health: ${healthRiskValue}). ${recommendation}`, {
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

// Process a pip requirements.txt file
async function processPipRequirements(filePath) {
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
                annotatePackage(packageName, filePath, lineNumber);
            }
        });
    } catch (error) {
        core.setFailed(`Failed to read ${filePath}: ${error.message}`);
    }
}

// Process a conda environment.yml file
async function processCondaEnvironment(filePath) {
    try {
        // Read and parse the YAML content
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const environment = yaml.load(fileContent); // Parse YAML

        if (environment && environment.dependencies) {
            let lineNumber = 1; // Track line number in the file

            // Process conda dependencies
            environment.dependencies.forEach(dep => {
                if (typeof dep === 'string') {
                    // Conda package (not pip)
                    const packageName = processPackageLine(dep);
                    if (packageName) {
                        if (!isValidPackageName(packageName)) {
                            core.error(`Invalid package name: ${packageName}`, {
                                file: filePath,
                                startLine: lineNumber,
                                endLine: lineNumber
                            });
                        } else {
                            annotatePackage(packageName, filePath, lineNumber);
                        }
                    }
                    lineNumber++;
                } else if (typeof dep === 'object' && dep.pip) {
                    // Pip dependencies listed under "pip" in environment.yml
                    dep.pip.forEach((pipPackage, pipIndex) => {
                        const packageName = processPackageLine(pipPackage);
                        const pipLineNumber = lineNumber + pipIndex;
                        if (packageName) {
                            if (!isValidPackageName(packageName)) {
                                core.error(`Invalid pip package name: ${packageName}`, {
                                    file: filePath,
                                    startLine: pipLineNumber,
                                    endLine: pipLineNumber
                                });
                            } else {
                                annotatePackage(packageName, filePath, pipLineNumber);
                            }
                        }
                    });
                    lineNumber += dep.pip.length;
                }
            });
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
