# Annotate Requirements Action

This action reads a requirements.txt file and annotates each package with maturity and health data using the Score API.<br>
It provides recommendations on whether adding the package improves stability and maintainability.

## Inputs

### `package-ecosystem`

**Required** The package ecosystem to use. Currently, only `"pip"` is supported.

## Outputs

None.

## Example usage

```yaml
uses: openteamsinc/score@v3
with:
  package-ecosystem: 'pip'
```