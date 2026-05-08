// Bash tool pipeline composition:
// types -> args -> allowlist/security -> truncation -> execution -> entrypoint.
include!("types.rs");
include!("args.rs");
include!("allowlist.rs");
include!("security.rs");
include!("policy.rs");
include!("policy_shell.rs");
include!("policy_git.rs");
include!("policy_sed.rs");
include!("policy_paths.rs");
include!("truncate.rs");
include!("exec.rs");
include!("entry.rs");
