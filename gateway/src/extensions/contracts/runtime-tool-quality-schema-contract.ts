import { loadRuntimeToolQualityRepoFiles } from "./runtime-tool-quality-schema-contract/repo-files";
import { runSchemaCase } from "./runtime-tool-quality-schema-contract/schema-case";
import { releaseFields, statusFields } from "./runtime-tool-quality-schema-contract/source-fragments";
import { runSourceCase } from "./runtime-tool-quality-schema-contract/source-case";
import { runTestCoverageCase } from "./runtime-tool-quality-schema-contract/test-coverage-case";

const files = loadRuntimeToolQualityRepoFiles();
const schema = runSchemaCase({
  qualitySchema: files.qualitySchema,
  sharedContractsReadme: files.sharedContractsReadme,
});
runSourceCase(files, schema);
runTestCoverageCase(files);

process.stdout.write(JSON.stringify({
  ok: true,
  contract: "runtime-tool-quality-schema",
  shared_contract: "shared/contracts/runtime-tool-quality-v1.json",
  failure_reason_count: schema.schemaFailureReasons.length,
  warning_reason_count: schema.schemaWarningReasons.length,
  action_family_count: schema.schemaActionFamilies.length,
  action_required_count: schema.schemaActionRequiredIds.length,
  release_diagnostic_field_count: schema.schemaReleaseDiagnosticFields.length,
  priority_fixture_status_action: schema.statusPriorityAction,
  priority_fixture_release_action: schema.releasePriorityAction,
  release_fields: [...releaseFields],
  status_fields: [...statusFields],
}) + "\n");
