// Identify OpenTofu and Terraform sources, and the analyzer configuration that would shadow the rules.
//
// The same shape as the container-file reader beside it: predicates over the working-tree inventory,
// so the gate discovers what a repository actually tracks rather than reading a list somebody wrote
// once. A `.tf` added later is analysed the day it appears rather than the day somebody remembers it.

const basenameOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1)

// `.tf` is the configuration and `.tfvars` carries the values a placeholder credential would sit in.
// `.tf.json` is deliberately absent: it is JSON rather than HCL, so the text rules would misread it,
// and the analyzer reads it anyway through the directory it is pointed at.
const TERRAFORM_EXTENSIONS: readonly string[] = ['.tf', '.tfvars']

/**
 * Decide whether a path names an OpenTofu or Terraform source.
 *
 * An example file is not one. `terraform.tfvars.example` documents the variables an environment needs
 * and is meant to carry placeholders, so reading it as configuration would report a project for the
 * one file whose job is to hold the values it tells a reader to replace.
 * @param file a repo-relative path.
 * @returns true when the file is configuration the gate judges.
 */
export const isTerraformFile = (file: string): boolean =>
  TERRAFORM_EXTENSIONS.some((extension: string): boolean => file.endsWith(extension))

/**
 * Every OpenTofu or Terraform source the repository tracks.
 * @param tracked the repo-relative paths of the tracked files.
 * @returns the sources, ordered so a report reads the same on every machine.
 */
export const terraformFilesIn = (tracked: readonly string[]): readonly string[] =>
  tracked
    .filter((file: string): boolean => isTerraformFile(file))
    .toSorted((left: string, right: string): number => left.localeCompare(right))

// The names checkov reads on its own. A project that commits one can turn off the curated checks from
// inside the tree the gate judges, which is the shadowing the harness refuses for every other analyzer.
const CHECKOV_CONFIG_BASENAMES: ReadonlySet<string> = new Set([
  '.checkov.yaml',
  '.checkov.yml',
  '.checkov.json',
])

/**
 * Decide whether a path names a checkov configuration.
 * @param file a repo-relative path.
 * @returns true for a configuration checkov would read on its own, at any depth.
 */
export const isCheckovConfigFile = (file: string): boolean =>
  CHECKOV_CONFIG_BASENAMES.has(basenameOf(file))

/**
 * Every checkov configuration the repository tracks.
 * @param tracked the repo-relative paths of the tracked files.
 * @returns the configurations, ordered so a report reads the same on every machine.
 */
export const checkovConfigsIn = (tracked: readonly string[]): readonly string[] =>
  tracked
    .filter((file: string): boolean => isCheckovConfigFile(file))
    .toSorted((left: string, right: string): number => left.localeCompare(right))
