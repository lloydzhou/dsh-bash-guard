# Installed host protocol compatibility

`typert-protocol.js` is an **unmodified** copy of `@deepseek-ai/dsh-typert-protocol` **0.2.0-rc.2**, extracted from the installed DeepSeek Harness application archive (`node_modules/@deepseek-ai/dsh-typert-protocol/lib/index.js`).

SHA-256: `f7e0fa4b750267f6adaa1b901be7987f0d830800ec3a05f247251bf77de0b809`.

Upstream: https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/typert/protocol

License: MIT; original notice retained in `LICENSE.typert-protocol`.

This installed protocol uses versioned descriptors on service prototypes. The publicly available 0.1.0-rc.6 implementation uses private module-local WeakMaps, whose Remote markers are invisible to the installed host gateway. Vendoring the complete inspected host implementation preserves the actual standard Remote registration API and avoids inventing/patching metadata or changing any host file. Its only runtime import is `@deepseek-ai/cordis`.
