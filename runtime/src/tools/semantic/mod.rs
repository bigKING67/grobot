// Semantic tools are split by responsibility:
// args/source roots -> diagnostics -> ContextWeaver bridge -> public entrypoints.
include!("constants.rs");
include!("types.rs");
include!("args.rs");
include!("source_roots.rs");
include!("errors.rs");
include!("bridge.rs");
include!("entry.rs");
