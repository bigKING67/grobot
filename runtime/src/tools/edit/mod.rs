// Edit tool pipeline composition:
// types/state -> text normalization -> arg parsing -> matching -> diff/write -> entrypoint.
include!("types.rs");
include!("state.rs");
include!("text.rs");
include!("quotes.rs");
include!("args.rs");
include!("matcher.rs");
include!("diagnostics.rs");
include!("diff.rs");
include!("write.rs");
include!("entry.rs");
