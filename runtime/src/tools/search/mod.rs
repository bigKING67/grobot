// Search tool pipeline composition:
// types -> args -> helpers -> rg collector -> builtin collector -> entrypoint.
include!("types.rs");
include!("args.rs");
include!("helpers.rs");
include!("rg.rs");
include!("builtin.rs");
include!("entry.rs");
