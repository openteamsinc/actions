# Annotate Requirements Action

This GitHub Action reads your `requirements.txt` or `environment.yml` files,  
fetches maturity and health data from the [Score API](https://openteams-score.vercel.app), and annotates each package with recommendations.  
It provides feedback on whether adding or updating a package will improve stability and maintainability.

## Features

- **Supports `pip` and `conda` ecosystems**: Annotates packages from `requirements.txt` for `pip` or `environment.yml` for `conda` using data from the Score API.
- **Modified Lines Annotation**: Optionally, the action can only annotate the modified lines in a pull request, focusing on the changes that are introduced.
- **Detailed Maturity and Health Analysis**: For each package, the action will log maturity (e.g., `Mature`, `Legacy`, `Experimental`, `Unknown`, `Placeholder`) and health risks (`Healthy`, `Caution Needed`, `Moderate Risk`, `High Risk`, `Unknown`, `Placeholder`).

## API Endpoints

The action uses the following API endpoints to fetch package maturity and health risk information:

- **Pip Packages**:  
  `https://openteams-score.vercel.app/api/package/pypi/{packageName}`
  
- **Conda Packages**:  
  `https://openteams-score.vercel.app/api/package/conda/conda-forge/{packageName}`

## Maturity Value

The maturity of a package is represented by the following possible values:

- `"Mature"`: Indicates the package is well established and maintained.
- `"Legacy"`: Indicates the package may no longer be actively maintained or is outdated.
- `"Experimental"`: Indicates the package is in development and may not be stable.
- `"Unknown"`: Indicates there is no available information about the package's maturity.
- `"Placeholder"`: A temporary placeholder value used when no data is available.

## Health Risk Value

The health risk of a package is represented by the following possible values:

- `"Healthy"`: Indicates the package is in good health with minimal risks.
- `"Caution Needed"`: Indicates there may be some potential issues or risks associated with the package.
- `"Moderate Risk"`: Indicates there are moderate risks associated with using the package.
- `"High Risk"`: Indicates the package presents significant risks to stability or maintainability.
- `"Unknown"`: Indicates there is no available information about the package's health risk.
- `"Placeholder"`: A temporary placeholder value used when no data is available.

## Inputs

### `package-ecosystem`
**Required**: The package ecosystem to use. Supported values are:
- `"pip"`: For Python package requirements from `requirements.txt`.
- `"conda"`: For package requirements from `environment.yml`.

### `requirements-path`
**Optional**: The path to the `requirements.txt` or `environment.yml` file. Default is `requirements.txt` for `pip` and `environment.yml` for `conda`.

### `annotate-modified-only`
**Optional**: If set to `"true"`, the action will only annotate the lines that were modified in the pull request. If not set or `false`, the action will annotate all packages in the file. Default is `false`.

## Outputs

None.

## Example Usage

This example demonstrates how to configure the action to work with both `pip` and `conda` ecosystems and how to annotate only the modified lines in a pull request.

```yaml
name: Annotate Python Packages

on: [pull_request]

jobs:
  annotate-requirements:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20.x'
      
      - name: Run the Annotate Requirements Action for pip
        uses: openteamsinc/score@v1
        with:
          package-ecosystem: 'pip'
          requirements-path: 'requirements.txt'
          annotate-modified-only: 'true'
      
      - name: Run the Annotate Requirements Action for conda
        uses: openteamsinc/score@v1
        with:
          package-ecosystem: 'conda'
          requirements-path: 'environment.yml'
          annotate-modified-only: 'false'
