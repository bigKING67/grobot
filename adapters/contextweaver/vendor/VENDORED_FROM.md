# ContextWeaver Vendor Source

- Upstream repository: `https://github.com/GowayLee/ContextWeaver`
- Local sync source used in this migration:
  `/Users/gaoqian/Documents/sixseven/codeproject/ContextWeaver`
- Sync command:
  `rsync -a --exclude .git --exclude node_modules --exclude .DS_Store /Users/gaoqian/Documents/sixseven/codeproject/ContextWeaver/ adapters/contextweaver/vendor/contextweaver/`

Notes:

- Keep bridge adaptations in `adapters/contextweaver/bridge/`.
- Keep shared retrieval contract in `shared/retrieval/contextweaver-retrieval.mjs`.
- Do not edit vendored upstream files unless the change is part of an intentional upstream patch carry.
