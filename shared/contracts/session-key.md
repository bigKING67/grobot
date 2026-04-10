# SessionKey Contract

Canonical format:

`<platform>:<tenant>:<scope>:<subject>`

## Fields

1. `platform`: `feishu` or `telegram`
2. `tenant`: enterprise slug
3. `scope`: `dm` or `group`
4. `subject`: user/thread/session discriminator

## Rules

1. Exactly 4 segments, separated by `:`.
2. No empty segment.
3. Do not include `:` inside a segment.
