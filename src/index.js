import fs from "fs/promises";
import core from "@actions/core";

function isValidPackageName(packageName) {
    console.log(`Validating package name: ${packageName}`);
    const packageNamePattern = /^[a-zA-Z0-9._-]+$/;
    return packageNamePattern.test(packageName);
}
  
function stripVersion(packageLine) {
    console.log(`Stripping version from package line: ${packageLine}`);
    return packageLine.split(/[<>=~!]/)[0].trim();
}
  
function processPackageLine(line) {
    console.log(`Processing package line: ${line}`);
    const cleanLine = line.split('#')[0].trim();
    if (!cleanLine || cleanLine.startsWith('-')) return null;
    return stripVersion(cleanLine);
}
  
async function fetchPackageScore(packageName, ecosystem, channel) {
    console.log(`Fetching score for package: ${packageName}, ecosystem: ${ecosystem}, channel: ${channel}`);
    let url;
    if (ecosystem === 'pip') {
        url = `https://openteams-score.vercel.app/api/package/pypi/${packageName}`;
    } else if (ecosystem === 'conda') {
        url = `https://openteams-score.vercel.app/api/package/conda/${channel}/${packageName}`;
    } else {
        throw new Error(`Unsupported package ecosystem: ${ecosystem}`);
    }

    console.log(`Requesting URL: ${url}`);

    try {
        const response = await fetch(url);
        if (response.ok) {
            console.log(`Successfully fetched score for ${packageName}`);
            return await response.json();
        } else {
            console.error(`Failed to fetch score for ${packageName}: Status code ${response.status}`);
            throw new Error(`Request failed with status code ${response.status}`);
        }
    } catch (error) {
        console.error(`Error fetching package ${packageName}: ${error.message}`);
        throw new Error(`Error fetching package ${packageName}: ${error.message}`);
    }
}
  
async function annotatePackage(packageName, filePath, lineNumber, ecosystem, channel) {
    console.log(`Annotating package: ${packageName}, line: ${lineNumber}, ecosystem: ${ecosystem}, channel: ${channel}`);
    try {
        const response = await fetchPackageScore(packageName, ecosystem, channel);
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
  
async function processLines(filePath, lines, ecosystem) {
    console.log(`Processing lines from ${filePath} for ecosystem: ${ecosystem}`);
    for (let index = 1; index <= lines.length; index++) {
        const line = lines[index - 1];
        if (!line.trim()) continue;

        const packageName = processPackageLine(line);
        if (packageName) {
            if (!isValidPackageName(packageName)) {
                core.error(`Invalid package name: ${packageName}`, {
                    file: filePath,
                    startLine: index,
                    endLine: index
                });
            } else {
                await annotatePackage(packageName, filePath, index, ecosystem);
            }
        }
    }
}
  
async function processPipRequirements(filePath) {
    console.log(`Reading and processing pip requirements from ${filePath}`);
    try {
        const lines = (await fs.readFile(filePath, 'utf-8')).split('\n');
        await processLines(filePath, lines, 'pip');
    } catch (error) {
        core.setFailed(`Failed to read ${filePath}: ${error.message}`);
    }
}
  
async function* getDependenciesWithLineNumbers(filePath) {
    console.log(`Reading conda environment file: ${filePath}`);
    const fileContent = await fs.readFile(filePath, 'utf8');
    const lines = fileContent.split('\n');
  
    let inDependencies = false;
    let inPipDependencies = false;
    let lineNumber = 0;
    let condaChannel = 'conda-forge';
  
    for (const line of lines) {
        lineNumber++;

        // Detect the channels section and extract the non-default channel
        if (line.trim().startsWith('channels:')) {
            continue;
        }
        if (line.trim().startsWith('-') && !inDependencies) {
            const channel = line.trim().substring(2);
            if (channel !== 'defaults') {
                condaChannel = channel;
            }
        }

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
                    yield { dependency, lineNumber, ecosystem: 'conda', channel: condaChannel };
                }
            }
        }

        if (inDependencies && line.trim().startsWith('-') && !inPipDependencies && !line.trim().startsWith('- [')) {
            const dependency = line.trim().substring(2);
            yield { dependency, lineNumber, ecosystem: 'conda', channel: condaChannel };
        } else if (inPipDependencies && line.trim().startsWith('-')) {
            const dependency = line.trim().substring(2);
            yield { dependency, lineNumber, ecosystem: 'pip', channel: 'conda-forge'};
        } else if (inPipDependencies && !line.trim().startsWith('-')) {
            inPipDependencies = false;
        }
    }
}

async function processCondaEnvironment(filePath) {
    console.log(`Processing conda environment from ${filePath}`);
    try {
        for await (const dep of getDependenciesWithLineNumbers(filePath)) {
            const { dependency, lineNumber, ecosystem, channel } = dep;
            const packageName = stripVersion(dependency);
            if (packageName && isValidPackageName(packageName)) {
                await annotatePackage(packageName, filePath, lineNumber, ecosystem, channel);
            }
        }
    } catch (error) {
        core.setFailed(`Failed to read ${filePath}: ${error.message}`);
    }
}
  
async function run() {
    console.log('Starting the action');
    const ecosystem = core.getInput('package-ecosystem', { required: true });
    console.log(`Ecosystem input received: ${ecosystem}`);

    if (ecosystem === 'pip') {
        await processPipRequirements('requirements.txt');
    } else if (ecosystem === 'conda') {
        await processCondaEnvironment('environment.yml');
    } else {
        core.setFailed(`Unsupported package ecosystem: ${ecosystem}`);
    }
}

run();