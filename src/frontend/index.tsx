/**
 * Annotate AI — Frontend Toolbar entry point.
 *
 * Mounts the React toolbar into a dedicated root appended to <body> at
 * DOMContentLoaded. Only loaded for users with `manage_options`.
 */

import { createRoot } from '@wordpress/element';
import Toolbar from './Toolbar';
import './style.scss';

function bootstrap() {
	if ( typeof window === 'undefined' || ! document.body ) {
		return;
	}
	const existing = document.getElementById( 'aai-root' );
	if ( existing ) {
		return;
	}
	const root = document.createElement( 'div' );
	root.id = 'aai-root';
	document.body.appendChild( root );
	createRoot( root ).render( <Toolbar /> );
}

if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', bootstrap );
} else {
	bootstrap();
}
