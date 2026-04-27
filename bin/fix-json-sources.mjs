#!/usr/bin/env node
/**
 * Post-process for `wp i18n make-json`.
 *
 * wp-cli (≤ 2.12 at time of writing) writes `"source":"build/a.js"` to the
 * admin-bundle JSON files instead of `"build/admin.js"`. The hash in the
 * filename is correct (md5 of `build/admin.js`), so WordPress *does* find
 * the file at runtime — but the `source` metadata is wrong, which Copilot
 * (rightly) flags. This script rewrites the bad value in every generated
 * `.json` file.
 *
 * If wp-cli ever fixes the bug upstream, this becomes a no-op.
 */

import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve( 'languages' );
const wrong = '"source":"build\\/a.js"';
const right = '"source":"build\\/admin.js"';

let touched = 0;
for ( const file of fs.readdirSync( dir ) ) {
	if ( ! file.endsWith( '.json' ) ) continue;
	const full = path.join( dir, file );
	const before = fs.readFileSync( full, 'utf8' );
	if ( ! before.includes( wrong ) ) continue;
	fs.writeFileSync( full, before.split( wrong ).join( right ) );
	touched++;
}

if ( touched ) {
	console.log( `Fixed source field in ${ touched } JSON file(s).` );
}
