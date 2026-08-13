# Reference Provenance

## Firmware behavioral reference

- Remote: `https://github.com/78/xiaozhi-esp32.git`
- Commit: `631add2a327ea2d49fec16e4d4534b8345bb40c1`
- Tree: `f045b616a42ae7360ec2e329016a5661175869e4`
- Observed project version: `2.4.2`
- License: MIT at repository root.
- Use: protocol, OTA, audio, MCP, board/build, and state-machine study.
- Warning: bundled audio, images, fonts, emoji, generated assets, and registry dependencies need separate provenance before redistribution.

## Server behavioral reference

- Remote: `https://github.com/xinnan-tech/xiaozhi-esp32-server.git`
- Commit: `545979873b6fe6ab52c86122fe6a0aef621b39ee`
- Tree: `c31ad10650d68074df3e845c3f24fb95e691de44`
- Observed describe: `v0.9.6-18-g54597987`
- License: MIT at repository root.
- Use: provider management, device provisioning, realtime pipeline, MCP, administrative data model, and simulator behavior study.
- Warning: Live2D runtime/sample models, bundled media/models, and unattributed minified libraries are separate licensing concerns and are not copied.

## Additional transport research

The linked MQTT gateway was inspected only to understand architecture and is not present in the local `references/` directory. Direct WebSocket v1 remains the first target; MQTT+UDP is deferred as a separate gateway.

## Naming boundary

New runtime source, package names, routes, UI copy, and log tags use Veetee naming. Upstream names remain only in this legal/provenance context and the ignored local reference paths.

## Update procedure

When a reference advances:

1. Fetch/update only inside its nested ignored repository.
2. Record old and new full commit/tree hashes.
3. Review protocol/provider diffs.
4. Add or update contract fixtures before adapting runtime code.
5. Run simulator conformance and hardware acceptance.
6. Update `provenance.lock.json` and this document in one reviewed commit.
