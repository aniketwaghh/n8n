#!/usr/bin/env node
/**
 * Asserts a pushed image's manifest is an OCI image index carrying only real
 * platform manifests.
 *
 * n8n 2.26.0 shipped as a Docker manifest list instead of an OCI index and
 * older containerd on AKS read the attestation manifests as image manifests,
 * failing every pull with "number of layers and diffIDs don't match" (#31997).
 * `sbom: true` was restored to force the index format. This check exists so the
 * format can be verified directly rather than inferred from that flag.
 *
 * Usage: node assert-manifest-format.mjs <image-ref> [--expect-platforms n]
 */

import { execFileSync } from 'node:child_process';

const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';

const [ref, ...rest] = process.argv.slice(2);
if (!ref) {
	console.error('usage: assert-manifest-format.mjs <image-ref> [--expect-platforms n]');
	process.exit(2);
}

const expectIdx = rest.indexOf('--expect-platforms');
const expectPlatforms = expectIdx === -1 ? null : Number(rest[expectIdx + 1]);

const raw = execFileSync('docker', ['buildx', 'imagetools', 'inspect', '--raw', ref], {
	encoding: 'utf-8',
});
const manifest = JSON.parse(raw);

const failures = [];

if (manifest.mediaType !== OCI_INDEX) {
	failures.push(`mediaType is ${manifest.mediaType}, expected ${OCI_INDEX}`);
}

const entries = manifest.manifests ?? [];
const platforms = entries.filter((m) => m.platform?.architecture !== 'unknown');
const attestations = entries.filter((m) => m.platform?.architecture === 'unknown');

if (expectPlatforms !== null && platforms.length !== expectPlatforms) {
	failures.push(`${platforms.length} platform manifests, expected ${expectPlatforms}`);
}

console.log(`ref:        ${ref}`);
console.log(`mediaType:  ${manifest.mediaType}`);
for (const m of platforms) {
	console.log(`  platform  ${m.platform.os}/${m.platform.architecture}`);
}
for (const _ of attestations) {
	console.log('  attestation (unknown/unknown)');
}

// Not fatal: attestations are what `--sbom=true` adds, and they are also what
// the 2.26.0 pull failure tripped over. Surface the count, let the caller judge.
console.log(`\nplatforms: ${platforms.length}, attestations: ${attestations.length}`);

if (failures.length > 0) {
	for (const f of failures) console.error(`::error::${f}`);
	process.exit(1);
}
console.log('OK: manifest is an OCI image index');
