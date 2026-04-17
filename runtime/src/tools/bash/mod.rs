// Bash tool pipeline composition:
// types -> args -> allowlist/security -> truncation -> execution -> entrypoint.
include!("types.rs");
include!("args.rs");
include!("allowlist.rs");
include!("security.rs");
include!("truncate.rs");
include!("exec.rs");
include!("entry.rs");
